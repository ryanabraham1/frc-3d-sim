import { afterEach, beforeAll, expect, it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { SEASONS } from '../src/seasons';
import { cloneConfig } from '../src/engine/robot/config';
import { HeadlessSim } from '../src/engine/testing/headless';
import { IDLE_COMMAND } from '../src/engine/robot/robot';
import * as C from '../src/seasons/2026-rebuilt/constants';

const season = SEASONS.find((s) => s.id === '2026-rebuilt')!;
const sims: HeadlessSim[] = [];
beforeAll(async () => { await RAPIER.init(); });
afterEach(() => { for (const sim of sims.splice(0)) sim.dispose(); });

const robotOf = (team: number) => cloneConfig(season.teamRobots!.find((t) => t.team === team)!.config);

it('9496 throws FUEL out the intake end, so it turns its intake toward the HUB to shoot', () => {
  const c = robotOf(9496);
  expect(c.launcher.reversed).toBe(true);
  // Shooter end starts toward the HUB (+x); auto-align must swing the intake round to face it.
  const sim = new HeadlessSim(season, RAPIER, { robot: c, alliance: 'blue', pose: { x: C.HUB_CENTER.x - 2.6, y: C.HUB_CENTER.y, yaw: 0 } });
  sims.push(sim);
  sim.load(8);
  sim.run(3, { ...IDLE_COMMAND, shoot: true });
  expect(Math.cos(sim.robot.pose.yaw)).toBeLessThan(-0.95);
  expect(sim.fired).toBeGreaterThan(0);
});

it('a shot leaves at the launcher height, not above the hopper roof, and is not shoved by its own chassis', () => {
  const c = robotOf(9496);
  const sim = new HeadlessSim(season, RAPIER, { robot: c, alliance: 'blue', pose: { x: C.HUB_CENTER.x - 2.6, y: C.HUB_CENTER.y, yaw: Math.PI } });
  sims.push(sim);
  sim.load(4);
  const ex = sim.robot.launcherExit(0);
  expect(ex.up).toBeLessThan(c.height + 0.05);
  sim.run(1.5, { ...IDLE_COMMAND, shoot: true });
  expect(sim.fired).toBeGreaterThan(0);
});

it('net hopper robots stretch to hold more FUEL', () => {
  for (const team of [9496, 6329, 7769, 5940]) {
    const c = robotOf(team);
    expect(c.hopperExpansion, `${team} net`).toBeDefined();
    expect(c.hopperCapacity).toBeGreaterThan(c.hopperExpansion!.startCount);
  }
});
