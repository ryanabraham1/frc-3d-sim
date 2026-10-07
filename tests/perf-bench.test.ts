/**
 * Step-time benchmark (not part of `npm test`): a full single-player match per season, timing every physics step so
 * spikes show up, not just the average. A 90 Hz step must stay well under 11 ms or the frame loop falls behind.
 *   PERF_BENCH=1 npx vitest run tests/perf-bench.test.ts --silent=false
 * Env: PERF_SEASON=2026-rebuilt, PERF_SECONDS=160.
 */
import { beforeAll, describe, it } from 'vitest';
import { defaultSettings } from '../src/app/menu';
import { loadRapier, type RapierModule } from '../src/engine/physics/world';
import { runMatch } from '../src/engine/testing/match';
import { SEASONS } from '../src/seasons';

let R: RapierModule;
beforeAll(async () => { R = await loadRapier(); });

const env = process.env;
describe.skipIf(!env.PERF_BENCH)('step-time benchmark', () => {
  for (const season of SEASONS.filter((s) => !env.PERF_SEASON || s.id === env.PERF_SEASON)) {
    it(season.id, () => {
      const times: number[] = [];
      let last = performance.now();
      const worst: { t: number; ms: number }[] = [];
      let simT = 0;
      runMatch(season, R, { ...defaultSettings(season), seed: 1 }, {
        playerBot: true,
        seconds: Number(env.PERF_SECONDS ?? 160),
        onStep: (sim) => {
          const now = performance.now();
          const ms = now - last;
          last = now;
          simT += sim.physics.dt;
          times.push(ms);
          worst.push({ t: simT, ms });
        },
      });
      const sorted = [...times].sort((a, b) => a - b);
      const pct = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))].toFixed(2);
      const mean = times.reduce((a, b) => a + b, 0) / times.length;
      worst.sort((a, b) => b.ms - a.ms);
      console.log(`${season.id}: ${times.length} steps, mean ${mean.toFixed(2)} ms, p50 ${pct(0.5)} p95 ${pct(0.95)} p99 ${pct(0.99)} p99.9 ${pct(0.999)} max ${sorted.at(-1)!.toFixed(1)}`,
        `\n  steps > 11 ms: ${times.filter((t) => t > 11).length}, > 30 ms: ${times.filter((t) => t > 30).length}`,
        '\n  worst:', worst.slice(0, 12).map((w) => `${w.ms.toFixed(1)}ms@${w.t.toFixed(1)}s`).join(' '));
    }, 3_600_000);
  }
});
