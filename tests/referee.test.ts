/**
 * The head referee: calls a human referee would make from what the robots did, through the real Rapier loop.
 * 2026 REBUILT first (G420 TOWER protection, G403 contact, G416 ramming, G417 tipping, G419 blockade, G404/G405 FUEL,
 * G408 catching), with cards.
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { cloneConfig } from '../src/engine/robot/config';
import { IDLE_COMMAND, Robot, type RobotCommand } from '../src/engine/robot/robot';
import { HeadlessSim } from '../src/engine/testing/headless';
import { rebuilt2026 } from '../src/seasons/2026-rebuilt';
import type { RebuiltRules } from '../src/seasons/2026-rebuilt/rules';

beforeAll(async () => {
  await RAPIER.init();
});
const sims: HeadlessSim[] = [];
afterEach(() => {
  for (const s of sims.splice(0)) s.dispose();
});

/** Blue (the driven robot) and red on the 2026 field, the clock fast-forwarded to the start of `period`. */
function scene(period: string, blue: { x: number; y: number; yaw: number }, red: { x: number; y: number; yaw: number }) {
  const season = rebuilt2026;
  const cfg = () => cloneConfig(season.robotDefaults);
  const sim = new HeadlessSim(season, RAPIER, { robot: cfg(), alliance: 'blue', pose: blue });
  sims.push(sim);
  const r = new Robot(sim.physics, sim.ctx.scene, sim.frame, cfg(), 'red', 1, 2, red);
  sim.ctx.robots.push(r);
  const toasts: string[] = [];
  sim.ctx.toast = (m) => void toasts.push(m);
  sim.rules.onPeriodChange(sim.ctx.clock.start());
  const dt = sim.physics.dt;
  for (let i = 0; i < 1e6 && sim.ctx.clock.current.id !== period; i++) for (const ch of sim.ctx.clock.advance(dt * 20)) sim.rules.onPeriodChange(ch);
  const fouls = (rule?: string) => sim.ctx.score.fouls.filter((f) => !rule || f.rule === rule);
  const run = (seconds: number, redCmd: RobotCommand, blueCmd: RobotCommand = IDLE_COMMAND) => {
    for (let i = 0; i < Math.round(seconds / dt); i++) {
      for (const ch of sim.ctx.clock.advance(dt)) sim.rules.onPeriodChange(ch);
      r.enabled = true;
      r.lastCommand = redCmd;
      r.drive(redCmd, dt);
      r.tick(dt);
      sim.step(blueCmd);
    }
  };
  return { sim, blue: sim.robot, red: r, run, fouls, toasts, rules: sim.rules as RebuiltRules };
}

describe('2026 G420 TOWER protection', () => {
  // Blue is parked against its own TOWER (x < 1.2); red drives into it from the field.
  const at = { x: 1.55, y: 3.75, yaw: Math.PI };
  const rush: RobotCommand = { ...IDLE_COMMAND, vx: -2 };

  it('calls MAJOR FOUL on a robot that contacts an opponent at its TOWER in the last 30 s', () => {
    const s = scene('endgame', at, { x: 3.2, y: 3.75, yaw: Math.PI });
    s.run(2, rush);
    const f = s.fouls('G420');
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ alliance: 'red', kind: 'major', robotId: 1 });
    expect(s.toasts.some((m) => m.includes('G420') && m.includes('MAJOR FOUL'))).toBe(true);
    expect(s.sim.ctx.score.foulPointsFor('blue')).toBeGreaterThanOrEqual(rebuilt2026.foulValues.major);
  });

  it('calls it once per contact, not every step', () => {
    const s = scene('endgame', at, { x: 3.2, y: 3.75, yaw: Math.PI });
    s.run(4, rush);
    expect(s.fouls('G420')).toHaveLength(1);
  });

  it('does not call it before the last 30 seconds', () => {
    const s = scene('shift4', at, { x: 3.2, y: 3.75, yaw: Math.PI });
    s.run(2, rush);
    expect(s.fouls('G420')).toHaveLength(0);
  });

  it('does not call it for contact with a robot that is away from its TOWER', () => {
    const s = scene('endgame', { x: 5, y: 3.75, yaw: Math.PI }, { x: 6.5, y: 3.75, yaw: Math.PI });
    s.run(2, rush);
    expect(s.fouls('G420')).toHaveLength(0);
  });

  it('awards LEVEL 3 when the protected robot is off the ground', () => {
    const s = scene('endgame', { x: 1.9, y: 3.75, yaw: Math.PI }, { x: 4, y: 3.75, yaw: Math.PI });
    s.rules.requestClimb(s.blue, 1);
    s.run(4, IDLE_COMMAND);
    expect(s.blue.climbPhase).toBe('hanging');
    const p = s.blue.pose;
    // The climbing robot is off the carpet: red reaches it.
    s.red.resetTo({ x: p.x + 1.4, y: p.y, yaw: Math.PI });
    s.run(3, rush);
    expect(s.fouls('G420').length).toBeGreaterThanOrEqual(1);
    expect(s.fouls('G420')[0].note).toContain('LEVEL 3');
  });
});

describe('cards', () => {
  it('a second yellow card is recorded as red and the robot keeps driving', () => {
    const s = scene('shift2', { x: 8.27, y: 3.5, yaw: -Math.PI / 2 }, { x: 8.27, y: 0.5, yaw: Math.PI / 2 });
    const ref = s.rules.ref;
    ref.call({ rule: 'G417', kind: 'major', card: 'yellow', robot: s.blue, note: 'x' });
    ref.call({ rule: 'G417', kind: 'major', card: 'yellow', robot: s.blue, note: 'y' });
    expect(s.sim.ctx.score.fouls.map((f) => f.card)).toEqual(['yellow', 'red']);
    const startX = s.blue.pose.x;
    s.run(0.5, IDLE_COMMAND, { ...IDLE_COMMAND, vx: 3 });
    expect(s.blue.enabled).toBe(true);
    expect(s.blue.pose.x).toBeGreaterThan(startX + 0.1);
  });
  it('a direct red card keeps foul points and allows the robot to keep driving', () => {
    const s = scene('shift2', { x: 8.27, y: 3.5, yaw: -Math.PI / 2 }, { x: 8.27, y: 0.5, yaw: Math.PI / 2 });
    s.rules.ref.call({ rule: 'G417', kind: 'major', card: 'red', robot: s.blue, note: 'continued pushing' });
    expect(s.sim.ctx.score.cardsFor(s.blue.id, 'red')).toBe(1);
    expect(s.sim.ctx.score.foulPointsFor('red')).toBe(rebuilt2026.foulValues.major);
    const startX = s.blue.pose.x;
    s.run(0.5, IDLE_COMMAND, { ...IDLE_COMMAND, vx: 3 });
    expect(s.blue.enabled).toBe(true);
    expect(s.blue.pose.x).toBeGreaterThan(startX + 0.1);
  });
  it('2026 does not call ramming (G416)', () => {
    const s = scene('shift2', { x: 8.27, y: 3.5, yaw: -Math.PI / 2 }, { x: 8.27, y: 0.5, yaw: Math.PI / 2 });
    s.run(3, IDLE_COMMAND, { ...IDLE_COMMAND, vy: -6 });
    expect(s.fouls('G416')).toHaveLength(0);
  });
});

describe('2026 G403 contact across the CENTER LINE', () => {
  it('adds a MAJOR FOUL for each contact with an opponent after crossing in AUTO', () => {
    const s = scene('auto', { x: 8.2, y: 2, yaw: 0 }, { x: 10.5, y: 2, yaw: Math.PI });
    s.run(2, { ...IDLE_COMMAND, vx: -1.5 }, { ...IDLE_COMMAND, vx: 1.5 });
    expect(s.fouls('G403').length).toBeGreaterThanOrEqual(2); // crossing + contact
    expect(s.fouls('G403').some((f) => f.note?.includes('contacted'))).toBe(true);
  });
});

describe('2026 G417 tipping', () => {
  /** Blue drives into red; red is levered over (as if wedged) after `tipAt` seconds. */
  function tip(tipAt: number, blueDrive: boolean) {
    const s = scene('shift2', { x: 8.27, y: 3.2, yaw: -Math.PI / 2 }, { x: 8.27, y: 2.5, yaw: Math.PI / 2 });
    const dt = s.sim.physics.dt;
    for (let i = 0; i < Math.round(1.6 / dt); i++) {
      const t = i * dt;
      const a = t < tipAt ? 0 : Math.min(1.8, (t - tipAt) * 3);
      s.red.body.setRotation({ x: Math.sin(a / 2), y: 0, z: 0, w: Math.cos(a / 2) }, true);
      s.run(dt, IDLE_COMMAND, blueDrive ? { ...IDLE_COMMAND, vy: -2 } : IDLE_COMMAND);
    }
    return s;
  }
  it('calls it when the attacker keeps driving into a robot that has started to tip', () => {
    const s = tip(0.4, true);
    expect(s.red.tippedOver).toBe(true);
    expect(s.fouls('G417')[0]).toMatchObject({ alliance: 'blue', kind: 'major', card: 'yellow' });
  });
  it('does not call a robot that tips with nobody on it', () => {
    const s = tip(0.4, false);
    expect(s.fouls('G417')).toHaveLength(0);
  });
});

describe('2026 FUEL calls', () => {
  it('G408: one FUEL caught is a MINOR FOUL; sitting under the HUB for 3+ is MAJOR, then MAJOR + YELLOW', () => {
    const s = scene('shift2', { x: 8.27, y: 2, yaw: 0 }, { x: 8.27, y: 6, yaw: 0 });
    const drops = (s.rules as unknown as { hubDrops: Map<number, { t: number; grounded: boolean }> }).hubDrops;
    const take = (n: number) => {
      for (const i of s.sim.pool.indices('reserve').slice(0, n)) {
        drops.set(i, { t: s.sim.ctx.clock.elapsed, grounded: false });
        s.sim.pool.hold(i, s.blue.id);
        s.blue.held.push(i);
      }
      s.run(0.05, IDLE_COMMAND);
    };
    take(1);
    s.run(1.5, IDLE_COMMAND);
    expect(s.fouls('G408').map((f) => f.kind)).toEqual(['minor']);
    take(3);
    expect(s.fouls('G408').map((f) => f.kind)).toEqual(['minor', 'major']);
    expect(s.fouls('G408')[1].card).toBeUndefined();
    s.run(2, IDLE_COMMAND);
    take(3);
    expect(s.fouls('G408')[2]).toMatchObject({ kind: 'major', card: 'yellow' });
  });
});

describe('2026 G419 collusion', () => {
  it('calls MAJOR FOUL after 3 s of two partners blockading, then every 3 s', () => {
    const s = scene('shift2', { x: 8.27, y: 2, yaw: 0 }, { x: 8.27, y: 6, yaw: 0 });
    const ref = s.rules.ref;
    for (let i = 0; i < Math.round(6.2 / s.sim.physics.dt); i++) {
      for (const ch of s.sim.ctx.clock.advance(s.sim.physics.dt)) s.rules.onPeriodChange(ch);
      ref.blockade(s.sim.physics.dt, 'x', [s.blue, s.red], 'blocked the TOWER');
    }
    expect(s.fouls('G419')).toHaveLength(2);
  });
});
