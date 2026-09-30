/**
 * PURE geometry for FEEDING (lobbing FUEL back into our own ALLIANCE ZONE from the NEUTRAL ZONE or
 * beyond). Legal: G407 only restricts launching into your HUB from outside your zone.
 */
import type { Alliance, FieldPoint } from '@engine/coords';
import { clamp } from '@engine/units';
import * as C from './constants';

/** Distance from our alliance wall where fed FUEL should land (inside the zone, in front of the TOWER). */
export const FEED_LAND_X = 2.4;
const MARGIN = 0.15;

export function feedTarget(alliance: Alliance, from: FieldPoint): FieldPoint {
  const y = clamp(from.y, 1.0, C.FIELD_WIDTH - 1.0);
  return alliance === 'blue' ? { x: FEED_LAND_X, y } : { x: C.FIELD_LENGTH - FEED_LAND_X, y };
}

/** Height (above carpet) a ball must clear when crossing a hub row at lateral position y. */
export function rowHeightAt(y: number, hubY: number): number {
  if (Math.abs(y - hubY) < C.HUB_SIZE / 2 + 0.2) return C.HUB_RIM_HEIGHT + C.HUB_NET_HEIGHT + MARGIN; // over hub + net
  if (y < C.TRENCH_WIDTH + 0.1 || y > C.FIELD_WIDTH - C.TRENCH_WIDTH - 0.1) return C.TRENCH_HEIGHT + MARGIN; // over trench
  return C.BUMP_HEIGHT + 0.25; // over a bump
}

/**
 * Obstacles a lob from `from` to `to` must clear, as { distance back from the target (horizontal),
 * required height }. Checks both edges of every hub row the path crosses.
 */
export function rowClearances(from: FieldPoint, to: FieldPoint): { distance: number; height: number }[] {
  const out: { distance: number; height: number }[] = [];
  const total = Math.hypot(from.x - to.x, from.y - to.y);
  const rows = [
    { x: C.HUB_CENTER.x, y: C.HUB_CENTER.y },
    { x: C.FIELD_LENGTH - C.HUB_CENTER.x, y: C.FIELD_WIDTH - C.HUB_CENTER.y },
  ];
  const half = C.HUB_SIZE / 2 + 0.08;
  for (const row of rows) {
    for (const edge of [row.x - half, row.x + half]) {
      if ((from.x - edge) * (to.x - edge) >= 0) continue; // path doesn't cross this edge
      const s = (edge - to.x) / (from.x - to.x); // 0 at target → 1 at launcher
      const yCross = to.y + s * (from.y - to.y);
      out.push({ distance: s * total, height: rowHeightAt(yCross, row.y) });
    }
  }
  return out;
}
