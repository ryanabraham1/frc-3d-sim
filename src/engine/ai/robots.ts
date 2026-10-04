import type { SeasonDefinition } from '../core/season';
import type { RobotConfig } from '../robot/config';

/** A robot an AI driver can play: a generic archetype preset, or a real team's robot (its own model and build). */
export interface AiRobotChoice {
  id: string;
  label: string;
  description: string;
  config: RobotConfig;
  /** Real team robot (keeps its team number and model). */
  team?: number;
}

/** Real team robots, then the generic archetype presets, that the season lets AI drivers play. */
export function aiRobotChoices(season: SeasonDefinition): AiRobotChoice[] {
  const teams = (season.teamRobots ?? []).map((t) => ({ id: t.id, label: `${t.team} ${t.name}`, description: t.description, config: t.config, team: t.team }));
  return [...teams, ...(season.robotPresets ?? [])].filter((c) => season.aiCanPlay?.(c.config) ?? true);
}
