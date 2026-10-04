/**
 * AI strategy benchmark (not part of `npm test`): full all-AI matches, printing scores by category.
 *   AI_BENCH=1 npx vitest run tests/ai-bench.test.ts --silent=false --reporter=verbose
 * Env: AI_SEASON=2026-rebuilt, AI_SKILL=hard, AI_SEEDS=3 (AI_SEED0=1), AI_BLUE / AI_RED = strategy ids,
 * AI_BLUE_ARCH / AI_RED_ARCH = archetype ids for stations 1-3 (e.g. turret,turret,turret),
 * AI_PLAYER_ROLE = role for the blue "player" station (simulates how a human plays). Both alliances use the same
 * robot build so the comparison is fair. Each match prints one `RESULT {json}` line.
 */
import { beforeAll, describe, it } from 'vitest';
import { defaultSettings } from '../src/app/menu';
import type { GameSettings } from '../src/engine/core/season';
import { cloneConfig } from '../src/engine/robot/config';
import { loadRapier, type RapierModule } from '../src/engine/physics/world';
import { runMatch } from '../src/engine/testing/match';
import { SEASONS } from '../src/seasons';

let R: RapierModule;
beforeAll(async () => { R = await loadRapier(); });

const env = process.env;
describe.skipIf(!env.AI_BENCH)('AI benchmark', () => {
  for (const season of SEASONS.filter((s) => !env.AI_SEASON || s.id === env.AI_SEASON)) {
    it(season.id, () => {
      const seeds = Number(env.AI_SEEDS ?? 2), seed0 = Number(env.AI_SEED0 ?? 1);
      const skill = (env.AI_SKILL ?? 'hard') as NonNullable<GameSettings['aiDifficulty']>;
      for (let seed = seed0; seed < seed0 + seeds; seed++) {
        const base = defaultSettings(season);
        const arch = (v?: string) => (v ? Object.fromEntries(v.split(',').map((id, k) => [k + 1, id])) : {});
        const blueArch = arch(env.AI_BLUE_ARCH), redArch = arch(env.AI_RED_ARCH);
        const playerArch = blueArch[1] ?? season.botArchetype?.(skill, 1, env.AI_PLAYER_ROLE, true);
        const robot = cloneConfig(season.robotPresets?.find((p) => p.id === playerArch)?.config ?? season.botRobotConfig?.(skill) ?? season.robotDefaults);
        robot.maxSpeed *= { easy: 0.88, normal: 1, hard: 1.05, elite: 1.08 }[skill];
        const settings: GameSettings = { ...base, seed, alliance: 'blue', station: 1, aiDifficulty: skill, robot,
          autoRoutine: season.botAutoRoutine?.(1, robot) ?? base.autoRoutine,
          aiAlly: { skill, strategy: env.AI_BLUE ?? 'auto', roles: env.AI_PLAYER_ROLE ? { 1: env.AI_PLAYER_ROLE } : {}, archetypes: blueArch },
          aiOpponent: { strategy: env.AI_RED ?? 'auto', archetypes: redArch } };
        const t0 = Date.now();
        const res = runMatch(season, R, settings, { playerBot: true });
        console.log(`${season.id} seed ${seed} ${skill}: blue ${res.score.blue} red ${res.score.red} (${((Date.now() - t0) / 1000).toFixed(0)} s)`,
          '\n  blue', JSON.stringify(res.categories.blue), '\n  red ', JSON.stringify(res.categories.red),
          '\n  fouls', res.foulList.join('; '),
          '\nRESULT', JSON.stringify({ season: season.id, seed, blueStrat: env.AI_BLUE ?? 'auto', redStrat: env.AI_RED ?? 'auto', playerRole: env.AI_PLAYER_ROLE ?? '', blueArch: env.AI_BLUE_ARCH ?? '', redArch: env.AI_RED_ARCH ?? '', blue: res.score.blue, red: res.score.red }));
      }
    }, 3_600_000);
  }
});
