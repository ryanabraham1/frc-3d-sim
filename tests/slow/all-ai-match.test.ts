import { allAiMatch } from './allAiMatch';
import { SEASONS } from '../../src/seasons';

// Opt-in (`npm run test:slow`): the long all-AI matches. CRESCENDO and HERO HEIST run in `npm test` (tests/all-ai-match.test.ts).
allAiMatch(SEASONS.filter((s) => s.id === '2026-rebuilt' || s.id === '2025-reefscape'));
