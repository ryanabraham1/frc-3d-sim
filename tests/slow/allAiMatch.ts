import { beforeAll, describe, expect, it } from 'vitest';
import type { SeasonDefinition } from '../../src/engine/core/season';
import { loadRapier, type RapierModule } from '../../src/engine/physics/world';
import { runMatch } from '../../src/engine/testing/match';
import { defaultSettings } from '../../src/app/menu';

let R: RapierModule;
beforeAll(async () => { R = await loadRapier(); });

// A whole all-AI match (the player's station driven by a bot too) through the engine's step order.
export function allAiMatch(seasons: SeasonDefinition[]) {
  describe.each(seasons)('$name all-AI match', (season) => {
    it('every robot scores, the alliance plan runs and fouls stay rare', () => {
      const settings = { ...defaultSettings(season), seed: 3, alliance: 'blue' as const, aiDifficulty: 'hard' as const, aiAlly: { skill: 'hard' as const } };
      const res = runMatch(season, R, settings, { playerBot: true });
      console.log(season.id, 'all-AI', res.score, JSON.stringify(res.categories), 'fouls', res.foulList);
      for (const pts of res.robotPoints) expect(pts).toBeGreaterThan(0);
      for (const a of ['blue', 'red'] as const) {
        expect(res.fouls[a]).toBeLessThan(res.score[a === 'blue' ? 'red' : 'blue'] * 0.15);
        const cat = res.categories[a];
        if (season.id === '2024-crescendo') { expect(cat.speakerAmplified ?? 0).toBeGreaterThan(0); expect((cat.onstage ?? 0) + (cat.park ?? 0)).toBeGreaterThan(0); }
        // AUTO: every robot's preload on L4 (3 × 7). Station cycles on top depend on traffic: AI robots have no speed edge
        // over players, so one 15 s AUTO may not fit an extra cycle (benchmark seeds 5-6: 56 AUTO CORAL points).
        if (season.id === '2025-reefscape') { expect(cat.autoCoral ?? 0).toBeGreaterThanOrEqual(21); expect(cat.barge ?? 0).toBeGreaterThanOrEqual(24); }
        // Stock 2026 robots have no climbers (TOWER skipped for a bigger hopper).
        if (season.id === '2026-rebuilt') { expect(res.counters[a].fuelActive).toBeGreaterThan(400); }
      }
    }, 300_000);
  });
}
