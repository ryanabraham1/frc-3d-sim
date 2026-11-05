import type { GameSettings, SeasonDefinition } from '../core/season';
import type { RobotConfig } from '../robot/config';

/** One leaderboard: a real team's robot. Archetypes and custom builds aren't ranked. */
export interface BoardRobot {
  id: string;
  label: string;
  config: RobotConfig;
}

export function boardRobots(season: SeasonDefinition): BoardRobot[] {
  return (season.teamRobots ?? []).map((t) => ({ id: t.id, label: `${t.team} ${t.name}`, config: t.config }));
}

/** Same build, whatever team number the driver typed. Both sides are normalized, as the match normalizes what it drives. */
const fingerprint = (season: SeasonDefinition, c: RobotConfig) => JSON.stringify({ ...(season.normalizeRobotConfig?.(c) ?? c), teamNumber: 0 });

/** The board a robot belongs to, or null for an archetype or custom build. */
export function boardRobotFor(season: SeasonDefinition, config: RobotConfig): BoardRobot | null {
  const mine = fingerprint(season, config);
  return boardRobots(season).find((b) => fingerprint(season, b.config) === mine) ?? null;
}

/** Leaderboard runs are alone on the field (Solo practice), so nothing but the driver decides the score. */
export function boardRobotForMatch(season: SeasonDefinition, s: GameSettings): BoardRobot | null {
  return s.aiOpponents === false ? boardRobotFor(season, s.robot) : null;
}
