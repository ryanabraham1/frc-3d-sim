import type { SeasonDefinition } from '@engine/core/season';
import { rebuilt2026 } from './2026-rebuilt';
import { reefscape2025 } from './2025-reefscape';
import { crescendo2024 } from './2024-crescendo';
import { heroHeist } from './wcp-hero-heist';

/** Registry of playable games: FRC seasons newest first, then standalone games (e.g. the WCP CADathon). */
export const SEASONS: SeasonDefinition[] = [rebuilt2026, reefscape2025, crescendo2024, heroHeist];

for (const season of SEASONS) {
  season.teamRobots?.sort((a, b) => a.team - b.team);
}

export function getSeason(id: string): SeasonDefinition {
  return SEASONS.find((s) => s.id === id) ?? SEASONS[0];
}
