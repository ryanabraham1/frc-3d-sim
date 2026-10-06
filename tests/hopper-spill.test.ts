import { expect, it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { SEASONS } from '../src/seasons';
import { HeadlessSim } from '../src/engine/testing/headless';
import { cloneConfig } from '../src/engine/robot/config';
import { IDLE_COMMAND } from '../src/engine/robot/robot';

const season = () => SEASONS.find(s => s.year === 2026)!;
const make = (config = season().robotDefaults, load?: number) => {
  const sim = new HeadlessSim(season(), RAPIER, { robot: cloneConfig(config), alliance: 'blue', pose: { x: 4, y: 4, yaw: 0 } });
  sim.robot.enabled = true;
  sim.load(load ?? sim.robot.config.hopperCapacity);
  return sim;
};
/** Physics ticks plus rendered frames: the hopper's FUEL solver runs with the render loop. */
const run = (sim: HeadlessSim, frames: number, each?: (i: number) => void) => {
  for (let i = 0; i < frames; i++) { each?.(i); sim.step(IDLE_COMMAND); sim.step(IDLE_COMMAND); sim.robot.syncVisual(1 / 45); }
};
const onField = (sim: HeadlessSim) => { let n = 0; for (let i = 0; i < sim.pool.count; i++) if (sim.pool.state[i] === 'field') n++; return n; };
const slam = (sim: HeadlessSim) => run(sim, 24, i => { if (i < 12) sim.robot.body.setLinvel({ x: 6, y: 0, z: 0 }, true); else sim.robot.body.setLinvel({ x: 0, y: 0, z: 0 }, true); });
const flip = (sim: HeadlessSim) => { sim.robot.body.setRotation({ x: 1, y: 0, z: 0, w: 0 }, true); run(sim, 120); };

it('a level robot, full or not, keeps its FUEL when just driving', async () => {
  await RAPIER.init();
  const sim = make();
  try {
    const n = sim.robot.held.length;
    run(sim, 90, i => sim.robot.body.setLinvel({ x: 2 * Math.sin(i / 10), y: 0, z: 0 }, true));
    expect(sim.robot.held.length).toBe(n);
  } finally { sim.dispose(); }
});

it('a shallow load (5 FUEL) never comes out, even upside down on a hard hit', async () => {
  await RAPIER.init();
  const sim = make(undefined, 5);
  try { slam(sim); expect(sim.robot.held.length).toBe(5); } finally { sim.dispose(); }
});

it('an overturned open hopper pours its FUEL out as real field pieces', async () => {
  await RAPIER.init();
  const sim = make();
  try {
    const n = sim.robot.held.length, before = onField(sim);
    flip(sim);
    expect(sim.robot.held.length).toBeLessThan(n);
    expect(onField(sim) - before).toBe(n - sim.robot.held.length);
  } finally { sim.dispose(); }
});

it('a netted hopper (1323 MadTown) keeps its FUEL even upside down', async () => {
  await RAPIER.init();
  const cfg = season().teamRobots!.find(t => t.team === 1323)!.config;
  expect(cfg.hopperCovered).toBe(true);
  const sim = make(cfg);
  try { const n = sim.robot.held.length; flip(sim); expect(sim.robot.held.length).toBe(n); } finally { sim.dispose(); }
});
