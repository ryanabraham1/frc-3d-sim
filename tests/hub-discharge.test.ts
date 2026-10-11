import { expect, it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { SEASONS } from '../src/seasons';
import { HeadlessSim } from '../src/engine/testing/headless';
import { cloneConfig } from '../src/engine/robot/config';
import * as C from '../src/seasons/2026-rebuilt/constants';
import { side, dir } from '../src/seasons/2026-rebuilt/field';
import { HUB_CAD } from '../src/seasons/2026-rebuilt/hubCad';

// A scored ball is the same physical ball from the funnel to the exits: it falls through the HUB (field CAD) onto its ramps,
// through the FUEL counter and out of the exit slot in the NEUTRAL ZONE face, never hidden or respawned.
for (const alliance of ['blue', 'red'] as const) it(`${alliance} hub carries a scored ball through its ramps and counter and out of the exit slot`, async () => {
  await RAPIER.init();
  const season = SEASONS.find(s => s.id === '2026-rebuilt')!;
  const sim = new HeadlessSim(season, RAPIER, {robot: cloneConfig(season.robotDefaults), alliance, pose:{x:2,y:2,yaw:0}, log:true});
  try {
    const hub = side(alliance, C.HUB_CENTER.x, C.HUB_CENTER.y), d = dir(alliance);
    const exits = new Set<number>();
    const total = sim.pool.count;
    for (const [k, dy] of [[0, -0.25], [1, -0.08], [2, 0.1], [3, 0.27]] as const) {
      const idx = sim.pool.indices('reserve')[0];
      const before = sim.ctx.score.total(alliance);
      sim.pool.placeField(idx, hub.x - d * 0.05, hub.y + dy, C.HUB_RIM_HEIGHT + 0.25);
      let scoredAt = -1, out = -1, maxSpeed = 0;
      for (let i = 0; i < 6 / sim.physics.dt; i++) {
        sim.step();
        // Never taken out of play on the way through.
        expect(sim.pool.state[idx]).toBe('field');
        const p = sim.frame.toField(sim.pool.bodies[idx].translation());
        if (scoredAt < 0 && sim.ctx.score.total(alliance) > before) scoredAt = i;
        if (scoredAt >= 0 && (p.x - hub.x) * d > C.HUB_SIZE / 2) {
          out = i;
          // [CAD] Leaves through the exit slot in the NEUTRAL ZONE face, from one of the counter's four lanes.
          expect(p.z).toBeGreaterThan(HUB_CAD.exitBottom - 0.2);
          expect(p.z).toBeLessThan(HUB_CAD.exitTop);
          exits.add(Math.sign(p.y - hub.y) * (Math.abs(p.y - hub.y) > 0.27 ? 2 : 1));
          const v = sim.pool.bodies[idx].linvel();
          maxSpeed = Math.hypot(v.x, v.y, v.z);
          break;
        }
      }
      expect(scoredAt).toBeGreaterThanOrEqual(0);
      expect(out).toBeGreaterThan(scoredAt);
      // About a second inside, and out at a roll rather than a spray.
      expect((out - scoredAt) * sim.physics.dt).toBeGreaterThan(0.3);
      expect(maxSpeed).toBeLessThan(3.5);
      // Counted once: rolling out and on does not score again.
      const after = sim.ctx.score.total(alliance);
      for (let i = 0; i < 60; i++) sim.step();
      expect(sim.ctx.score.total(alliance)).toBe(after);
      sim.pool.reserve(idx);
      void k;
    }
    expect(exits.size).toBeGreaterThanOrEqual(2);
    expect(sim.pool.count).toBe(total);
  } finally { sim.dispose(); }
});
