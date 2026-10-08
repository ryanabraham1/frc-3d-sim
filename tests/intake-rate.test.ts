import { afterEach, beforeAll, expect, it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { SEASONS } from '../src/seasons';
import { cloneConfig } from '../src/engine/robot/config';
import { HeadlessSim } from '../src/engine/testing/headless';

const season = SEASONS.find((s) => s.id === '2026-rebuilt')!;
const sims: HeadlessSim[] = [];
beforeAll(async () => { await RAPIER.init(); });
afterEach(() => { for (const sim of sims.splice(0)) sim.dispose(); });

/** FUEL swallowed in `seconds` when the intake always has more FUEL at the mouth. */
function swallowed(rate: number | undefined, seconds: number): number {
  const c = cloneConfig(season.teamRobots![0].config);
  c.hopperCapacity = 500;
  c.intake.rate = rate;
  const sim = new HeadlessSim(season, RAPIER, { robot: c, alliance: 'blue', pose: { x: 3, y: 4, yaw: 0 } });
  sims.push(sim);
  const r = sim.robot, dt = sim.physics.dt;
  let n = 0;
  for (let t = 0; t < seconds; t += dt) {
    r.tickIntake(dt);
    while (r.intakeRoom > 0 && r.held.length < 500) { r.held.push(-1); n++; r.tickIntake(0); }
  }
  return n;
}

it('a robot with an intake rate takes in roughly that many FUEL per second', () => {
  const n = swallowed(10, 5);
  expect(n).toBeGreaterThan(10 * 5 - 2);
  expect(n).toBeLessThan(10 * 5 + 6); // the small start-up burst
});

it('a faster intake loads more FUEL than a slower one, and none means unlimited', () => {
  expect(swallowed(18, 3)).toBeGreaterThan(swallowed(11, 3));
  expect(swallowed(undefined, 1)).toBe(500);
});

it('every 2026 team robot declares an intake rate and the faster loaders are the wide, uninterrupted ones', () => {
  const byTeam = new Map(season.teamRobots!.map((t) => [t.team, t.config.intake.rate]));
  for (const [team, rate] of byTeam) expect(rate, `${team}`).toBeGreaterThan(0);
  expect(byTeam.get(4414)!).toBeGreaterThan(byTeam.get(971)!);
});
