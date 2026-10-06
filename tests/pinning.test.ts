/**
 * PINNING fouls (2024 G420 · 2025 G425 · 2026 G418). The counting rules are tested on synthetic robots; every season
 * is then tested end to end through the real Rapier loop: a robot driven into an opponent that is trapped against the
 * field wall is fouled on the manual's schedule, a shoving match away from the walls is not, and the pinner is told.
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import type { Alliance } from '../src/engine/coords';
import type { SeasonDefinition } from '../src/engine/core/season';
import { Scoreboard } from '../src/engine/match/scoreboard';
import { PIN_RELEASE_GRACE, PIN_SEPARATION, PinTracker, reportPins, type PinAgent, type PinFoul, type PinResult } from '../src/engine/match/pinning';
import { cloneConfig } from '../src/engine/robot/config';
import { IDLE_COMMAND, Robot, type RobotCommand } from '../src/engine/robot/robot';
import { HeadlessSim } from '../src/engine/testing/headless';
import { crescendo2024 } from '../src/seasons/2024-crescendo';
import { reefscape2025 } from '../src/seasons/2025-reefscape';
import { rebuilt2026 } from '../src/seasons/2026-rebuilt';

beforeAll(async () => {
  await RAPIER.init();
});

// ───────────────────────── counting rules, synthetic robots ─────────────────────────

const WALL_AND_ROBOT = [{ nx: 0, ny: 1 }, { nx: 0, ny: -1 }];
const agent = (id: number, alliance: Alliance, over: Partial<PinAgent> = {}): PinAgent => ({
  id, alliance, team: 1000 + id, enabled: true, exempt: false, x: 5, y: 5, halfLength: 0.45,
  speed: 0, turn: 0, commanded: 1.5, commandedTurn: 0, contacts: () => WALL_AND_ROBOT, ...over,
});
/** Red pinner (one contact: the pinned robot) against a blue robot boxed in between it and a wall. */
const pair = (pinned: Partial<PinAgent> = {}, pinner: Partial<PinAgent> = {}) => [
  agent(0, 'red', { x: 5, y: 6, contacts: () => [{ nx: 0, ny: -1 }], ...pinner }),
  agent(1, 'blue', { x: 5, y: 5, ...pinned }),
];
const DT = 0.01;
function runPins(tracker: PinTracker, seconds: number, agents: PinAgent[] | (() => PinAgent[]), touching = () => true) {
  const fouls: (PinFoul & { at: number })[] = [];
  const cues: PinResult['cues'] = [];
  for (let i = 1; i <= Math.round(seconds / DT); i++) {
    const res = tracker.update(DT, typeof agents === 'function' ? agents() : agents, touching);
    fouls.push(...res.fouls.map((f) => ({ ...f, at: i * DT })));
    cues.push(...res.cues);
  }
  return { fouls, cues };
}
const g420 = () => new PinTracker({ rule: 'G420', countSeconds: 5, separation: PIN_SEPARATION });
const g425 = () => new PinTracker({ rule: 'G425', countSeconds: 3, separation: PIN_SEPARATION });

describe('PinTracker — the count', () => {
  it('2024 G420 is a 5-count: MINOR FOUL at 5 s, then a MAJOR FOUL for every further 5 s', () => {
    const t = g420();
    const { fouls } = runPins(t, 16, pair());
    expect(fouls.map((f) => [f.kind, f.rule, f.pinner.id])).toEqual([['minor', 'G420', 0], ['major', 'G420', 0], ['major', 'G420', 0]]);
    expect(fouls.map((f) => Math.round(f.at))).toEqual([5, 10, 15]);
    expect(runPins(g420(), 4.9, pair()).fouls).toHaveLength(0);
  });

  it('2025 G425 / 2026 G418 are 3-counts: MINOR FOUL at 3 s, then a MAJOR FOUL every 3 s', () => {
    const { fouls } = runPins(g425(), 9.5, pair());
    expect(fouls.map((f) => f.kind)).toEqual(['minor', 'major', 'major']);
    expect(fouls.map((f) => Math.round(f.at))).toEqual([3, 6, 9]);
    expect(runPins(g425(), 2.9, pair()).fouls).toHaveLength(0);
  });

  it('fouls the PINNING robot, not the pinned one', () => {
    const [pinner, pinned] = pair();
    const { fouls } = runPins(g425(), 3.2, [pinner, pinned]);
    expect(fouls[0].pinner).toBe(pinner);
    expect(fouls[0].pinned).toBe(pinned);
  });

  for (const [why, pinned] of [
    ['it is not driven (a parked robot is not being prevented from moving)', { commanded: 0 }],
    ['it is still moving', { speed: 1 }],
    ['it is spinning freely', { turn: 3 }],
    ['it is disabled', { enabled: false }],
    ['it is climbing or tipped over', { exempt: true }],
    ['it is only touched on one side (it can back away: blocked or shoved, not boxed in)', { contacts: () => [{ nx: 0, ny: -1 }] }],
    ['its contacts are all on one side', { contacts: () => [{ nx: 0, ny: -1 }, { nx: 0.3, ny: -0.95 }] }],
  ] as [string, Partial<PinAgent>][]) {
    it(`is not a pin when ${why}`, () => {
      expect(runPins(g425(), 8, pair(pinned)).fouls).toHaveLength(0);
    });
  }

  it('is not a pin without contact, or between partners', () => {
    expect(runPins(g425(), 8, pair(), () => false).fouls).toHaveLength(0);
    expect(runPins(g425(), 8, [agent(0, 'blue', { y: 6, contacts: () => [{ nx: 0, ny: -1 }] }), agent(1, 'blue')]).fouls).toHaveLength(0);
  });

  it('can be sandwiched by two opponents, and both are counted', () => {
    const agents = [
      agent(0, 'red', { y: 6, contacts: () => [{ nx: 0, ny: -1 }] }),
      agent(1, 'blue', { y: 5, contacts: () => [{ nx: 0, ny: 1 }, { nx: 0, ny: -1 }] }),
      agent(2, 'red', { y: 4, contacts: () => [{ nx: 0, ny: 1 }] }),
    ];
    const { fouls } = runPins(g425(), 3.2, agents);
    expect(fouls.map((f) => f.pinner.id).sort()).toEqual([0, 2]);
  });

  it('ends (C) when the pinning robot is itself pinned', () => {
    const t = g425();
    const agents = pair({}, { contacts: () => WALL_AND_ROBOT });
    expect(runPins(t, 8, agents).fouls).toHaveLength(0);
  });

  it('keeps counting through a brief escape, but starts over after a real one', () => {
    const pinned = agent(1, 'blue');
    const pinner = agent(0, 'red', { y: 6, contacts: () => [{ nx: 0, ny: -1 }] });
    const held = () => { pinned.speed = 0; pinned.commanded = 1.5; pinned.contacts = () => WALL_AND_ROBOT; return [pinner, pinned]; };
    const free = () => { pinned.speed = 1.5; pinned.contacts = () => [{ nx: 0, ny: 1 }]; return [pinner, pinned]; };
    const t = g425();
    expect(runPins(t, 2, held).fouls).toHaveLength(0);
    runPins(t, PIN_RELEASE_GRACE * 0.5, free);
    expect(runPins(t, 1.1, held).fouls).toHaveLength(1); // 2 s + 1.1 s of holding ≥ 3 s

    const t2 = g425();
    runPins(t2, 2, held);
    runPins(t2, PIN_RELEASE_GRACE + 0.5, free);
    expect(runPins(t2, 2, held).fouls).toHaveLength(0); // started over: only 2 s counted
    expect(t2.countFor(0)).toBeCloseTo(2, 1);
  });

  it('recognizes a pin even when the trapped opponent moves a little', () => {
    expect(runPins(g425(), 3.2, pair({ speed: 0.4, turn: 0.8 })).fouls).toHaveLength(1);
  });

  it('keeps counting when a trapped opponent slides or twists without escaping', () => {
    const t = g425();
    const agents = pair();
    runPins(t, 1, agents);
    agents[1].speed = 0.7;
    agents[1].turn = 1.5;
    agents[1].x += 0.1;
    expect(runPins(t, 2.2, agents).fouls.map((f) => f.kind)).toEqual(['minor']);
    expect(t.countFor(0)).toBeCloseTo(3.2, 1);
    expect(runPins(t, 3, agents).fouls.map((f) => f.kind)).toEqual(['major']);
  });

  it('pauses while the robots are 6 ft apart, resumes when they return, ends after a full count apart', () => {
    const pinned = agent(1, 'blue');
    const pinner = agent(0, 'red', { y: 6, contacts: () => [{ nx: 0, ny: -1 }] });
    const held = () => { pinner.y = 6; return [pinner, pinned]; };
    // Apart: far enough that the bumper gap exceeds 6 ft. (Contact is faked so the count's own rules are isolated.)
    const apart = () => { pinner.y = 5 + PIN_SEPARATION + 0.9 + 0.1; return [pinner, pinned]; };

    const t = g425();
    runPins(t, 2, held);
    runPins(t, 2, apart); // paused: 2 s apart is under the 3 s count
    expect(t.countFor(0)).toBeCloseTo(2, 1);
    expect(runPins(t, 1.1, held).fouls).toHaveLength(1); // resumes at 2 s: foul after another second

    const t2 = g425();
    runPins(t2, 2, held);
    runPins(t2, 3.2, apart); // apart for longer than the count: the pin is over
    expect(t2.countFor(0)).toBe(0);
  });

  it('ends (B) when a robot is moved 6 ft from where the pin began for longer than the count', () => {
    const pinned = agent(1, 'blue');
    const pinner = agent(0, 'red', { y: 6, contacts: () => [{ nx: 0, ny: -1 }] });
    const t = g425();
    runPins(t, 2, [pinner, pinned]);
    pinned.x += PIN_SEPARATION + 0.1;
    pinner.x += PIN_SEPARATION + 0.1; // both dragged along, still touching
    expect(runPins(t, 3.2, [pinner, pinned]).fouls).toHaveLength(0); // paused, then ended: no foul even after 5 s total
    expect(runPins(t, 2, [pinner, pinned]).fouls).toHaveLength(0); // a fresh pin: only 2 s
  });

  it('tells the pinner it is pinning from the start, and keeps refreshing the cue', () => {
    const { cues } = runPins(g425(), 3.2, pair());
    expect(cues[0].seconds).toBeLessThan(0.45);
    expect(cues.length).toBeGreaterThanOrEqual(10);
    expect(cues.every((c) => c.pinner.id === 0 && c.pinned.id === 1)).toBe(true);
    expect(cues[cues.length - 1].fouls).toBe(1);
    expect(runPins(g425(), 3, pair({ commanded: 0 })).cues).toHaveLength(0);
  });
});

describe('reportPins', () => {
  it('assesses the foul to the pinner, credits the opponent, and cues the pinner on screen', () => {
    const score = new Scoreboard({ minor: 2, major: 5 });
    const toasts: string[] = [];
    const cues: [number, string, string | undefined][] = [];
    const robots = [{ id: 0, config: { teamNumber: 1000 } }, { id: 1, config: { teamNumber: 1001 } }] as unknown as Robot[];
    const ctx = { score, robots, toast: (m: string) => void toasts.push(m), cue: (r: Robot, text: string, cls?: string) => void cues.push([r.id, text, cls]) };
    const tracker = g420();
    for (let i = 0; i < 5.2 / DT; i++) reportPins(tracker.update(DT, pair(), () => true), ctx, i * DT);
    expect(score.fouls).toEqual([expect.objectContaining({ alliance: 'red', kind: 'minor', rule: 'G420', robotId: 0, note: 'pinned 1001' })]);
    expect(score.foulPointsFor('blue')).toBe(2);
    expect(toasts.some((m) => m.includes('G420') && m.includes('MINOR FOUL') && m.includes('1000 pinned 1001'))).toBe(true);
    expect(cues[0]).toEqual([0, expect.stringContaining('PINNING 1001'), 'pin']);
    expect(cues.some(([, , cls]) => cls === 'pin danger')).toBe(true);
    expect(cues[cues.length - 1][1]).toContain('RELEASE NOW');
  });
});

// ───────────────────────── every season, through the real physics ─────────────────────────

const sims: HeadlessSim[] = [];
afterEach(() => {
  for (const s of sims.splice(0)) s.dispose();
});

/** `x`: a stretch of wall (and open carpet in front of it) clear of field elements in that season. */
const SEASONS: { season: SeasonDefinition; rule: string; count: number; x: number }[] = [
  { season: crescendo2024, rule: 'G420', count: 5, x: 8.27 },
  { season: reefscape2025, rule: 'G425', count: 3, x: 3 },
  { season: rebuilt2026, rule: 'G418', count: 3, x: 8.27 },
];

/**
 * Blue (driven at 3 m/s) pushes red, which is driven back at blue. With `wall`, red sits against the field wall and is
 * overpowered (it only asks for 0.5 m/s), so it is held between blue and the wall. Without, both push equally hard
 * mid-field: a shoving match, nobody trapped.
 */
function scenario(season: SeasonDefinition, rule: string, x: number, wall: boolean, started = true) {
  const y = wall ? 0.5 : season.fieldWidth / 2;
  const cfg = () => cloneConfig(season.robotDefaults);
  const sim = new HeadlessSim(season, RAPIER, { robot: cfg(), alliance: 'blue', pose: { x, y: y + 1.5, yaw: -Math.PI / 2 } });
  sims.push(sim);
  const red = new Robot(sim.physics, sim.ctx.scene, sim.frame, cfg(), 'red', 1, 2, { x, y, yaw: Math.PI / 2 });
  sim.ctx.robots.push(red);
  const cues: { text: string; cls?: string; robot: number }[] = [];
  const toasts: string[] = [];
  sim.ctx.cue = (r, text, cls) => void cues.push({ text, cls, robot: r.id });
  sim.ctx.toast = (m) => void toasts.push(m);
  if (started) {
    sim.rules.onPeriodChange(sim.ctx.clock.start());
    // Into TELEOP: the pin rules apply all match long, but this is where drivers drive.
    for (let i = 0; i < 100000 && sim.ctx.clock.mode !== 'teleop'; i++) for (const ch of sim.ctx.clock.advance(sim.physics.dt)) sim.rules.onPeriodChange(ch);
  }
  const dt = sim.physics.dt;
  const redCmd: RobotCommand = { ...IDLE_COMMAND, vy: wall ? 0.5 : 3 };
  const blueCmd: RobotCommand = { ...IDLE_COMMAND, vy: -3 };
  const run = (seconds: number) => {
    for (let i = 0; i < Math.round(seconds / dt); i++) {
      for (const ch of sim.ctx.clock.advance(dt)) sim.rules.onPeriodChange(ch);
      red.enabled = true;
      red.lastCommand = redCmd;
      red.drive(redCmd, dt);
      red.tick(dt);
      sim.step(blueCmd);
    }
  };
  const pinFouls = () => sim.ctx.score.fouls.filter((f) => f.rule === rule);
  return { sim, red, run, cues, toasts, pinFouls };
}

describe.each(SEASONS)('$season.year pinning ($rule)', ({ season, rule, count, x }) => {
  it(`fouls a robot that holds an opponent against the wall: MINOR after ${count} s, MAJOR ${count} s later`, () => {
    const s = scenario(season, rule, x, true);
    s.run(1);
    // The setup really is a pin: red is stopped, driven, and squeezed against the wall.
    expect(s.red.speed).toBeLessThan(0.25);
    expect(s.red.pose.y).toBeLessThan(0.9);
    s.run(count - 1.5);
    expect(s.pinFouls()).toHaveLength(0);
    s.run(2.2);
    expect(s.pinFouls()).toEqual([expect.objectContaining({ alliance: 'blue', kind: 'minor', rule, robotId: 0 })]);
    s.run(count);
    expect(s.pinFouls().map((f) => f.kind)).toEqual(['minor', 'major']);
    expect(s.sim.ctx.score.foulPointsFor('red')).toBe(season.foulValues.minor + season.foulValues.major);
    expect(s.toasts.some((m) => m.includes(rule))).toBe(true);
  });

  it('tells the pinning driver straight away, with a countdown that turns into an alarm', () => {
    const s = scenario(season, rule, x, true);
    s.run(2);
    expect(s.cues.length).toBeGreaterThan(0);
    expect(s.cues.every((c) => c.robot === 0)).toBe(true); // only the pinner is told
    expect(s.cues[0].text).toMatch(/^PINNING \d+ /);
    expect(s.cues[0].cls).toBe('pin');
    s.run(count);
    expect(s.cues.some((c) => c.cls === 'pin danger')).toBe(true);
    expect(s.cues[s.cues.length - 1].text).toContain('RELEASE NOW');
  });

  it('does not foul a shoving match away from the walls, and says nothing', () => {
    const s = scenario(season, rule, x, false);
    s.run(count + 0.5);
    expect(s.pinFouls()).toHaveLength(0);
    expect(s.cues).toHaveLength(0);
  });

  it('does not foul when the trapped robot is not being driven', () => {
    const s = scenario(season, rule, x, true);
    s.run(0.5);
    const dt = s.sim.physics.dt;
    for (let i = 0; i < Math.round((count + 1) / dt); i++) {
      for (const ch of s.sim.ctx.clock.advance(dt)) s.sim.rules.onPeriodChange(ch);
      s.red.enabled = true;
      s.red.lastCommand = IDLE_COMMAND;
      s.red.drive(IDLE_COMMAND, dt);
      s.red.tick(dt);
      s.sim.step({ ...IDLE_COMMAND, vy: -3 });
    }
    expect(s.pinFouls()).toHaveLength(0);
  });

  it('does not count pins before the match starts', () => {
    const s = scenario(season, rule, x, true, false);
    s.run(count + 1);
    expect(s.pinFouls()).toHaveLength(0);
    expect(s.cues).toHaveLength(0);
  });
});
