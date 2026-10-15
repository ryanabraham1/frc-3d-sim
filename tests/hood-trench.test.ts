import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { SEASONS } from '../src/seasons';
import { cloneConfig, loadedRobotHeight, type RobotConfig } from '../src/engine/robot/config';
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
 * The hood collider (a skirt) has exactly the drawn hood's x reach and top in the chassis frame, as a strip on the robot's
 * centreline carried down to the floor, so the arm's push comes at wheel height with no yaw torque.
 */
function expectColliderMatchesHood(s: HeadlessSim): void {
  const b = s.robot.hoodBounds(true)!, c = s.robot.hoodColliderBox()!;
  expect(c).not.toBeNull();
  expect(c.min.x).toBeCloseTo(b.min.x, 2);
  expect(c.max.x).toBeCloseTo(b.max.x, 2);
  expect(c.min.z + c.max.z).toBeCloseTo(0, 3); // centred on the robot, so the arm's push makes no yaw torque
  expect(c.max.z - c.min.z).toBeLessThanOrEqual(b.max.z - b.min.z + 1e-6);
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
  it.each([1690, 4414])('%i stops shooting at the arm and crosses', (n) => {
    const s = sim(team(n));
    driveIntoArm(s);
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

  // Hoods only pivot (seated by HOOD_SEAT in config.ts). A robot is stopped at the arm only if its drawn hood, opened for
  // the shot, physically reaches the arm; otherwise it drives under while shooting.
  const withHood = season.teamRobots!.filter((t) => t.config.height <= C.TRENCH_SAFE_HEIGHT
    && [254, 581, 971, 1323, 1678, 1690, 1778, 1987, 2910, 4414, 5940, 6800, 7769, 9470].includes(t.team));
  it('is listed', () => expect(withHood.length).toBeGreaterThanOrEqual(10));

  it.each(withHood.map((t) => [t.team, t.config] as const))('%i crosses while holding forward once it stops shooting', (_n, config) => {
    const s = sim(config);
    driveIntoArm(s);
    s.run(4, { ...IDLE_COMMAND, vx: 2.5 });
    expect(s.robot.pose.x).toBeGreaterThan(C.HUB_CENTER.x + 0.5);
  });

  it.each([1690, 4414])('%i keeps a lowered hood parked when shoot is pressed again under the arm', (n) => {
    const s = sim(team(n));
    s.run(4, { ...IDLE_COMMAND, vx: 1 }, () => s.robot.pose.x >= C.HUB_CENTER.x);
    expect(s.robot.pose.x).toBeGreaterThanOrEqual(C.HUB_CENTER.x);
    s.run(0.4, IDLE_COMMAND);
    expect(s.robot.overheadLimit).toBeLessThan(Infinity);
    s.run(1, { ...IDLE_COMMAND, shoot: true });
    expect(s.robot.hoodTop).toBeLessThan(C.TRENCH_SAFE_HEIGHT);
  });

  it.each(withHood.map((t) => [t.team, t.config] as const))('%i parks under the arm; shooting, it is stopped only if its pivoted hood reaches the arm', (_n, config) => {
    const s = sim(config);
    s.run(0.4, { ...IDLE_COMMAND });
    expect(s.robot.hoodTop).toBeLessThanOrEqual(C.TRENCH_SAFE_HEIGHT);
    s.run(1.8, { ...IDLE_COMMAND, shoot: true });
    const reaches = s.robot.hoodTop > C.TRENCH_CLEARANCE;
    s.run(4, { ...IDLE_COMMAND, shoot: true, vx: 2.5 });
    if (reaches) {
      // Stopped where the drawn hood meets the arm, square, by a collider that is exactly the drawn hood.
      expect(s.robot.pose.x).toBeLessThan(ARM_NEAR);
      const hood = s.robot.hoodBounds(true)!;
      expect(s.robot.pose.x + hood.max.x).toBeGreaterThan(ARM_NEAR - 0.03);
      expect(s.robot.pose.x + hood.max.x).toBeLessThan(ARM_NEAR + 0.05);
      expect(Math.abs(s.robot.pose.yaw)).toBeLessThan(0.08);
      expectColliderMatchesHood(s);
    } else {
      expect(s.robot.pose.x).toBeGreaterThan(C.HUB_CENTER.x + 0.5);
    }
  });
});


const trenchApproaches = [C.HUB_CENTER.x, C.FIELD_LENGTH - C.HUB_CENTER.x].flatMap(hubX =>
  [C.TRENCH_OPENING_CENTER_Y, C.FIELD_WIDTH - C.TRENCH_OPENING_CENTER_Y].flatMap(y =>
    [-1, 1].map(direction => ({ hubX, y, direction }))));

function loadedTrenchSim(approach: typeof trenchApproaches[number], physical: boolean): HeadlessSim {
  const { hubX, y, direction } = approach;
  const s = sim(team(4414), hubX - direction * 2.2, physical);
  s.robot.resetTo({ x: hubX - direction * 2.2, y, yaw: direction > 0 ? 0 : Math.PI });
  // The browser uses either the rendered particle pile or the optional mechanism hopper, never StowBay for 4414.
  if (!physical) s.robot.detachPool(s.pool);
  return s;
}

function driveWithVisuals(s: HeadlessSim, seconds: number, direction: number): void {
  for (let i = 0; i < seconds / s.physics.dt; i++) {
    s.step({ ...IDLE_COMMAND, vx: direction * 2.5 });
    s.robot.syncVisual(s.physics.dt);
  }
}

describe.each([false, true])('4414 loaded passage (physical hopper: %s)', physical => {
  // About 85 FUEL still pass under the slack net; a near-full stretched load (100) is stopped by the arm.
  it.each(trenchApproaches.flatMap(a => [42, 57, 80, 100].map(load => ({ ...a, load }))))
  ('row $hubX lane $y toward $direction with $load FUEL', ({ hubX, y, direction, load }) => {
    const s = loadedTrenchSim({ hubX, y, direction }, physical);
    s.load(load);
    driveWithVisuals(s, 4, direction);
    expect(s.robot.held).toHaveLength(load);
    if (load <= 80) expect(direction * (s.robot.pose.x - hubX)).toBeGreaterThan(0.5);
    else expect(direction * (s.robot.pose.x - hubX)).toBeLessThan(0);
  });

  it.each(trenchApproaches)('row $hubX lane $y toward $direction recovers after unloading at the beam', approach => {
    const s = loadedTrenchSim(approach, physical);
    s.load(100);
    driveWithVisuals(s, 3, approach.direction);
    expect(approach.direction * (s.robot.pose.x - approach.hubX)).toBeLessThan(0);
    for (const i of s.robot.held.splice(57)) s.pool.reserve(i);
    driveWithVisuals(s, 5, approach.direction);
    expect(s.robot.held).toHaveLength(57);
    expect(approach.direction * (s.robot.pose.x - approach.hubX)).toBeGreaterThan(0.5);
  });
});

it.each(trenchApproaches)('4414 recovers from hood contact at row $hubX lane $y toward $direction with 42 FUEL', approach => {
  const s = loadedTrenchSim(approach, true);
  s.run(1.8, { ...IDLE_COMMAND, shoot: true });
  s.run(4, { ...IDLE_COMMAND, shoot: true, vx: approach.direction * 4.4 });
  s.load(42);
  s.run(5, { ...IDLE_COMMAND, vx: approach.direction * 4.4 });
  expect(s.robot.held).toHaveLength(42);
  expect(approach.direction * (s.robot.pose.x - approach.hubX)).toBeGreaterThan(0.5);
});


it('4414 parks its entire shooter flush with the net, including the fixed side plates', () => {
  const s = sim(team(4414));
  s.run(0.5, IDLE_COMMAND);
  const head = s.robot.visual.getObjectByName('hightide-pancake-shooter')!;
  expect(head).toBeDefined();
  // Measure every mesh in the chassis frame, including fixed cheeks that the hood-only checks do not cover.
  s.robot.visual.updateMatrixWorld(true);
  const inverse = s.robot.visual.matrixWorld.clone().invert();
  const bounds = new THREE.Box3();
  head.traverse(node => {
    const mesh = node as THREE.Mesh;
    if (!mesh.geometry) return;
    mesh.geometry.computeBoundingBox();
    bounds.union(mesh.geometry.boundingBox!.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(inverse, mesh.matrixWorld)));
  });
  expect(bounds.max.y).toBeLessThanOrEqual(s.robot.config.height + 0.005);
  // Its hood only pivots, and opened for a shot the low pancake shooter still fits under the arm.
  s.run(1.8, { ...IDLE_COMMAND, shoot: true });
  expect(s.robot.hoodTop).toBeLessThan(C.TRENCH_CLEARANCE);
});

it('4414: the load at which the TRENCH starts to block lies around 85 (80-92), not at the rigid 57', () => {
  const c = team(4414);
  let firstBlocked = -1;
  for (let n = 57; n <= c.hopperCapacity && firstBlocked < 0; n++) if (loadedRobotHeight(c, n) > C.TRENCH_SAFE_HEIGHT) firstBlocked = n;
  expect(firstBlocked).toBeGreaterThanOrEqual(80);
  expect(firstBlocked).toBeLessThanOrEqual(92);
  expect(c.hopperCapacity).toBeGreaterThanOrEqual(105);
});
