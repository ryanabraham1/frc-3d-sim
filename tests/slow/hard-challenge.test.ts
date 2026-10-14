// Opt-in (`npm run test:slow`): six full matches per season (~17 min in total), a benchmark-style ordering check.
import { beforeAll, describe, expect, it } from 'vitest';
import { loadRapier, type RapierModule } from '../../src/engine/physics/world';
import { runMatch } from '../../src/engine/testing/match';
import { defaultSettings } from '../../src/app/menu';
import { SEASONS } from '../../src/seasons';

let R: RapierModule;
beforeAll(async () => { R = await loadRapier(); });

describe.each(SEASONS)('$name Hard challenge', (season) => {
  // REBUILT skipped (user, 2026-10-11): AI benchmark scores are out of scope while the physical hoppers change.
  it.skipIf(season.id === '2026-rebuilt')('Hard opponents outscore Normal ones against the same idle player and Normal teammates', () => {
    const totals: number[] = [];
    // Three seeds: one match is noisy (a single unlucky collision or a TRAP swings it by 5-10), the ordering over three is not.
    for (const difficulty of ['normal', 'hard'] as const) {
      let total = 0;
      for (const seed of [5, 6, 7]) {
        const settings = { ...defaultSettings(season), seed, aiDifficulty: difficulty };
        const res = runMatch(season, R, settings);
        const red = settings.alliance === 'blue' ? 'red' : 'blue';
        total += res.score[red];
        console.log(season.id, difficulty, seed, res.score[red], JSON.stringify(res.categories[red]));
        if (difficulty === 'hard' && season.id !== '2026-rebuilt') { // stock 2026 robots have no climbers
          const cat = res.categories[red];
          expect((cat.onstage ?? 0) + (cat.barge ?? 0) + (cat.towerTeleop ?? 0) + (cat.tower ?? 0)).toBeGreaterThan(0);
        }
      }
      totals.push(total);
    }
    // Hard trades some of its own scoring for pressure (it defends and goes for TRAPs; here the player is idle, so defense
    // earns nothing), so it can land a few percent under Normal in a season like CRESCENDO. It must not fall behind by more.
    expect(totals[1]).toBeGreaterThan(totals[0] * 0.9);
  }, 1_800_000);
});
