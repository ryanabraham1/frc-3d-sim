import { allAiMatch } from './slow/allAiMatch';
import { SEASONS } from '../src/seasons';

// The quick seasons (~15 s a match) keep a whole all-AI match in `npm test`; REBUILT and REEFSCAPE (1-2 min each) run
// in `npm run test:slow` (tests/slow/all-ai-match.test.ts).
allAiMatch(SEASONS.filter((s) => s.id === '2024-crescendo' || s.id === 'wcp-hero-heist'));
