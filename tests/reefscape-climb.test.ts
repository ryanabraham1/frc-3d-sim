import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import type { Alliance } from '../src/engine/coords';
import { HeadlessSim } from '../src/engine/testing/headless';
import { bodyState, restoreBody } from '../src/engine/net/recovery';
import { IDLE_COMMAND } from '../src/engine/robot/robot';
import { cloneConfig, type RobotConfig } from '../src/engine/robot/config';
import { reefscape2025 as season } from '../src/seasons/2025-reefscape';
import { ReefscapeRules } from '../src/seasons/2025-reefscape/rules';
import { normalizeReefscapeConfig } from '../src/seasons/2025-reefscape/config';
import * as C from '../src/seasons/2025-reefscape/constants';

/** Physical CAGE climbs: climbers latch onto the swinging cage with a joint, winch up, and swing when hit. */
const sims: HeadlessSim[] = [];
beforeAll(async () => { await RAPIER.init(); });
afterEach(() => { for (const sim of sims.splice(0)) sim.dispose(); });

function run(sim: HeadlessSim, seconds: number) {
  for (let n = 0; n < Math.round(seconds / sim.physics.dt); n++) {
    for (const change of sim.ctx.clock.advance(sim.physics.dt)) sim.rules.onPeriodChange(change);
    sim.step(IDLE_COMMAND);
  }
}
/** A robot in front of its alliance's middle cage, in TELEOP, at the approach pose the bots use. */
function atCage(config: RobotConfig, a: Alliance = 'blue', slot = 1) {
  const p = C.cage(a, slot + 1);
  const sim = new HeadlessSim(season, RAPIER, { robot: config, alliance: a, station: 2, pose: { x: p.x - Math.cos(C.sideYaw(a, 0)) * 0.75, y: p.y, yaw: C.sideYaw(a, 0) } });
  sims.push(sim);
  sim.rules.onPeriodChange(sim.ctx.clock.start()); for (const c of sim.ctx.clock.advance(18)) sim.rules.onPeriodChange(c);
  const rules = sim.rules as ReefscapeRules;
  const approach = rules.climbApproach(sim.robot)!;
  sim.robot.resetTo(approach);
  return { sim, rules, cage: rules.refs.cages[a][slot], pivot: p };
}
const deep = (grip?: 'rollers' | 'hooks') => { const c = cloneConfig(season.robotDefaults); c.climber.maxLevel = 2; if (grip) c.climber.grip = grip; return normalizeReefscapeConfig(c); };
const team = (id: string) => normalizeReefscapeConfig(cloneConfig(season.teamRobots!.find((t) => t.id === id)!.config));
/** Seconds from the climb request until the robot is hanging. */
function timeToHang(sim: HeadlessSim, rules: ReefscapeRules): number {
  rules.requestClimb(sim.robot, sim.robot.config.climber.maxLevel);
  for (let t = 0; t < 10; t += sim.physics.dt) { run(sim, sim.physics.dt); if (sim.robot.climbPhase === 'hanging') return t; }
  return Infinity;
}
const yawOf = (q: { x: number; y: number; z: number; w: number }) => Math.atan2(2 * (q.w * q.y + q.x * q.z), 1 - 2 * (q.y * q.y + q.x * q.x));

describe('2025 physical cage climb', () => {
  for (const a of ['blue', 'red'] as const) for (const grip of ['rollers', 'hooks'] as const) it(`${a} ${grip}: catches the pipe, winches up off the carpet and hangs from the swinging cage`, () => {
    const { sim, rules, cage } = atCage(deep(grip), a);
    rules.requestClimb(sim.robot, 2);
    run(sim, 0.05);
    expect(sim.robot.climbPhase).toBe('align');
    expect(sim.robot.body.isDynamic()).toBe(true); // drives on: no kinematic glide
    run(sim, 7);
    expect(sim.robot.climbPhase).toBe('hanging');
    expect(sim.robot.grip?.latched).toBe(true);
    expect(sim.robot.elevation).toBeGreaterThan(0.2);
    expect(cage.isHeld).toBe(false); // the cage stays a free pendulum, carrying the robot
    // Climbers rotate the cage over the chassis: the robot hangs near level (< 10°).
    const q = sim.robot.body.rotation();
    expect(Math.acos(1 - 2 * (q.x * q.x + q.z * q.z))).toBeLessThan(0.18);
  });

  it('a hanging robot swings with its cage when hit, stays latched, and settles', () => {
    const { sim, rules, cage } = atCage(deep());
    rules.requestClimb(sim.robot, 2); run(sim, 7);
    const before = sim.ctx.frame.toField(sim.robot.body.translation()), cageBefore = cage.fieldPosition();
    sim.robot.body.applyImpulse(sim.ctx.frame.velToWorld(0, 60, 0), true); // a 60 N·s side hit
    let maxSwing = 0, maxCage = 0;
    for (let k = 0; k < 90; k++) {
      run(sim, 1 / 90);
      const r = sim.ctx.frame.toField(sim.robot.body.translation()), c = cage.fieldPosition();
      maxSwing = Math.max(maxSwing, Math.hypot(r.x - before.x, r.y - before.y));
      maxCage = Math.max(maxCage, Math.hypot(c.x - cageBefore.x, c.y - cageBefore.y));
    }
    expect(maxSwing).toBeGreaterThan(0.1);
    expect(maxCage).toBeGreaterThan(0.1); // the cage swings with it
    expect(sim.robot.climbPhase).toBe('hanging');
    run(sim, 6);
    const v = sim.robot.body.linvel();
    expect(Math.hypot(v.x, v.y, v.z)).toBeLessThan(0.1);
    expect(sim.robot.elevation).toBeGreaterThan(0.2);
    rules.onPeriodChange({ from: season.timeline.at(-1)!, to: null, at: 156 });
    expect(sim.ctx.score.category('blue', 'barge')).toBe(12);
  });

  it('a roller claw lets the robot twist around its one pipe; hooks across two pipes do not', () => {
    const twist = (grip: 'rollers' | 'hooks') => {
      const { sim, rules, cage } = atCage(deep(grip));
      rules.requestClimb(sim.robot, 2); run(sim, 7);
      const rel = () => yawOf(sim.robot.body.rotation()) - yawOf(cage.body.rotation());
      const r0 = rel();
      sim.robot.body.applyTorqueImpulse({ x: 0, y: 25, z: 0 }, true);
      let max = 0;
      for (let k = 0; k < 60; k++) { run(sim, 1 / 90); max = Math.max(max, Math.abs(rel() - r0)); }
      return max;
    };
    const rollers = twist('rollers'), hooks = twist('hooks');
    expect(rollers).toBeGreaterThan(0.08);
    expect(rollers).toBeGreaterThan(hooks * 2);
  });

  it('climb speed follows the team: 254 and 2910 hang well before a stock 3.6 s winch', () => {
    const stock = atCage(deep()), t254 = atCage(team('undertow-254')), t2910 = atCage(team('spectre-2910'));
    const slow = timeToHang(stock.sim, stock.rules), fast254 = timeToHang(t254.sim, t254.rules), fast2910 = timeToHang(t2910.sim, t2910.rules);
    expect(fast254).toBeLessThan(2.5);
    expect(fast2910).toBeLessThan(2.5);
    expect(slow).toBeGreaterThan(fast254 + 2);
    expect(slow).toBeGreaterThan(fast2910 + 2);
  });

  for (const t of season.teamRobots!.filter((t) => t.config.climber.maxLevel > 0)) for (const a of ['blue', 'red'] as const) it(`${a} ${t.id}: its configured grabber reaches the cage and hangs`, () => {
    const { sim, rules } = atCage(team(t.id), a);
    rules.requestClimb(sim.robot, sim.robot.config.climber.maxLevel);
    run(sim, 10);
    expect(sim.robot.climbPhase).toBe('hanging');
    expect(sim.robot.grip?.latched).toBe(true);
    expect(sim.robot.elevation).toBeGreaterThan(0.08);
  });

  it('a disabled robot keeps hanging at the end of the match (the winch ratchet holds)', () => {
    const { sim, rules } = atCage(deep());
    rules.requestClimb(sim.robot, 2); run(sim, 7);
    sim.robot.enabled = false; run(sim, 3);
    expect(sim.robot.climbPhase).toBe('hanging');
    expect(sim.robot.elevation).toBeGreaterThan(0.2);
  });

  it('gives up when the cage is out of reach and drives normally again', () => {
    const { sim, rules, cage } = atCage(deep());
    rules.requestClimb(sim.robot, 2);
    const away = sim.ctx.frame.toWorld(C.cage('blue', 2).x + 1, C.cage('blue', 2).y + 1, C.CAGE_BOTTOM.deep);
    cage.body.setTranslation(away, true);
    cage.hold(C.cage('blue', 2).x + 1, C.cage('blue', 2).y + 1, C.CAGE_BOTTOM.deep); // swung away and held there
    run(sim, 4);
    expect(sim.robot.climbPhase).toBe('none');
    expect(sim.robot.grip).toBeNull();
  });

  it('cannot latch onto a cage swung above the grabber', () => {
    const { sim, rules, cage } = atCage(deep());
    rules.requestClimb(sim.robot, 2);
    const p = cage.fieldPosition();
    cage.body.setTranslation(sim.ctx.frame.toWorld(p.x, p.y, p.z + 0.4), true);
    cage.hold(p.x, p.y, p.z + 0.4);
    run(sim, 4);
    expect(sim.robot.grip).toBeNull();
    expect(sim.robot.climbPhase).toBe('none');
  });

  for (const a of ['blue', 'red'] as const) for (const level of [1, 2]) it(`${a} level ${level}: lowers onto its wheels, releases the cage and drives away`, () => {
    const config = deep(); config.climber.maxLevel = level;
    const { sim, rules, cage } = atCage(config, a);
    rules.requestClimb(sim.robot, level); run(sim, 7);
    expect(sim.robot.climbPhase).toBe('hanging');
    expect(sim.robot.elevation).toBeGreaterThan(level === 1 ? 0.08 : 0.2);
    rules.requestDescend(sim.robot); run(sim, 6);
    expect(sim.robot.climbPhase).toBe('none');
    expect(sim.robot.grip).toBeNull();
    expect(cage.body.isDynamic()).toBe(true);
    expect(sim.robot.elevation).toBeLessThan(0.03);
    const before = sim.robot.pose.x;
    for (let i = 0; i < 90; i++) sim.step({ ...IDLE_COMMAND, vx: a === 'blue' ? -1 : 1 });
    expect(Math.abs(sim.robot.pose.x - before)).toBeGreaterThan(0.3);
  });

  for (const elapsed of [0.15, 1.5, 7]) it(`rebuilds the grip in a new world from a ${elapsed} s recovery snapshot`, () => {
    const { sim, rules } = atCage(deep());
    rules.requestClimb(sim.robot, 2); run(sim, elapsed);
    const robotState = sim.robot.recoveryState(), body = bodyState(sim.robot.body);
    const state = JSON.parse(JSON.stringify(rules.recoveryState()));
    const backup = atCage(deep());
    // Same restore ordering as Game.restoreRecovery: rules/joints first, then robot bodies and fields.
    backup.rules.restoreRecovery(state);
    restoreBody(backup.sim.robot.body, body); backup.sim.robot.restoreRecovery(robotState);
    expect(backup.sim.robot.grip?.latched).toBe(true);
    run(backup.sim, 7);
    expect(backup.sim.robot.climbPhase).toBe('hanging');
    expect(backup.sim.robot.elevation).toBeGreaterThan(0.2);
    backup.rules.requestDescend(backup.sim.robot); run(backup.sim, 6);
    expect(backup.sim.robot.grip).toBeNull();
    expect(backup.sim.robot.elevation).toBeLessThan(0.03);
  });
});
