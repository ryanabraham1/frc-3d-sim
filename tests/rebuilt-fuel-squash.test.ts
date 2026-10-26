/**
 * FUEL is foam: a ball under a robot's belly pan is crushed and squeezed out, so robots don't beach on single balls or
 * piles (at the DEPOT, under the TOWER, in a TRENCH lane).
 */
import { afterEach, beforeAll, expect, it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { cloneConfig } from '../src/engine/robot/config';
import { IDLE_COMMAND } from '../src/engine/robot/robot';
import { HeadlessSim } from '../src/engine/testing/headless';
import { rebuilt2026 } from '../src/seasons/2026-rebuilt';

beforeAll(async () => { await RAPIER.init(); });
const sims: HeadlessSim[] = [];
afterEach(() => { for (const s of sims.splice(0)) s.dispose(); });

function sim(x: number, y: number) {
  const s = new HeadlessSim(rebuilt2026, RAPIER, { robot: cloneConfig(rebuilt2026.robotDefaults), alliance: 'blue', pose: { x, y, yaw: 0 } });
  sims.push(s);
  for (const i of s.pool.indices('field')) s.pool.reserve(i);
  return s;
}

it('a ball that ends up under the chassis is squashed and squeezed out; the robot settles back on the carpet', () => {
  const s = sim(8, 2);
  const [i] = s.pool.indices('reserve');
  s.pool.placeField(i, 8, 2);
  for (let n = 0; n < 90; n++) s.step(IDLE_COMMAND);
  const p = s.frame.toField(s.pool.position(i)), half = s.robot.config.frameLength / 2;
  expect(Math.max(Math.abs(p.x - 8), Math.abs(p.y - 2))).toBeGreaterThan(half - 0.05);
  expect(s.robot.elevation).toBeLessThan(0.012);
  expect(s.pool.bodies[i].collider(0).radius()).toBeCloseTo(s.pool.colliderRadius, 5);
});

it('drives straight through a dense pile of FUEL without beaching', () => {
  const s = sim(6, 2);
  const balls = s.pool.indices('reserve').slice(0, 30);
  balls.forEach((i, k) => s.pool.placeField(i, 7.2 + (k % 6) * 0.16, 1.6 + Math.floor(k / 6) * 0.16));
  for (let n = 0; n < 90 * 3; n++) s.step({ ...IDLE_COMMAND, vx: 2 });
  expect(s.robot.pose.x).toBeGreaterThan(9.5);
  expect(Math.abs(s.robot.pose.y - 2)).toBeLessThan(0.6);
});
