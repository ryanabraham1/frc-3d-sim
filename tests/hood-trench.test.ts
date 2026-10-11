import { afterEach, beforeAll, expect, it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { SEASONS } from '../src/seasons';
import { cloneConfig } from '../src/engine/robot/config';
import { HeadlessSim } from '../src/engine/testing/headless';
import { IDLE_COMMAND } from '../src/engine/robot/robot';
import * as C from '../src/seasons/2026-rebuilt/constants';

const season = SEASONS.find((s) => s.id === '2026-rebuilt')!;
const sims: HeadlessSim[] = [];
beforeAll(async () => { await RAPIER.init(); });
afterEach(() => { for (const sim of sims.splice(0)) sim.dispose(); });

const ARM_NEAR = C.HUB_CENTER.x - C.TRENCH_ARM_DEPTH / 2;

function sim(x = C.HUB_CENTER.x - 2.2): HeadlessSim {
  const c = cloneConfig(season.robotDefaults); // trench-height turret robot with an adjustable hood
  const s = new HeadlessSim(season, RAPIER, { robot: c, alliance: 'blue', pose: { x, y: C.TRENCH_OPENING_CENTER_Y, yaw: 0 } });
  sims.push(s);
  s.robot.held.length = 0;
  return s;
}

it('default shooters have a hood that rises above the frame', () => {
  expect(season.robotDefaults.launcher.hoodRise).toBeGreaterThan(0.05);
});

it('a robot with its hood raised cannot drive under the TRENCH', () => {
  const s = sim();
  s.run(2.5, { ...IDLE_COMMAND, shoot: true }); // hood opens while still clear of the arm
  expect(s.robot.hoodHeightAboveFrame).toBeGreaterThan(0.03);
  s.run(4, { ...IDLE_COMMAND, shoot: true, vx: 2.5 });
  expect(s.robot.pose.x).toBeLessThan(ARM_NEAR);
});

it('with the hood parked the same robot rolls under the TRENCH', () => {
  const s = sim();
  s.run(4, { ...IDLE_COMMAND, vx: 2.5 });
  expect(s.robot.pose.x).toBeGreaterThan(C.HUB_CENTER.x + 0.5);
});

it('the hood cannot open while the robot is under the TRENCH arm, and opens once clear', () => {
  const s = sim(C.HUB_CENTER.x);
  s.run(0.1, { ...IDLE_COMMAND });
  expect(s.robot.overheadLimit).toBeLessThan(Infinity);
  s.run(1, { ...IDLE_COMMAND, shoot: true });
  expect(s.robot.hoodHeightAboveFrame).toBeLessThan(0.01);
  s.run(2, { ...IDLE_COMMAND, shoot: true, vx: 2.5 });
  expect(s.robot.overheadLimit).toBe(Infinity);
  s.run(1, { ...IDLE_COMMAND, shoot: true });
  expect(s.robot.hoodHeightAboveFrame).toBeGreaterThan(0.03);
});

it('parking the hood lets a blocked robot through', () => {
  const s = sim();
  s.run(2.5, { ...IDLE_COMMAND, shoot: true });
  s.run(3, { ...IDLE_COMMAND, shoot: true, vx: 2.5 });
  expect(s.robot.pose.x).toBeLessThan(ARM_NEAR);
  s.run(3, { ...IDLE_COMMAND, vx: -0.3 });
  expect(s.robot.hoodHeightAboveFrame).toBeLessThan(0.01);
  s.run(5, { ...IDLE_COMMAND, vx: 2.5 });
  expect(s.robot.pose.x).toBeGreaterThan(C.HUB_CENTER.x + 0.5);
});

it('a fixed-hood robot is unaffected', () => {
  const c = cloneConfig(season.robotDefaults);
  c.launcher.minAngle = c.launcher.maxAngle = c.launcher.angle; c.launcher.hoodRise = 0;
  const s = new HeadlessSim(season, RAPIER, { robot: c, alliance: 'blue', pose: { x: C.HUB_CENTER.x - 2.2, y: C.TRENCH_OPENING_CENTER_Y, yaw: 0 } });
  sims.push(s);
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
  const s = sim(C.HUB_CENTER.x - 0.6);
  const rules = Object.create(RebuiltRules.prototype);
  expect(rules.nearTrenchArm(s.robot, 0.8)).toBe(true);
  const far = sim(C.HUB_CENTER.x - 3);
  expect(rules.nearTrenchArm(far.robot, 0.8)).toBe(false);
});
