import { afterEach, beforeAll, expect, it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { SEASONS } from '../src/seasons';
import { HeadlessSim } from '../src/engine/testing/headless';
import { cloneConfig } from '../src/engine/robot/config';
import { IDLE_COMMAND } from '../src/engine/robot/robot';

const season = SEASONS.find(s => s.year === 2026)!;
const sims: HeadlessSim[] = [];
beforeAll(async () => { await RAPIER.init(); });
afterEach(() => { for (const sim of sims.splice(0)) sim.dispose(); });

// A nearly full netted hopper must keep every ball the intake takes: a ball the mouth can't seat goes on the lowest free
// spot of the pile, not back to the field, so the robot can actually reach its capacity.
it('4414 topped up from a dense pile reaches its full capacity without shedding balls at the mouth', () => {
  const c = cloneConfig(season.teamRobots!.find(t => t.team === 4414)!.config);
  const sim = new HeadlessSim(season, RAPIER, { robot: c, alliance: 'blue', pose: { x: 10.8, y: 4, yaw: 0 } }); sims.push(sim);
  const r = sim.robot, bay = r.bay as unknown as { stats: { captured: number }; stowed: Set<number> };
  r.syncVisual(0.05);
  sim.load(80);
  sim.scatter(Array.from({ length: 400 }, (_, i) => ({ x: 10 - (i % 40) * 0.1, y: 3.8 + Math.floor(i / 40) * 0.08 })));
  for (let k = 0; k < 30; k++) { sim.run(0.2, { ...IDLE_COMMAND, vx: -2, intake: true }); r.syncVisual(0.05); }
  expect(r.held.length).toBe(c.hopperCapacity);
  expect(bay.stowed.size).toBe(c.hopperCapacity);
  // Every ball taken stayed: nothing was captured and then let go.
  expect(bay.stats.captured).toBe(c.hopperCapacity - 80);
});
