import { afterEach, beforeAll, expect, it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { HeadlessSim } from '../src/engine/testing/headless';
import { rebuilt2026 as season } from '../src/seasons/2026-rebuilt';
import { cloneConfig } from '../src/engine/robot/config';
const sims: HeadlessSim[] = [];
beforeAll(async () => { await RAPIER.init(); });
afterEach(() => { for (const sim of sims.splice(0)) sim.dispose(); });
function sample(exits: number, unevenFeed: boolean, turret = false) {
  const config = cloneConfig(season.robotDefaults);
  Object.assign(config.launcher, { exits, unevenFeed, turret });
  if (turret) { config.launcher.exits = 1; config.launcher.mounts = [{ forward: 0, side: -.2 }, { forward: 0, side: .2 }]; }
  const sim = new HeadlessSim(season, RAPIER, { robot: config, alliance: 'blue', pose: { x: 2, y: 2, yaw: 0 }, mechHopper: false });
  sims.push(sim);
  const robot = sim.robot;
  robot.shootWhileTracking = true;
  robot.packLimit = false;
  robot.held.push(0);
  const lanes: number[] = [], intervals: number[] = [];
  for (let i = 0; i < 400; i++) {
    robot.fireCooldown = 0;
    const shot = robot.launch(null, sim.rng)!;
    expect(shot).not.toBeNull();
    lanes.push(shot.pos.z);
    intervals.push(robot.fireCooldown * config.launcher.rate);
  }
  robot.fireCooldown = 0;
  let shots = 0;
  for (let frame = 0; frame < 9000; frame++) {
    robot.tick(sim.physics.dt);
    if (robot.launch(null, sim.rng)) shots++;
  }
  const bps = shots / (9000 * sim.physics.dt);
  if (unevenFeed) {
    expect(bps / config.launcher.rate).toBeGreaterThan(.95);
    expect(bps / config.launcher.rate).toBeLessThan(1.05);
  }
  return { lanes, intervals };
}
it('wide fuel feed revisits lanes and varies gaps without changing mean feed interval', () => {
  const { lanes, intervals } = sample(4, true);
  expect(new Set(lanes).size).toBe(4);
  expect(lanes.some((lane, i) => i > 0 && lane === lanes[i - 1])).toBe(true);
  expect(Math.min(...intervals)).toBeLessThan(.6);
  expect(Math.max(...intervals)).toBeGreaterThan(1.4);
  expect(intervals.reduce((a, b) => a + b, 0) / intervals.length).toBeCloseTo(1, 1);
});
it('turret and single-exit fuel shooters also have uneven cadence', () => {
  for (const result of [sample(1, true), sample(2, true, true)]) {
    expect(Math.min(...result.intervals)).toBeLessThan(.6);
    expect(Math.max(...result.intervals)).toBeGreaterThan(1.4);
    expect(result.intervals.reduce((a, b) => a + b, 0) / result.intervals.length).toBeCloseTo(1, 1);
  }
});
it('shooters without loose fuel feeding retain fixed cadence', () => {
  expect(new Set(sample(1, false).intervals)).toEqual(new Set([1]));
  const { lanes, intervals } = sample(2, false);
  expect(new Set(intervals)).toEqual(new Set([1]));
  expect(lanes[0]).toBe(lanes[2]);
  expect(lanes[0]).not.toBe(lanes[1]);
});
