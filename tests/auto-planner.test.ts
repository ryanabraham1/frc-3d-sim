import { beforeAll, expect, it, vi } from 'vitest';
import { SEASONS } from '../src/seasons';
import { cleanAutoPlan, PlannedAutoPilot, planPoint, simplifyPath } from '../src/engine/ai/autoPlan';
import { targetStep } from '../src/app/autoPlanner';
import { HeadlessSim } from '../src/engine/testing/headless';
import { loadRapier, type RapierModule } from '../src/engine/physics/world';
import { LobbyController } from '../src/app/lobby';
import { defaultSettings } from '../src/app/menu';
import type { HostMsg, LobbyState } from '../src/engine/net/protocol';
let R: RapierModule;
beforeAll(async () => { R = await loadRapier(); });
it('rejects malformed, cross-season and invalid target plans', () => {
  const season = SEASONS.find(s => s.id === '2025-reefscape')!;
  const valid = { seasonId: season.id, steps: [targetStep(season, 'reef', 11)] };
  expect(cleanAutoPlan(valid, season)).toMatchObject({ seasonId: valid.seasonId, steps: [{ action: 'reef', target: 11 }] });
  for (const steps of [[{ ...valid.steps[0], x: NaN }], [{ ...valid.steps[0], target: 12 }], [{ ...valid.steps[0], level: 5 }], [{ ...valid.steps[0], duration: -1 }], [{ ...valid.steps[0], action: 'note' }]]) expect(cleanAutoPlan({ ...valid, steps }, season)).toBeUndefined();
  expect(cleanAutoPlan({ ...valid, seasonId: 'other' }, season)).toBeUndefined();
});
it.each(SEASONS)('$year routes mirror back to the same saved plan', season => {
  const p = { x: 2, y: 3, yaw: .5 };
  const mirrored = planPoint(season, 'red', p);
  const back = planPoint(season, 'red', mirrored);
  expect(back.x).toBeCloseTo(p.x); expect(back.y).toBeCloseTo(p.y);
});
it.each(SEASONS)('$year physically follows a planned drive and stops', season => {
  const sim = new HeadlessSim(season, R, { robot: season.robotDefaults, alliance: 'blue', pose: season.startPose('blue', 2) });
  try {
    sim.rules.stage(); sim.rules.onPeriodChange(sim.ctx.clock.start());
    const start = { ...sim.robot.pose };
    const goal = { x: start.x + .6, y: start.y };
    if (season.id === '2025-reefscape') goal.y += .6;
    const pilot = new PlannedAutoPilot(sim.ctx, sim.rules, sim.robot, season, { seasonId: season.id, steps: [{ action: 'drive', ...goal, duration: 2 }] });
    for (let i = 0; i < 4 / sim.physics.dt; i++) sim.step(pilot.update(sim.physics.dt));
    expect(Math.hypot(sim.robot.pose.x - goal.x, sim.robot.pose.y - goal.y)).toBeLessThan(.2);
    expect(pilot.update(.1).vx).toBe(0);
  } finally { sim.dispose(); }
});
it.each(SEASONS.filter(s => s.id !== '2025-reefscape'))('$year planned preload shoots through real scoring physics', season => {
  const pose = season.testing!.scoringSpots('blue')[0];
  const sim = new HeadlessSim(season, R, { robot: season.robotDefaults, alliance: 'blue', pose });
  try {
    sim.rules.stage(); sim.rules.onPeriodChange(sim.ctx.clock.start());
    const pilot = new PlannedAutoPilot(sim.ctx, sim.rules, sim.robot, season, { seasonId: season.id, steps: [{ action: 'shoot', x: pose.x, y: pose.y, duration: 4 }] });
    for (let i = 0; i < 6 / sim.physics.dt; i++) sim.step(pilot.update(sim.physics.dt));
    expect(season.testing!.goalCount(sim.ctx, 'blue')).toBeGreaterThan(0);
  } finally { sim.dispose(); }
});
it('shares plans only with alliance teammates and strips them from match-start clients', () => {
  const season = SEASONS.find(s => s.id === '2025-reefscape')!;
  const plan = { seasonId: season.id, steps: [targetStep(season, 'reef', 0)] };
  vi.stubGlobal('location', { protocol: 'http:', host: 'localhost' });
  const lobby = new LobbyController();
  const state: LobbyState = { room: 'TEST', hostId: 'host', seasonId: season.id, inMatch: false, autoHumanPlayer: true, players: [
    { peerId: 'host', name: 'Host', host: true, team: 1, slot: 'blue1', autoPlan: plan },
    { peerId: 'mate', name: 'Mate', host: false, team: 2, slot: 'blue2' },
    { peerId: 'opponent', name: 'Other', host: false, team: 3, slot: 'red1' },
    { peerId: 'viewer', name: 'Viewer', host: false, team: 0, slot: null },
  ] };
  lobby.lobby = state;
  const send = vi.spyOn(lobby.client, 'send').mockImplementation(() => {});
  // Exercise the authoritative recipient-specific broadcasts without a relay server.
  (lobby as unknown as { broadcastLobby(): void }).broadcastLobby();
  const sent = (peer: string) => (send.mock.calls.find(c => c[1] === peer)![0] as Extract<HostMsg, { t: 'lobby' }>).lobby;
  expect(sent('mate').players[0].autoPlan).toEqual(plan);
  expect(sent('opponent').players[0]).not.toHaveProperty('autoPlan');
  expect(sent('viewer').players[0]).not.toHaveProperty('autoPlan');
  vi.spyOn(lobby, 'isHost', 'get').mockReturnValue(true);
  lobby.client.peerId = 'host';
  lobby.settings = { ...defaultSettings(season), autoRoutine: 'custom', autoPlan: plan, manualAuto: true };
  (lobby as unknown as { applyChoice(p: string, c: unknown): void }).applyChoice('host', { seasonId: season.id, robot: lobby.settings.robot, autoRoutine: 'custom', autoPlan: plan, manualAuto: true });
  lobby.startMatch();
  const start = send.mock.calls.map(c => c[0] as HostMsg).find(m => m.t === 'start') as Extract<HostMsg, { t: 'start' }>;
  expect(start.setup.robots[0]).not.toHaveProperty('autoPlan');
  expect(start.setup.robots[0].manualAuto).toBe(false);
  vi.unstubAllGlobals();
});

it('2025 places the preload on the selected branch through mechanisms', () => {
  const season = SEASONS.find(s => s.id === '2025-reefscape')!;
  const sim = new HeadlessSim(season, R, { robot: season.robotDefaults, alliance: 'blue', pose: season.startPose('blue', 2) });
  try {
    sim.rules.stage(); sim.rules.onPeriodChange(sim.ctx.clock.start());
    const pilot = new PlannedAutoPilot(sim.ctx, sim.rules, sim.robot, season, { seasonId: season.id, steps: [targetStep(season, 'reef', 0)] });
    for (let i = 0; i < 12 / sim.physics.dt; i++) { for (const c of sim.ctx.clock.advance(sim.physics.dt)) sim.rules.onPeriodChange(c); sim.step(pilot.update(sim.physics.dt)); }
    expect(season.testing!.goalCount(sim.ctx, 'blue')).toBeGreaterThan(0);
  } finally { sim.dispose(); }
});
it('2024 picks up a chosen wing note and returns to shoot', () => {
  const season = SEASONS.find(s => s.id === '2024-crescendo')!;
  const sim = new HeadlessSim(season, R, { robot: { ...season.robotDefaults, preload: 0 }, alliance: 'blue', pose: season.startPose('blue', 2) });
  try {
    sim.rules.stage(); sim.rules.onPeriodChange(sim.ctx.clock.start());
    const pilot = new PlannedAutoPilot(sim.ctx, sim.rules, sim.robot, season, { seasonId: season.id, steps: [targetStep(season, 'note', 0), { action: 'shoot', x: 2.6, y: 4.1, duration: 4 }] });
    for (let i = 0; i < 15 / sim.physics.dt; i++) { for (const c of sim.ctx.clock.advance(sim.physics.dt)) sim.rules.onPeriodChange(c); sim.step(pilot.update(sim.physics.dt)); }
    expect(season.testing!.goalCount(sim.ctx, 'blue')).toBeGreaterThan(0);
  } finally { sim.dispose(); }
});
it('2025 takes a real station-fed coral before advancing', () => {
  const season = SEASONS.find(s => s.id === '2025-reefscape')!;
  const sim = new HeadlessSim(season, R, { robot: { ...season.robotDefaults, preload: 0 }, alliance: 'blue', pose: { x: 2, y: 1.5, yaw: 0 } });
  try {
    sim.ctx.humanPlayerIsAuto = () => true;
    sim.rules.stage(); sim.rules.onPeriodChange(sim.ctx.clock.start());
    const pilot = new PlannedAutoPilot(sim.ctx, sim.rules, sim.robot, season, { seasonId: season.id, steps: [{ ...targetStep(season, 'station', 0), duration: 4 }] });
    for (let i = 0; i < 8 / sim.physics.dt; i++) { for (const c of sim.ctx.clock.advance(sim.physics.dt)) sim.rules.onPeriodChange(c); sim.step(pilot.update(sim.physics.dt)); }
    expect(sim.robot.held.length).toBeGreaterThan(0);
  } finally { sim.dispose(); }
});

it('collapses old sampled drawings into one path without losing corners or shooting stops', () => {
  const season = SEASONS.find(s => s.id === '2026-rebuilt')!;
  const points = [{ x: 2, y: 2 }, { x: 2.5, y: 2 }, { x: 3, y: 2 }, { x: 3, y: 2.5 }, { x: 3, y: 3 }];
  const plan = cleanAutoPlan({ seasonId: season.id, steps: [...points.map(p => ({ action: 'drive', ...p, duration: 2 })), { action: 'shoot', x: 3, y: 3, duration: 3, yaw: Math.PI / 2 }] }, season)!;
  expect(plan.steps).toHaveLength(2);
  expect(plan.steps[0].path).toEqual([{ x: 2, y: 2 }, { x: 3, y: 2 }]);
  expect(plan.steps[1]).toMatchObject({ action: 'shoot', yaw: Math.PI / 2 });
  expect(simplifyPath(Array.from({ length: 40 }, (_, i) => ({ x: 2 + i / 40, y: 2 })))).toHaveLength(2);
  expect(cleanAutoPlan({ seasonId: season.id, steps: [{ action: 'drive', x: 3, y: 3, duration: 2, path: [{ x: NaN, y: 2 }] }] }, season)).toBeUndefined();
});
it('driving runs the intake automatically and follows a grouped path with a chosen final heading', () => {
  const season = SEASONS.find(s => s.id === '2026-rebuilt')!;
  const sim = new HeadlessSim(season, R, { robot: season.robotDefaults, alliance: 'blue', pose: { x: 2, y: 2, yaw: 0 } });
  try {
    sim.rules.stage(); sim.rules.onPeriodChange(sim.ctx.clock.start());
    const goal = { x: 2.6, y: 2.6 };
    const pilot = new PlannedAutoPilot(sim.ctx, sim.rules, sim.robot, season, { seasonId: season.id, steps: [{ action: 'drive', ...goal, path: [{ x: 2.6, y: 2 }], yaw: Math.PI / 2, duration: 2 }] });
    expect(pilot.update(sim.physics.dt).intake).toBe(true);
    for (let i = 0; i < 6 / sim.physics.dt; i++) sim.step(pilot.update(sim.physics.dt));
    expect(Math.hypot(sim.robot.pose.x - goal.x, sim.robot.pose.y - goal.y)).toBeLessThan(.2);
    expect(Math.abs(Math.atan2(Math.sin(sim.robot.pose.yaw - Math.PI / 2), Math.cos(sim.robot.pose.yaw - Math.PI / 2)))).toBeLessThan(.1);
    expect(pilot.update(.1).vx).toBe(0);
  } finally { sim.dispose(); }
});

it('zero-second intake actions keep moving to the next location with intake running', () => {
  const season = SEASONS.find(s => s.id === '2026-rebuilt')!;
  const sim = new HeadlessSim(season, R, { robot: { ...season.robotDefaults, preload: 0 }, alliance: 'blue', pose: { x: 2, y: 2, yaw: 0 } });
  try {
    sim.rules.stage();
    const plan = cleanAutoPlan({ seasonId: season.id, steps: [{ action: 'intake', x: 2.1, y: 2, duration: 0 }, { action: 'drive', x: 3, y: 2, path: [], duration: 0 }] }, season)!;
    expect(plan).toBeDefined();
    const pilot = new PlannedAutoPilot(sim.ctx, sim.rules, sim.robot, season, plan);
    const command = pilot.update(sim.physics.dt);
    expect(command.intake).toBe(true);
    expect(command.vx).toBeGreaterThan(0.5);
  } finally { sim.dispose(); }
});

it('shoot-while-driving paths keep the flag and fire while still travelling', () => {
  const season = SEASONS.find(s => s.id === '2026-rebuilt')!;
  const plan = cleanAutoPlan({ seasonId: season.id, steps: [{ action: 'drive', x: 9, y: 2, path: [{ x: 6, y: 2 }], duration: 2, fire: true }] }, season)!;
  expect(plan.steps[0].fire).toBe(true);
  const sim = new HeadlessSim(season, R, { robot: season.robotDefaults, alliance: 'blue', pose: { x: 2, y: 2, yaw: 0 } });
  try {
    sim.rules.stage(); sim.rules.onPeriodChange(sim.ctx.clock.start());
    const pilot = new PlannedAutoPilot(sim.ctx, sim.rules, sim.robot, season, plan);
    let fired = false;
    for (let i = 0; i < 120; i++) { const c = pilot.update(sim.physics.dt); if (c.shoot && Math.hypot(c.vx, c.vy) > .5) fired = true; sim.step(c); }
    expect(fired).toBe(true);
  } finally { sim.dispose(); }
});
