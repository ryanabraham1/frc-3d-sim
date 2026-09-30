import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { feedTarget, rowClearances, rowHeightAt, FEED_LAND_X } from '../src/seasons/2026-rebuilt/passing';
import * as C from '../src/seasons/2026-rebuilt/constants';
import { Robot } from '../src/engine/robot/robot';
import { DEFAULT_ROBOT } from '../src/engine/robot/config';

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

describe('shot solver respects clearances', () => {
  const solve = (from: THREE.Vector3, target: Parameters<Robot['solveShot']>[1]) =>
    Robot.prototype.solveShot.call({ config: DEFAULT_ROBOT } as unknown as Robot, from, target);
  const G = 9.81;
  const heightAt = (from: THREE.Vector3, to: THREE.Vector3, sol: { speed: number; angle: number }, back: number) => {
    const d = Math.hypot(to.x - from.x, to.z - from.z);
    const x = d - back;
    return from.y + x * Math.tan(sol.angle) - (G * x * x) / (2 * sol.speed ** 2 * Math.cos(sol.angle) ** 2);
  };

  it('picks a trajectory that passes above a tall obstacle', () => {
    const from = new THREE.Vector3(0, 0.5, 0);
    const point = new THREE.Vector3(5, 0.2, 0);
    const clearances = [{ distance: 2.2, height: 3.0 }];
    const sol = solve(from, { point, clearances })!;
    expect(sol).not.toBeNull();
    expect(heightAt(from, point, sol, 2.2)).toBeGreaterThanOrEqual(3.0);
  });

  it('clears the hub rim on a close shot', () => {
    const from = new THREE.Vector3(0, 0.5, 0);
    const point = new THREE.Vector3(1.2, 1.85, 0);
    const sol = solve(from, { point, clearRadius: 0.5, clearHeight: 1.93 })!;
    expect(heightAt(from, point, sol, 0.5)).toBeGreaterThanOrEqual(1.93);
  });
});
