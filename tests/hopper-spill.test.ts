import { expect, it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { SEASONS } from '../src/seasons';
import { HeadlessSim } from '../src/engine/testing/headless';
import { cloneConfig } from '../src/engine/robot/config';
import { IDLE_COMMAND } from '../src/engine/robot/robot';

const season = () => SEASONS.find(s => s.year === 2026)!;
const make = (config = season().robotDefaults, load?: number) => {
  const sim = new HeadlessSim(season(), RAPIER, { robot: cloneConfig(config), alliance: 'blue', pose: { x: 4, y: 4, yaw: 0 } });
  sim.load(load ?? sim.robot.config.hopperCapacity); sim.robot.enabled = true;
  return sim;
};
const slam = (sim: HeadlessSim) => {
  for (let i = 0; i < 6; i++) { sim.robot.body.setLinvel({ x: 5, y: 0, z: 0 }, true); sim.step(IDLE_COMMAND); }
  sim.robot.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
  for (let i = 0; i < 6; i++) sim.step(IDLE_COMMAND);
};
const tip = (sim: HeadlessSim) => {
  sim.robot.body.setRotation({ x: 0.7071, y: 0, z: 0, w: 0.7071 }, true);
  for (let i = 0; i < 180; i++) sim.step(IDLE_COMMAND);
};

it('a full open hopper loses FUEL when tipped or hit hard, but never below the rim line', async () => {
  await RAPIER.init();
  for (const act of [tip, slam]) {
    const sim = make();
    try {
      const cap = sim.robot.held.length;
      act(sim);
      expect(sim.robot.held.length).toBeLessThan(cap);
      expect(sim.robot.held.length).toBeGreaterThanOrEqual(Math.ceil(sim.robot.config.hopperCapacity * 0.6));
    } finally { sim.dispose(); }
  }
});

it('a shallow load (5 FUEL) stays in the robot', async () => {
  await RAPIER.init();
  for (const act of [tip, slam]) {
    const sim = make(undefined, 5);
    try { act(sim); expect(sim.robot.held.length).toBe(5); } finally { sim.dispose(); }
  }
});

it('netted hoppers (1323 MadTown) never spill', async () => {
  await RAPIER.init();
  const cfg = season().teamRobots!.find(t => t.team === 1323)!.config;
  expect(cfg.hopperCovered).toBe(true);
  for (const act of [tip, slam]) {
    const sim = make(cfg);
    try { const n = sim.robot.held.length; act(sim); expect(sim.robot.held.length).toBe(n); } finally { sim.dispose(); }
  }
});
