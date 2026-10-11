import { beforeAll, describe, expect, it } from 'vitest';
import { defaultSettings } from '../../src/app/menu';
import { runMatch } from '../../src/engine/testing/match';
import { loadRapier, type RapierModule } from '../../src/engine/physics/world';
import { SEASONS } from '../../src/seasons';
import * as C25 from '../../src/seasons/2025-reefscape/constants';
import * as C24 from '../../src/seasons/2024-crescendo/constants';

// Opt-in (`npm run test:slow`): two whole matches watching for bots parked at a station (~70 s). Split out of archetype-play.test.ts.
let R: RapierModule;
beforeAll(async () => { R = await loadRapier(); });
const season = (id: string) => SEASONS.find((s) => s.id === id)!;

// A piece hung up in the CHUTE (or lying next to the station) must not park a bot at the station for the match.
describe.each([['2025-reefscape'], ['2024-crescendo']])('%s station waits', (sid) => {
  it('no AI robot waits empty-handed at a station for long', () => {
    const s = season(sid);
    let worst = 0;
    const idle = new Map<number, number>();
    runMatch(s, R, { ...defaultSettings(s), seed: 1, aiDifficulty: 'normal' }, { playerBot: true, onStep: (sim) => {
      if (sim.ctx.clock.mode !== 'teleop') return;
      for (const r of sim.ctx.robots) {
        const pts = sid === '2025-reefscape' ? C25.stations(r.alliance) : [C24.sourcePoint(r.alliance, 0.5, 0)];
        const near = pts.some((p) => Math.hypot(p.x - r.pose.x, p.y - r.pose.y) < 1.3);
        const v = near && r.held.length === 0 && r.speed < 0.08 ? (idle.get(r.id) ?? 0) + sim.physics.dt : 0;
        idle.set(r.id, v);
        worst = Math.max(worst, v);
      }
    } });
    // Waiting is legitimate while every CORAL is on the reef or in a hand (the supply is finite), so the bound is
    // loose: it only catches a bot parked at the station for most of the match.
    expect(worst).toBeLessThan(30);
  }, 300_000);
});
