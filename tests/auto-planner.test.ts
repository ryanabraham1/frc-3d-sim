import { beforeAll, expect, it, vi } from 'vitest';
import { SEASONS } from '../src/seasons';
import { cleanAutoPlan, PlannedAutoPilot, planPoint } from '../src/engine/ai/autoPlan';
import { targetStep } from '../src/app/autoPlanner';
import { HeadlessSim } from '../src/engine/testing/headless';
import { loadRapier, type RapierModule } from '../src/engine/physics/world';
import { LobbyController } from '../src/app/lobby';
import { defaultSettings } from '../src/app/menu';
import type { HostMsg, LobbyState } from '../src/engine/net/protocol';
let R: RapierModule;
beforeAll(async () => { R = await loadRapier(); });
it('rejects malformed, cross-season and invalid target plans', () => {
  const season = SEASONS.find(s => s.year === 2025)!;
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
    if (season.year === 2025) goal.y += .6;
    const pilot = new PlannedAutoPilot(sim.ctx, sim.rules, sim.robot, season, { seasonId: season.id, steps: [{ action: 'drive', ...goal, duration: 2 }] });
    for (let i = 0; i < 4 / sim.physics.dt; i++) sim.step(pilot.update(sim.physics.dt));
    expect(Math.hypot(sim.robot.pose.x - goal.x, sim.robot.pose.y - goal.y)).toBeLessThan(.2);
    expect(pilot.update(.1).vx).toBe(0);
  } finally { sim.dispose(); }
});
it.each(SEASONS.filter(s => s.year !== 2025))('$year planned preload shoots through real scoring physics', season => {
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
  const season = SEASONS.find(s => s.year === 2025)!;
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
  const season = SEASONS.find(s => s.year === 2025)!;
  const sim = new HeadlessSim(season, R, { robot: season.robotDefaults, alliance: 'blue', pose: season.startPose('blue', 2) });
  try {
    sim.rules.stage(); sim.rules.onPeriodChange(sim.ctx.clock.start());
    const pilot = new PlannedAutoPilot(sim.ctx, sim.rules, sim.robot, season, { seasonId: season.id, steps: [targetStep(season, 'reef', 0)] });
    for (let i = 0; i < 12 / sim.physics.dt; i++) { for (const c of sim.ctx.clock.advance(sim.physics.dt)) sim.rules.onPeriodChange(c); sim.step(pilot.update(sim.physics.dt)); }
    expect(season.testing!.goalCount(sim.ctx, 'blue')).toBeGreaterThan(0);
  } finally { sim.dispose(); }
});
it('2024 picks up a chosen wing note and returns to shoot', () => {
  const season = SEASONS.find(s => s.year === 2024)!;
  const sim = new HeadlessSim(season, R, { robot: { ...season.robotDefaults, preload: 0 }, alliance: 'blue', pose: season.startPose('blue', 2) });
  try {
    sim.rules.stage(); sim.rules.onPeriodChange(sim.ctx.clock.start());
    const pilot = new PlannedAutoPilot(sim.ctx, sim.rules, sim.robot, season, { seasonId: season.id, steps: [targetStep(season, 'note', 0), { action: 'shoot', x: 2.6, y: 4.1, duration: 4 }] });
    for (let i = 0; i < 15 / sim.physics.dt; i++) { for (const c of sim.ctx.clock.advance(sim.physics.dt)) sim.rules.onPeriodChange(c); sim.step(pilot.update(sim.physics.dt)); }
    expect(season.testing!.goalCount(sim.ctx, 'blue')).toBeGreaterThan(0);
  } finally { sim.dispose(); }
});
it('2025 takes a real station-fed coral before advancing', () => {
  const season = SEASONS.find(s => s.year === 2025)!;
  const sim = new HeadlessSim(season, R, { robot: { ...season.robotDefaults, preload: 0 }, alliance: 'blue', pose: { x: 2, y: 1.5, yaw: 0 } });
  try {
    sim.ctx.humanPlayerIsAuto = () => true;
    sim.rules.stage(); sim.rules.onPeriodChange(sim.ctx.clock.start());
    const pilot = new PlannedAutoPilot(sim.ctx, sim.rules, sim.robot, season, { seasonId: season.id, steps: [{ ...targetStep(season, 'station', 0), duration: 4 }] });
    for (let i = 0; i < 8 / sim.physics.dt; i++) { for (const c of sim.ctx.clock.advance(sim.physics.dt)) sim.rules.onPeriodChange(c); sim.step(pilot.update(sim.physics.dt)); }
    expect(sim.robot.held.length).toBeGreaterThan(0);
  } finally { sim.dispose(); }
});
