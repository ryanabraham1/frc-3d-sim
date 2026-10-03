/**
 * AI strategy benchmark (not part of `npm test`): full all-AI matches per season, printing scores by category.
 *   AI_BENCH=1 npx vitest run tests/ai-bench.test.ts --silent=false --reporter=verbose
 * Optional: AI_SEASON=2026-rebuilt, AI_SKILL=hard, AI_SEEDS=3, AI_STRATEGY=<blue strategy id>.
 */
import { beforeAll, describe, it } from 'vitest';
import { defaultSettings } from '../src/app/menu';
import type { GameSettings } from '../src/engine/core/season';
import { loadRapier, type RapierModule } from '../src/engine/physics/world';
import { runMatch } from '../src/engine/testing/match';
import { SEASONS } from '../src/seasons';

let R: RapierModule;
beforeAll(async () => { R = await loadRapier(); });
if (process.env.AI_TUNE) (globalThis as Record<string, unknown>).__AI_TUNE = JSON.parse(process.env.AI_TUNE);

const env = process.env;
describe.skipIf(!env.AI_BENCH)('AI benchmark', () => {
  for (const season of SEASONS.filter((s) => !env.AI_SEASON || s.id === env.AI_SEASON)) {
    it(season.id, () => {
      const seeds = Number(env.AI_SEEDS ?? 2);
      for (let seed = 1; seed <= seeds; seed++) {
        const skill = (env.AI_SKILL ?? 'hard') as NonNullable<GameSettings['aiDifficulty']>;
        const settings: GameSettings = { ...defaultSettings(season), seed, alliance: 'blue', aiDifficulty: skill,
          aiAlly: { skill, strategy: env.AI_STRATEGY ?? 'auto' } };
        const t0 = Date.now();
        const res = runMatch(season, R, settings, { playerBot: true });
        console.log(`${season.id} seed ${seed} ${skill}: blue ${res.score.blue} red ${res.score.red} (${((Date.now() - t0) / 1000).toFixed(0)} s)`,
          '\n  blue', JSON.stringify(res.categories.blue), '\n  red ', JSON.stringify(res.categories.red),
          '\n  robots', JSON.stringify(res.robotPoints), 'fouls', JSON.stringify(res.fouls),
          '\n  counters', JSON.stringify(res.counters), '\n  foulList', res.foulList.join('; '));
      }
    }, 900_000);
  }
});
