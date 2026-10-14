import type { FieldPoint } from '@engine/coords';
import { routeThroughBands, type BarrierBand } from '@engine/ai/steering';

export interface CrossingTraffic extends FieldPoint {
  halfWidth: number;
  speed: number;
}

/** A stopped robot occupies a single-file crossing, not just a repulsion circle at its bumper. */
export function routeRebuiltTraffic(
  from: FieldPoint, goal: FieldPoint, bands: BarrierBand[], halfWidth: number, height: number,
  traffic: CrossingTraffic[], centerLanes = true,
): FieldPoint {
  const occupied = (band: BarrierBand, gap: BarrierBand['gaps'][number]) => {
    const lo = gap.yMin + halfWidth + 0.08, hi = gap.yMax - halfWidth - 0.08;
    return traffic.some(other => other.speed < 0.6 &&
      Math.sign(goal.x - from.x) * (other.x - from.x) > -0.15 &&
      other.x > band.xMin - halfWidth - 1.1 && other.x < band.xMax + halfWidth + 1.1 &&
      // Close only when the blocker leaves no bumper-width path on either side.
      other.y - other.halfWidth - halfWidth - 0.15 < lo &&
      other.y + other.halfWidth + halfWidth + 0.15 > hi);
  };
  const usable = (gap: BarrierBand['gaps'][number]) =>
    (gap.maxRobotHeight === undefined || height <= gap.maxRobotHeight) && gap.yMax - gap.yMin >= halfWidth * 2 + 0.16;
  const side = (band: BarrierBand, x: number) => x < band.xMin ? -1 : x > band.xMax ? 1 : 0;
  const ordered = [...bands].sort((a, b) => Math.abs((a.xMin + a.xMax) / 2 - from.x) - Math.abs((b.xMin + b.xMax) / 2 - from.x));
  for (const band of ordered) {
    if (side(band, from.x) === side(band, goal.x)) continue;
    const current = band.gaps.find(gap => from.y > gap.yMin && from.y < gap.yMax);
    if (side(band, from.x) === 0 && current && occupied(band, current)) {
      // Already on a blocked bump: back out in this lane before changing lanes, never cut sideways through the HUB.
      const near = from.x < (band.xMin + band.xMax) / 2 ? band.xMin - halfWidth - 0.8 : band.xMax + halfWidth + 0.8;
      return { x: near, y: from.y };
    }
    if (!band.gaps.some(gap => usable(gap) && !occupied(band, gap))) {
      // All compatible crossings are occupied. Wait clear of the entrances instead of driving through a HUB.
      const waypoint = routeThroughBands(from, goal, [band], halfWidth, height, centerLanes);
      if (side(band, from.x) === 0) return { x: from.x < (band.xMin + band.xMax) / 2 ? band.xMin - halfWidth - 0.8 : band.xMax + halfWidth + 0.8, y: from.y };
      return { x: side(band, from.x) < 0 ? band.xMin - halfWidth - 0.8 : band.xMax + halfWidth + 0.8, y: waypoint.y };
    }
    break; // Plan the nearest crossing first; a distant blocked row must not bypass this one.
  }
  const open = bands.map(band => ({ ...band, gaps: band.gaps.filter(gap => !occupied(band, gap)) }));
  return routeThroughBands(from, goal, open, halfWidth, height, centerLanes);
}
