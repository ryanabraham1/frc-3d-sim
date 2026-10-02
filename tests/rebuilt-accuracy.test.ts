import { beforeAll, describe, expect, it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { runShotTrial } from '../src/engine/testing/shotHarness';
import { cloneConfig } from '../src/engine/robot/config';
import { rebuilt2026 as season } from '../src/seasons/2026-rebuilt';
import {
  REBUILT_ACCURACY_RANGE,
  REBUILT_DEFAULT_ACCURACY,
  normalizeRebuiltConfig,
  rebuiltAccuracyForSpread,
  rebuiltShotAccuracy,
  rebuiltSpreadForAccuracy,
  setRebuiltAccuracy,
} from '../src/seasons/2026-rebuilt/config';
import { side, sideYaw } from '../src/seasons/2026-rebuilt/field';
import * as C from '../src/seasons/2026-rebuilt/constants';

beforeAll(async () => { await RAPIER.init(); });

/** Percent of FUEL that score, fired `shots` at a time from 6 bearings `dist` m from the HUB (real physics). */
function hitRate(acc: number, dist: number, shots = 100): number {
  let entered = 0;
  let fired = 0;
  [-75, -50, -25, 25, 50, 75].forEach((deg, k) => {
    const a = (deg * Math.PI) / 180;
    const robot = cloneConfig(season.robotDefaults);
    setRebuiltAccuracy(robot, acc);
    const spot = side('blue', C.HUB_CENTER.x - dist * Math.cos(a), C.HUB_CENTER.y - dist * Math.sin(a));
    const r = runShotTrial(season, RAPIER, { label: `acc${acc}`, robot, alliance: 'blue', pose: { ...spot, yaw: sideYaw('blue', 0) }, shots, seed: 11 + k });
    entered += r.entered;
    fired += r.fired;
  });
  return (100 * entered) / fired;
}

describe('2026 shot accuracy is a hit rate', () => {
  it('maps accuracy % to a spread and back', () => {
    let last = 0;
    for (let a = 100; a >= 0; a -= 5) {
      const s = rebuiltSpreadForAccuracy(a);
      expect(s).toBeGreaterThan(last);
      last = s;
      expect(rebuiltAccuracyForSpread(s)).toBeCloseTo(a, 5);
    }
    const c = cloneConfig(season.robotDefaults);
    expect(rebuiltShotAccuracy.get(c)).toBe(REBUILT_DEFAULT_ACCURACY);
    rebuiltShotAccuracy.set(c, 60);
    expect(rebuiltShotAccuracy.get(c)).toBe(60);
  });

  it('upgrades saved configs that still carry the old near-perfect default spread', () => {
    const legacy = cloneConfig(season.robotDefaults);
    legacy.launcher.spread = 0.012;
    legacy.launcher.speedError = 0.015;
    expect(rebuiltShotAccuracy.get(normalizeRebuiltConfig(legacy))).toBe(REBUILT_DEFAULT_ACCURACY);
    legacy.launcher.spread = 0.002; // a deliberate 100% setting is left alone
    legacy.launcher.speedError = 0.004;
    expect(rebuiltShotAccuracy.get(normalizeRebuiltConfig(legacy))).toBe(100);
  });

  it('an N% robot puts about N of 100 FUEL in from a typical range (the rest miss on spread)', () => {
    for (const acc of [95, REBUILT_DEFAULT_ACCURACY, 60, 40]) {
      const got = hitRate(acc, REBUILT_ACCURACY_RANGE);
      expect(Math.abs(got - acc), `${acc}% accuracy scored ${got.toFixed(1)}%`).toBeLessThanOrEqual(7);
    }
  });

  it('the same shooter misses more from farther away, and a 100% shooter does not miss', () => {
    expect(hitRate(REBUILT_DEFAULT_ACCURACY, 2.2, 50)).toBeGreaterThan(hitRate(REBUILT_DEFAULT_ACCURACY, 4.2, 50));
    expect(hitRate(100, REBUILT_ACCURACY_RANGE, 50)).toBeGreaterThanOrEqual(98);
  });
});
