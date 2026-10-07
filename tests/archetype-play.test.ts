import { beforeAll, describe, expect, it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { defaultSettings } from '../src/app/menu';
import { cloneConfig } from '../src/engine/robot/config';
import { HeadlessSim } from '../src/engine/testing/headless';
import { runMatch } from '../src/engine/testing/match';
import { loadRapier, type RapierModule } from '../src/engine/physics/world';
import { SEASONS } from '../src/seasons';
import * as C25 from '../src/seasons/2025-reefscape/constants';
import * as C24 from '../src/seasons/2024-crescendo/constants';

let R: RapierModule;
beforeAll(async () => { await RAPIER.init(); R = await loadRapier(); });
const season = (id: string) => SEASONS.find((s) => s.id === id)!;
const config = (sid: string, id: string) => cloneConfig(season(sid).robotPresets?.find((p) => p.id === id)?.config ?? season(sid).teamRobots!.find((t) => t.id === id)!.config);

/** One AI robot alone in TELEOP for `seconds`: points scored, launches, and launches that went in. */
function solo(sid: string, id: string, seconds: number) {
  const s = season(sid);
  const sim = new HeadlessSim(s, RAPIER, { robot: config(sid, id), alliance: 'blue', pose: s.startPose('blue', 2) });
  try {
    sim.ctx.humanPlayerIsAuto = () => true;
    sim.rules.stage();
    sim.rules.onPeriodChange(sim.ctx.clock.start());
    while (sim.ctx.clock.mode !== 'teleop') for (const c of sim.ctx.clock.advance(0.1)) sim.rules.onPeriodChange(c);
    const bot = s.createBotPilot!(sim.ctx, sim.rules, sim.robot);
    const r = sim.robot, dt = sim.physics.dt;
    const goal0 = s.testing!.goalCount(sim.ctx, 'blue'), pts0 = sim.ctx.score.total('blue');
    let shots = 0, last = r.held.length;
    for (let step = 0; step < seconds / dt; step++) {
      for (const c of sim.ctx.clock.advance(dt)) sim.rules.onPeriodChange(c);
      sim.step(bot.update(dt));
      if (r.held.length < last) shots += last - r.held.length;
      last = r.held.length;
    }
    return { points: sim.ctx.score.total('blue') - pts0, shots, scored: s.testing!.goalCount(sim.ctx, 'blue') - goal0 };
  } finally { sim.dispose(); }
}

describe('AI plays each robot archetype the way it is built', () => {
  // Chassis-aimed dumpers take a stance ~1.8 m from the HUB, stop and unload (they hit ~40% while chasing FUEL).
  it.each(['overload-254', 'limestone-1678', 'big-hopper'])('2026 %s scores from a planted stance', (id) => {
    const res = solo('2026-rebuilt', id, 120);
    expect(res.scored / Math.max(1, res.shots)).toBeGreaterThan(0.75);
    // Open-top hoppers keep intaking when full and lose the extras over the rim (real physics), so a little below 200.
    expect(res.scored).toBeGreaterThan(175);
  }, 300_000);

  // Floor-pickup robots (no station intake) take the human player's CORAL off the carpet instead of waiting forever.
  it.each(['whisper-1690', 'firefly-118', 'subzero-1778', 'spectre-2910'])('2025 %s cycles CORAL from the carpet', (id) => {
    expect(solo('2025-reefscape', id, 60).points).toBeGreaterThan(40);
  }, 300_000);

  it('2024 TRAP robots place their NOTE in the TRAP from the chain', () => {
    const s = season('2024-crescendo');
    // Whether a given match gets a TRAP in is chaotic (traffic on the chain); across seeds it happens most of the time.
    let trap = 0;
    for (const seed of [1, 2, 3]) {
      const res = runMatch(s, R, { ...defaultSettings(s), seed, aiDifficulty: 'hard', aiOpponent: { archetypes: { 1: 'amp-trap', 2: 'amp-trap', 3: 'amp-trap' } } });
      trap += res.categories.red.trap ?? 0;
    }
    expect(trap).toBeGreaterThan(0);
  }, 600_000);
});

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
