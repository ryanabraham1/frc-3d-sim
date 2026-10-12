import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { SEASONS } from '../src/seasons';
import { cloneConfig, type RobotConfig } from '../src/engine/robot/config';
import { HeadlessSim } from '../src/engine/testing/headless';
import { IDLE_COMMAND } from '../src/engine/robot/robot';
import * as C from '../src/seasons/2026-rebuilt/constants';
import { loadCad2026 } from './helpers/cad2026';

const season = SEASONS.find((s) => s.id === '2026-rebuilt')!;
const sims: HeadlessSim[] = [];
beforeAll(async () => { await RAPIER.init(); await loadCad2026(); }); // real CAD hoods, as in the browser
afterEach(() => { for (const sim of sims.splice(0)) sim.dispose(); });

const ARM_NEAR = C.HUB_CENTER.x - C.TRENCH_ARM_DEPTH / 2;

function sim(config: RobotConfig = season.robotDefaults, x = C.HUB_CENTER.x - 2.2, mechHopper = false): HeadlessSim {
  const s = new HeadlessSim(season, RAPIER, { robot: cloneConfig(config), alliance: 'blue', pose: { x, y: C.TRENCH_OPENING_CENTER_Y, yaw: 0 }, mechHopper });
  sims.push(s);
  s.robot.held.length = 0;
  return s;
}
const team = (n: number) => season.teamRobots!.find((t) => t.team === n)!.config;

/**
 * The hood collider (a skirt) has exactly the drawn hood's x/z footprint and top in the chassis frame; it is carried down
 * to the floor so the arm's push comes at wheel height.
 */
function expectColliderMatchesHood(s: HeadlessSim): void {
  const b = s.robot.hoodBounds(true)!, c = s.robot.hoodColliderBox()!;
  expect(c).not.toBeNull();
  for (const k of ['x', 'z'] as const) {
    expect(c.min[k]).toBeCloseTo(b.min[k], 2);
    expect(c.max[k]).toBeCloseTo(b.max[k], 2);
  }
  expect(c.max.y).toBeCloseTo(b.max.y, 2);
  expect(c.min.y).toBeLessThan(0.1);
}

/** Shoot with the hood up and drive at the arm until the hood stops the robot. */
function driveIntoArm(s: HeadlessSim): void {
  s.run(1.8, { ...IDLE_COMMAND, shoot: true });
  s.run(4, { ...IDLE_COMMAND, shoot: true, vx: 2.5 });
}

describe('a raised shooter hood blocks at the TRENCH', () => {
  it('the drawn hood is parked below the arm and opens above it while shooting', () => {
    const s = sim();
    s.run(0.4, { ...IDLE_COMMAND });
    expect(s.robot.hoodTop).toBeLessThan(C.TRENCH_SAFE_HEIGHT);
    s.run(1.5, { ...IDLE_COMMAND, shoot: true });
    expect(s.robot.hoodTop).toBeGreaterThan(C.TRENCH_CLEARANCE + 0.03);
    expect(s.robot.hoodColliderBox()).toBeNull(); // away from the arm the hood collides with nothing
    s.run(4, { ...IDLE_COMMAND, shoot: true, vx: 2.5 });
    expectColliderMatchesHood(s); // at the arm it is exactly the drawn hood
  });

  it('a robot with its hood raised cannot drive under the TRENCH', () => {
    const s = sim();
    s.run(1.5, { ...IDLE_COMMAND, shoot: true });
    s.run(4, { ...IDLE_COMMAND, shoot: true, vx: 2.5 });
    expect(s.robot.pose.x).toBeLessThan(ARM_NEAR);
    // It stopped because the drawn hood touches the arm, not before and not past it, and it did not tip.
    const hood = s.robot.hoodBounds(true)!;
    expect(s.robot.pose.x + hood.max.x).toBeGreaterThan(ARM_NEAR - 0.03);
    expect(s.robot.pose.x + hood.max.x).toBeLessThan(ARM_NEAR + 0.05);
    expect(s.robot.tippedOver).toBe(false);
  });

  it('with the hood parked the same robot rolls under the TRENCH', () => {
    const s = sim();
    s.run(4, { ...IDLE_COMMAND, vx: 2.5 });
    expect(s.robot.pose.x).toBeGreaterThan(C.HUB_CENTER.x + 0.5);
  });

  it('the hood cannot open while the robot is under the TRENCH arm, and opens once clear', () => {
    const s = sim(season.robotDefaults, C.HUB_CENTER.x);
    s.run(0.1, { ...IDLE_COMMAND });
    expect(s.robot.overheadLimit).toBeLessThan(Infinity);
    s.run(1, { ...IDLE_COMMAND, shoot: true });
    expect(s.robot.hoodTop).toBeLessThan(C.TRENCH_SAFE_HEIGHT);
    s.run(2, { ...IDLE_COMMAND, shoot: true, vx: 2.5 });
    expect(s.robot.overheadLimit).toBe(Infinity);
    s.run(1, { ...IDLE_COMMAND, shoot: true });
    expect(s.robot.hoodTop).toBeGreaterThan(C.TRENCH_CLEARANCE + 0.03);
  });

  it('parking the hood lets a blocked robot through', () => {
    const s = sim();
    s.run(1.5, { ...IDLE_COMMAND, shoot: true });
    s.run(3, { ...IDLE_COMMAND, shoot: true, vx: 2.5 });
    expect(s.robot.pose.x).toBeLessThan(ARM_NEAR);
    s.run(3, { ...IDLE_COMMAND, vx: -0.3 });
    expect(s.robot.hoodTop).toBeLessThan(C.TRENCH_SAFE_HEIGHT);
    s.run(5, { ...IDLE_COMMAND, vx: 2.5 });
    expect(s.robot.pose.x).toBeGreaterThan(C.HUB_CENTER.x + 0.5);
  });

  it('a robot whose hood is never above the arm is not blocked, even shooting', () => {
    const s = sim(team(9128)); // static hood below the arm
    s.run(1, { ...IDLE_COMMAND, shoot: true });
    s.run(4, { ...IDLE_COMMAND, shoot: true, vx: 2.5 });
    expect(s.robot.pose.x).toBeGreaterThan(C.HUB_CENTER.x + 0.5);
  });

  it('shooting in open field still works with the raised hood', () => {
    const s = new HeadlessSim(season, RAPIER, { robot: cloneConfig(season.robotDefaults), alliance: 'blue', pose: { x: C.HUB_CENTER.x - 2.6, y: C.HUB_CENTER.y, yaw: 0 } });
    sims.push(s);
    s.load(8);
    const before = s.robot.held.length;
    s.run(3, { ...IDLE_COMMAND, shoot: true });
    expect(s.robot.held.length).toBeLessThan(before);
  });

  it('bots stow (stop shooting) beside a TRENCH arm', async () => {
    const { RebuiltRules } = await import('../src/seasons/2026-rebuilt/rules');
    const rules = Object.create(RebuiltRules.prototype);
    expect(rules.nearTrenchArm(sim(season.robotDefaults, C.HUB_CENTER.x - 0.6).robot, 0.8)).toBe(true);
    expect(rules.nearTrenchArm(sim(season.robotDefaults, C.HUB_CENTER.x - 3).robot, 0.8)).toBe(false);
  });
});

describe('every trench-height team robot with a hood', () => {
  it.each([1690, 4414])('%i escapes a beam contact with the live physical hopper', (n) => {
    const s = sim(team(n), undefined, true);
    driveIntoArm(s);
    s.run(4, { ...IDLE_COMMAND, vx: 2.5 });
    expect(s.robot.held).toHaveLength(0);
    expect(s.robot.pose.x).toBeGreaterThan(C.HUB_CENTER.x + 0.5);
  });
  it.each([1690, 4414])('%i crosses empty with its hood parked', (n) => {
    const s = sim(team(n));
    s.run(4, { ...IDLE_COMMAND, vx: 2.5 });
    expect(s.robot.pose.x).toBeGreaterThan(C.HUB_CENTER.x + 0.5);
  });
  it.each([1690, 4414])('%i lowers its hood and escapes without backing away from the arm', (n) => {
    const s = sim(team(n));
    driveIntoArm(s);
    expect(s.robot.pose.x).toBeLessThan(ARM_NEAR);
    s.run(4, { ...IDLE_COMMAND, vx: 2.5 });
    expect(s.robot.held).toHaveLength(0);
    expect(s.robot.pose.x).toBeGreaterThan(C.HUB_CENTER.x + 0.5);
  });

  it.each([1690, 4414].flatMap(n => [-1, 1].flatMap(direction => [0, 10].map(load => [n, direction, load] as const))))
  ('%i escapes toward %i with %i FUEL after stowing at the beam', (n, direction, load) => {
    const s = sim(team(n), C.HUB_CENTER.x - direction * 2.2);
    if (direction < 0) s.robot.body.setRotation({ x: 0, y: 1, z: 0, w: 0 }, true);
    s.run(1.8, { ...IDLE_COMMAND, shoot: true });
    s.run(4, { ...IDLE_COMMAND, shoot: true, vx: direction * 2.5 });
    s.load(load);
    s.run(4, { ...IDLE_COMMAND, vx: direction * 2.5 });
    expect(direction * (s.robot.pose.x - C.HUB_CENTER.x)).toBeGreaterThan(0.5);
  });

  // Hood lift is tuned in HOOD_LIFT (config.ts): parked <= 0.535 m, open ~0.61 m.
  const withHood = season.teamRobots!.filter((t) => t.config.height <= C.TRENCH_SAFE_HEIGHT && t.config.launcher.hoodLift);
  it('is listed', () => expect(withHood.length).toBeGreaterThanOrEqual(10));

  it.each(withHood.map((t) => [t.team, t.config] as const))('%i releases a raised hood and crosses while holding forward', (_n, config) => {
    const s = sim(config);
    driveIntoArm(s);
    s.run(4, { ...IDLE_COMMAND, vx: 2.5 });
    expect(s.robot.pose.x).toBeGreaterThan(C.HUB_CENTER.x + 0.5);
  });

  it.each([1690, 4414])('%i keeps a lowered hood parked when shoot is pressed again under the arm', (n) => {
    const s = sim(team(n));
    driveIntoArm(s);
    s.run(4, { ...IDLE_COMMAND, vx: 1 }, () => s.robot.pose.x >= C.HUB_CENTER.x);
    expect(s.robot.pose.x).toBeGreaterThanOrEqual(C.HUB_CENTER.x);
    s.run(0.4, IDLE_COMMAND);
    expect(s.robot.overheadLimit).toBeLessThan(Infinity);
    s.run(1, { ...IDLE_COMMAND, shoot: true });
    expect(s.robot.hoodTop).toBeLessThan(C.TRENCH_SAFE_HEIGHT);
  });


  it.each(withHood.map((t) => [t.team, t.config] as const))('%i parks under the arm, opens above it, and the collider is the drawn hood', (_n, config) => {
    const s = sim(config);
    s.run(0.4, { ...IDLE_COMMAND });
    expect(s.robot.hoodTop).toBeLessThanOrEqual(C.TRENCH_SAFE_HEIGHT);
    s.run(1.8, { ...IDLE_COMMAND, shoot: true });
    expect(s.robot.hoodTop).toBeGreaterThan(C.TRENCH_CLEARANCE + 0.02);
    driveIntoArm(s);
    expect(s.robot.pose.x).toBeLessThan(ARM_NEAR);
    expectColliderMatchesHood(s);
  });

  it.each([971, 1678, 2910])('%i stops exactly where its drawn hood meets the arm, at full speed', (n) => {
    const s = sim(team(n));
    s.run(1.8, { ...IDLE_COMMAND, shoot: true });
    s.run(4, { ...IDLE_COMMAND, shoot: true, vx: 4.5 });
    const hood = s.robot.hoodBounds(true)!;
    expect(s.robot.pose.x + hood.max.x).toBeGreaterThan(ARM_NEAR - 0.02);
    expect(s.robot.pose.x + hood.max.x).toBeLessThan(ARM_NEAR + 0.02);
    expect(s.robot.tippedOver).toBe(false);
  });

  it.each([254, 971, 4414, 7769])('%i is stopped by the arm with its hood up', (n) => {
    const s = sim(team(n));
    driveIntoArm(s);
    expect(s.robot.pose.x).toBeLessThan(ARM_NEAR);
  });
});
