/** PURE REBUILT scoring tables [M 6.5.3, Tables 6-4 / 6-5]. */

export const POINTS = {
  fuel: 1,
  autoTowerL1: 15,
  autoTowerMaxRobots: 2,
  teleopTower: [0, 10, 20, 30] as const,
  win: 3,
  tie: 1,
} as const;

export type EventLevel = 'regional' | 'dcmp' | 'cmp';

export const RP_THRESHOLDS: Record<EventLevel, { energized: number; supercharged: number; traversal: number }> = {
  regional: { energized: 100, supercharged: 360, traversal: 50 },
  dcmp: { energized: 240, supercharged: 360, traversal: 50 },
  cmp: { energized: 360, supercharged: 500, traversal: 50 },
};

/** AUTO tower: 15 pts per robot at LEVEL 1+, max 2 robots per alliance. */
export function autoTowerPoints(levels: number[]): number {
  const n = levels.filter((l) => l >= 1).length;
  return Math.min(n, POINTS.autoTowerMaxRobots) * POINTS.autoTowerL1;
}

/** TELEOP tower: each robot scores exactly one level. */
export function teleopTowerPoints(levels: number[]): number {
  return levels.reduce((s, l) => s + (POINTS.teleopTower[Math.max(0, Math.min(3, l))] ?? 0), 0);
}

export interface RpInput {
  /** FUEL scored in an ACTIVE hub (auto + teleop). */
  fuelActive: number;
  /** All tower points (auto + teleop). */
  towerPoints: number;
  ownScore: number;
  oppScore: number;
}

export interface RpResult {
  energized: boolean;
  supercharged: boolean;
  traversal: boolean;
  matchRp: number;
  total: number;
  detail: string[];
}

export function rankingPoints(i: RpInput, level: EventLevel = 'regional'): RpResult {
  const th = RP_THRESHOLDS[level];
  const energized = i.fuelActive >= th.energized;
  const supercharged = i.fuelActive >= th.supercharged;
  const traversal = i.towerPoints >= th.traversal;
  const matchRp = i.ownScore > i.oppScore ? POINTS.win : i.ownScore === i.oppScore ? POINTS.tie : 0;
  const detail: string[] = [];
  if (matchRp === POINTS.win) detail.push('Win +3');
  if (matchRp === POINTS.tie) detail.push('Tie +1');
  if (energized) detail.push('ENERGIZED +1');
  if (supercharged) detail.push('SUPERCHARGED +1');
  if (traversal) detail.push('TRAVERSAL +1');
  return { energized, supercharged, traversal, matchRp, total: matchRp + +energized + +supercharged + +traversal, detail };
}
