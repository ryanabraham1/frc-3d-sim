import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { HeadlessSim } from '../src/engine/testing/headless';
import { SEASONS } from '../src/seasons/index';
import * as THREE from 'three';
import { feedTarget, rowClearances, rowHeightAt, FEED_LAND_X } from '../src/seasons/2026-rebuilt/passing';
import * as C from '../src/seasons/2026-rebuilt/constants';

describe('feeding geometry', () => {
  it('feed target lands inside our own ALLIANCE ZONE', () => {
    const b = feedTarget('blue', { x: 8, y: 4 });
    const r = feedTarget('red', { x: 8, y: 4 });
    expect(b.x).toBe(FEED_LAND_X);
    expect(b.x).toBeLessThan(C.ALLIANCE_ZONE_DEPTH);
    expect(r.x).toBeGreaterThan(C.FIELD_LENGTH - C.ALLIANCE_ZONE_DEPTH);
  });

  it('a lob over the hub must clear hub + net; over a bump barely anything', () => {
    expect(rowHeightAt(C.HUB_CENTER.y, C.HUB_CENTER.y)).toBeGreaterThan(C.HUB_RIM_HEIGHT + C.HUB_NET_HEIGHT);
    expect(rowHeightAt(0.5, C.HUB_CENTER.y)).toBeGreaterThan(C.TRENCH_HEIGHT);
    expect(rowHeightAt(2.5, C.HUB_CENTER.y)).toBeLessThan(0.5);
  });

  it('from the neutral zone behind the hub: two clearances (both row edges), none if already home', () => {
    const from = { x: 7, y: C.HUB_CENTER.y };
    const cl = rowClearances(from, feedTarget('blue', from));
    expect(cl).toHaveLength(2);
    for (const c of cl) expect(c.height).toBeGreaterThan(2.8);
    expect(rowClearances({ x: 3, y: 3 }, feedTarget('blue', { x: 3, y: 3 }))).toHaveLength(0);
  });

  it('from the opponent zone the lob crosses both hub rows', () => {
    const from = { x: 14, y: 2.5 };
    expect(rowClearances(from, feedTarget('blue', from))).toHaveLength(4);
  });
});

describe('shot solver respects clearances (drag-aware)', () => {
  let sim: HeadlessSim;
  beforeAll(async () => {
    await RAPIER.init();
    sim = new HeadlessSim(SEASONS[0], RAPIER, { robot: SEASONS[0].robotDefaults, alliance: 'blue', pose: { x: 2, y: 2, yaw: 0 } });
  });
  afterAll(() => sim.dispose());
  const heightAt = (from: THREE.Vector3, to: THREE.Vector3, sol: { speed: number; angle: number }, back: number) => {
    const d = Math.hypot(to.x - from.x, to.z - from.z);
    return sim.robot.simulateFlight(from.y, sol.angle, sol.speed, [d - back, d]);
  };

  it('picks a trajectory that passes above a tall obstacle and lands on target', () => {
    const from = new THREE.Vector3(0, 0.5, 0);
    const point = new THREE.Vector3(5, 0.2, 0);
    const sol = sim.robot.solveShot(from, { point, clearances: [{ distance: 2.2, height: 3.0 }] })!;
    expect(sol.clear).toBe(true);
    const [atObstacle, atTarget] = heightAt(from, point, sol, 2.2);
    expect(atObstacle!.y).toBeGreaterThanOrEqual(3.0);
    expect(Math.abs(atTarget!.y - 0.2)).toBeLessThan(0.03);
  });

  it('clears the rim on a close shot and is descending into the goal', () => {
    const from = new THREE.Vector3(0, 0.5, 0);
    const point = new THREE.Vector3(1.2, 1.85, 0);
    const sol = sim.robot.solveShot(from, { point, clearRadius: 0.6, clearHeight: 1.93 })!;
    expect(sol.clear).toBe(true);
    const [atRim, atTarget] = heightAt(from, point, sol, 0.6);
    expect(atRim!.y).toBeGreaterThanOrEqual(1.93);
    expect(atTarget!.vy).toBeLessThan(0);
  });
});
