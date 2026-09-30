import { describe, expect, it } from 'vitest';
import { Rng } from '../src/engine/random';
import { NEUTRAL_CAPACITY, stageFuel, totalStaged } from '../src/seasons/2026-rebuilt/staging';
import * as C from '../src/seasons/2026-rebuilt/constants';

describe('FUEL staging (6.3.4)', () => {
  it('always totals 504', () => {
    for (const pre of [[], [8], [8, 8, 8, 8, 8, 8], [0, 3, 8]]) {
      expect(totalStaged(stageFuel(pre, new Rng(7)))).toBe(C.FUEL_TOTAL);
    }
  });

  it('24 per depot, 24 per chute, preload clamped to 8', () => {
    const s = stageFuel([12], new Rng(1));
    expect(s.depots.red).toHaveLength(24);
    expect(s.depots.blue).toHaveLength(24);
    expect(s.chutes).toEqual({ red: 24, blue: 24 });
    expect(s.preloads).toEqual([8]);
  });

  it('neutral zone holds 360–408 inside the 206 × 72 in box, gap at the center line', () => {
    const full = stageFuel([8, 8, 8, 8, 8, 8], new Rng(3));
    expect(full.neutral).toHaveLength(360);
    const none = stageFuel([], new Rng(3));
    expect(none.neutral).toHaveLength(NEUTRAL_CAPACITY);
    for (const p of none.neutral) {
      expect(Math.abs(p.x - C.CENTER_X)).toBeLessThanOrEqual(C.NEUTRAL_STAGING_D / 2);
      expect(Math.abs(p.x - C.CENTER_X)).toBeGreaterThan(C.NEUTRAL_DIVIDER / 2);
      expect(Math.abs(p.y - C.CENTER_Y)).toBeLessThanOrEqual(C.NEUTRAL_STAGING_W / 2);
    }
  });

  it('staged balls do not overlap (collider = 98% of diameter)', () => {
    const s = stageFuel([], new Rng(9));
    const d = C.FUEL_DIAMETER * 0.98;
    const pts = s.neutral;
    for (let i = 0; i < pts.length; i++)
      for (let j = i + 1; j < pts.length; j++) expect(Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y)).toBeGreaterThan(d - 0.009);
  });

  it('red depot is the rotational mirror of blue', () => {
    const s = stageFuel([], new Rng(2));
    const b = s.depots.blue[0];
    const r = s.depots.red[0];
    expect(r.x).toBeCloseTo(C.FIELD_LENGTH - b.x);
    expect(r.y).toBeCloseTo(C.FIELD_WIDTH - b.y);
  });
});
