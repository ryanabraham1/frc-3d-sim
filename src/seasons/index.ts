import type { SeasonDefinition } from '@engine/core/season';
import { rebuilt2026 } from './2026-rebuilt';

/** Registry of playable seasons. Add next year's module here at kickoff (newest first). */
export const SEASONS: SeasonDefinition[] = [rebuilt2026];

export function getSeason(id: string): SeasonDefinition {
  return SEASONS.find((s) => s.id === id) ?? SEASONS[0];
}
