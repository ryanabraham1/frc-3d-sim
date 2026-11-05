import type { GameSettings, SeasonDefinition } from '../core/season';
import type { RobotConfig } from '../robot/config';

/** One leaderboard: a stock robot of a season. Custom builds aren't ranked, since a board compares drivers on one robot. */
export interface BoardRobot {
  id: string;
  label: string;
  /** "Team robot" or "Archetype". */
  kind: 'team' | 'archetype';
  config: RobotConfig;
}

export function boardRobots(season: SeasonDefinition): BoardRobot[] {
  return [
    ...(season.robotPresets ?? []).map((p): BoardRobot => ({ id: p.id, label: p.label, kind: 'archetype', config: p.config })),
    ...(season.teamRobots ?? []).map((t): BoardRobot => ({ id: t.id, label: `${t.team} ${t.name}`, kind: 'team', config: t.config })),
  ];
}

/** Same build, whatever team number the driver typed. Both sides are normalized, as the match normalizes what it drives. */
const fingerprint = (season: SeasonDefinition, c: RobotConfig) => JSON.stringify({ ...(season.normalizeRobotConfig?.(c) ?? c), teamNumber: 0 });

/** The board a robot belongs to, or null for a custom build. */
export function boardRobotFor(season: SeasonDefinition, config: RobotConfig): BoardRobot | null {
  const mine = fingerprint(season, config);
  return boardRobots(season).find((b) => fingerprint(season, b.config) === mine) ?? null;
}

/** Leaderboard runs are alone on the field (Solo practice), so nothing but the driver decides the score. */
export function boardRobotForMatch(season: SeasonDefinition, s: GameSettings): BoardRobot | null {
  return s.aiOpponents === false ? boardRobotFor(season, s.robot) : null;
}
