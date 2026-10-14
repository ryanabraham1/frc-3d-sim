import { mergeConfig } from 'vitest/config';
import config from './vite.config';

// Keep focused mechanism, rules, CAD and networking regressions in the everyday run.
// Exhaustive shot sweeps and full-match AI simulations remain in `npm run test:full`.
export default mergeConfig(config, {
  test: {
    exclude: [
      'tests/physics.test.ts',
      'tests/ai-matches.test.ts',
      'tests/archetype-play.test.ts',
      'tests/*-bench.test.ts',
    ],
  },
});
