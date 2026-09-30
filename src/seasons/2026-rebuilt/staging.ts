/** PURE FUEL staging [M 6.3.4]. Returns field-frame positions; no engine side effects. */
import type { FieldPoint } from '@engine/coords';
import { Rng } from '@engine/random';
import { inch } from '@engine/units';
import {
  CENTER_X,
  CENTER_Y,
  DEPOT_BARRIER_W,
  DEPOT_CENTER_Y,
  DEPOT_DEPTH,
  DEPOT_WIDTH,
  FIELD_LENGTH,
  FIELD_WIDTH,
  FUEL_MAX_PRELOAD,
  FUEL_PER_CHUTE,
  FUEL_PER_DEPOT,
  FUEL_TOTAL,
  NEUTRAL_DIVIDER,
  NEUTRAL_STAGING_D,
  NEUTRAL_STAGING_W,
} from './constants';

export const NEUTRAL_COLS = 34; // along y
export const NEUTRAL_ROWS_PER_SIDE = 6; // along x, each side of the divider
export const NEUTRAL_CAPACITY = NEUTRAL_COLS * NEUTRAL_ROWS_PER_SIDE * 2; // 408

export interface FuelStaging {
  neutral: FieldPoint[];
  depots: { red: FieldPoint[]; blue: FieldPoint[] };
  chutes: { red: number; blue: number };
  /** Preload per robot (same order as input). */
  preloads: number[];
}

/**
 * @param requestedPreloads preload requested for each robot on the field (clamped to 0..8)
 * @param emptySlots number of robot slots with no robot (their 8 FUEL go to the neutral zone)
 */
export function stageFuel(requestedPreloads: number[], rng: Rng): FuelStaging {
  const preloads = requestedPreloads.map((p) => Math.max(0, Math.min(FUEL_MAX_PRELOAD, Math.round(p))));
  const preTotal = preloads.reduce((s, p) => s + p, 0);
  const neutralCount = FUEL_TOTAL - 2 * FUEL_PER_DEPOT - 2 * FUEL_PER_CHUTE - preTotal;

  // Neutral zone grid: 206in (y) × 72in (x) box, 2in divider on the center line.
  const grid: FieldPoint[] = [];
  const dy = NEUTRAL_STAGING_W / NEUTRAL_COLS;
  const sideDepth = (NEUTRAL_STAGING_D - NEUTRAL_DIVIDER) / 2;
  const dx = sideDepth / NEUTRAL_ROWS_PER_SIDE;
  for (const side of [-1, 1]) {
    for (let r = 0; r < NEUTRAL_ROWS_PER_SIDE; r++) {
      const x = CENTER_X + side * (NEUTRAL_DIVIDER / 2 + dx * (r + 0.5));
      for (let c = 0; c < NEUTRAL_COLS; c++) {
        const y = CENTER_Y - NEUTRAL_STAGING_W / 2 + dy * (c + 0.5);
        grid.push({ x, y });
      }
    }
  }
  // Too many preloads can't happen (max 48) → neutralCount ∈ [360, 408]. Overflow (no robots) → extra layer.
  const keep = new Set(rng.shuffle(grid.map((_, i) => i)).slice(0, Math.min(grid.length, neutralCount)));
  const neutral = grid.filter((_, i) => keep.has(i)).map((p) => ({ x: p.x + rng.range(-0.004, 0.004), y: p.y + rng.range(-0.004, 0.004) }));
  let overflow = neutralCount - neutral.length;
  while (overflow > 0) {
    // Place remaining FUEL in a second, sparser ring just outside the box.
    const a = rng.range(0, Math.PI * 2);
    neutral.push({ x: CENTER_X + Math.cos(a) * rng.range(1.1, 1.6), y: CENTER_Y + Math.sin(a) * rng.range(2.8, 3.2) });
    overflow--;
  }

  return {
    neutral,
    depots: { blue: depotPositions('blue'), red: depotPositions('red') },
    chutes: { red: FUEL_PER_CHUTE, blue: FUEL_PER_CHUTE },
    preloads,
  };
}

/** 6 × 4 grid inside the depot barriers. */
export function depotPositions(alliance: 'red' | 'blue'): FieldPoint[] {
  const out: FieldPoint[] = [];
  const innerW = DEPOT_WIDTH - 2 * DEPOT_BARRIER_W;
  const innerD = DEPOT_DEPTH - DEPOT_BARRIER_W;
  const cols = 6;
  const rows = 4;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = inch(0.4) + (innerD / rows) * (r + 0.5);
      const y = DEPOT_CENTER_Y - innerW / 2 + (innerW / cols) * (c + 0.5);
      out.push(alliance === 'blue' ? { x, y } : { x: FIELD_LENGTH - x, y: FIELD_WIDTH - y });
    }
  }
  return out.slice(0, FUEL_PER_DEPOT);
}

export function totalStaged(s: FuelStaging): number {
  return s.neutral.length + s.depots.red.length + s.depots.blue.length + s.chutes.red + s.chutes.blue + s.preloads.reduce((a, b) => a + b, 0);
}
