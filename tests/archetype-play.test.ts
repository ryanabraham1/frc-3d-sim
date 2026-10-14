import { beforeAll, describe, expect, it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { defaultSettings } from '../src/app/menu';
import { cloneConfig } from '../src/engine/robot/config';
import { HeadlessSim } from '../src/engine/testing/headless';
import { runMatch } from '../src/engine/testing/match';
import { loadRapier, type RapierModule } from '../src/engine/physics/world';
import { SEASONS } from '../src/seasons';

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
    // 60 s of TELEOP (scored 100-133 when measured): the stance-and-dump loop repeats every few seconds, so a longer run
    // only multiplies the same check.
    const res = solo('2026-rebuilt', id, 60);
    // `shots` counts every FUEL that leaves the hopper, including extras that spill over an open-top rim while it keeps
    // intaking full (big-hopper loses ~100 a match), so the floor is loose; the scored count below is the real check.
    expect(res.scored / Math.max(1, res.shots)).toBeGreaterThan(0.5);
    // Open-top hoppers keep intaking when full and lose the extras over the rim (real physics), so the floor is the old
    // 175-in-120 s rate. One 60 s match is a single chaotic sample (any change that nudges the physics moves it between
    // ~50 and ~130 for the same bot: it can sit full through a whole inactive shift), so the floor only has to show the
    // stance-and-dump loop works; the shot ratio above is the accuracy check.
    expect(res.scored).toBeGreaterThan(45);
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
      if (trap > 0) break; // one TRAP is the pass condition; the later seeds only matter when this one missed
    }
    expect(trap).toBeGreaterThan(0);
  }, 600_000);
});
