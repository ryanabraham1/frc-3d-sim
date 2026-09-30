import { FieldPoint } from '../coords';
import { clamp, wrapAngle } from '../units';

/**
 * A band of the field (spanning x ∈ [xMin, xMax]) that robots can only cross through gaps.
 * Most FRC fields have one of these (barriers, charge stations, stages, hub/bump/trench rows...).
 */
export interface BarrierBand {
  xMin: number;
  xMax: number;
  gaps: { yMin: number; yMax: number; maxRobotHeight?: number; name?: string }[];
}

export interface Circle extends FieldPoint {
  r: number;
}

/** Arrive steering: velocity toward `to`, slowing inside `slowRadius`. */
export function arrive(from: FieldPoint, to: FieldPoint, maxSpeed: number, slowRadius = 1.2): { vx: number; vy: number; dist: number } {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dist = Math.hypot(dx, dy);
  if (dist < 1e-4) return { vx: 0, vy: 0, dist };
  const speed = maxSpeed * clamp(dist / slowRadius, 0.15, 1);
  return { vx: (dx / dist) * speed, vy: (dy / dist) * speed, dist };
}

/** Repulsion from circles within `range` of their edge. */
export function avoid(from: FieldPoint, obstacles: Circle[], range = 0.6, strength = 2.5): { vx: number; vy: number } {
  let vx = 0;
  let vy = 0;
  for (const o of obstacles) {
    const dx = from.x - o.x;
    const dy = from.y - o.y;
    const d = Math.hypot(dx, dy);
    const gap = d - o.r;
    if (d < 1e-4 || gap > range) continue;
    const w = strength * (1 - Math.max(0, gap) / range);
    vx += (dx / d) * w;
    vy += (dy / d) * w;
  }
  return { vx, vy };
}

/** Proportional yaw-rate command to face `targetYaw`. */
export function turnToward(currentYaw: number, targetYaw: number, maxOmega: number, gain = 4): number {
  return clamp(wrapAngle(targetYaw - currentYaw) * gain, -maxOmega, maxOmega);
}

export function angleTo(from: FieldPoint, to: FieldPoint): number {
  return Math.atan2(to.y - from.y, to.x - from.x);
}

export function dist(a: FieldPoint, b: FieldPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * Next waypoint on the way from `from` to `to`, routing through band gaps when a band lies between them.
 * Returns `to` when no band is in the way.
 */
export function routeThroughBands(from: FieldPoint, to: FieldPoint, bands: BarrierBand[], robotHalfWidth: number, robotHeight: number): FieldPoint {
  const side = (b: BarrierBand, x: number) => (x < b.xMin ? -1 : x > b.xMax ? 1 : 0);
  // Consider the band nearest to the robot first.
  const ordered = [...bands].sort((a, b) => Math.abs((a.xMin + a.xMax) / 2 - from.x) - Math.abs((b.xMin + b.xMax) / 2 - from.x));
  for (const b of ordered) {
    const sf = side(b, from.x);
    const st = side(b, to.x);
    if (sf === st) continue;
    const margin = 0.08;
    let best: { y: number; cost: number } | null = null;
    for (const g of b.gaps) {
      if (g.maxRobotHeight !== undefined && robotHeight > g.maxRobotHeight) continue;
      const lo = g.yMin + robotHalfWidth + margin;
      const hi = g.yMax - robotHalfWidth - margin;
      if (lo > hi) continue;
      const gy = clamp((from.y + to.y) / 2, lo, hi);
      const cost = Math.abs(from.y - gy) + Math.abs(to.y - gy);
      if (!best || cost < best.cost) best = { y: gy, cost };
    }
    if (!best) continue;
    if (sf === 0) {
      // Inside the band: continue out toward the target side, staying in the lane.
      return { x: st < 0 ? b.xMin - 0.7 : b.xMax + 0.7, y: best.y };
    }
    const nearEdge = sf < 0 ? b.xMin : b.xMax;
    const entry = { x: nearEdge + sf * 0.55, y: best.y };
    const aligned = Math.abs(from.y - best.y) < 0.18;
    const close = Math.abs(from.x - nearEdge) < 1.0;
    if (aligned && close) return { x: st < 0 ? b.xMin - 0.7 : b.xMax + 0.7, y: best.y };
    return entry;
  }
  return to;
}
