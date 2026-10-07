import type { SeasonDefinition } from '@engine/core/season';
import type { RobotConfig } from '@engine/robot/config';

/** One robot in the ranked draft pool: the season's archetypes plus the real team robots. */
export interface PoolEntry {
  id: string;
  label: string;
  /** Short line under the name (team number or "Archetype"). */
  tag: string;
  description: string;
  config: RobotConfig;
}

export function rankedPool(season: SeasonDefinition): PoolEntry[] {
  const presets = (season.robotPresets ?? []).map((p) => ({ id: p.id, label: p.label, tag: 'Archetype', description: p.description, config: p.config }));
  const teams = (season.teamRobots ?? []).map((t) => ({ id: t.id, label: t.name, tag: `Team ${t.team}`, description: t.description, config: t.config }));
  return [...presets, ...teams];
}

export const rankedPoolIds = (season: SeasonDefinition): string[] => rankedPool(season).map((e) => e.id);
