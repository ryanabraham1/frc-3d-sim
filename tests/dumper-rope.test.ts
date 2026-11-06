import { beforeAll, expect, it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { DumperStream, type DumperBall } from '../src/engine/robot/dumperStream';
import { Rng } from '../src/engine/random';
import { HeadlessSim } from '../src/engine/testing/headless';
import { IDLE_COMMAND } from '../src/engine/robot/robot';
import { rebuilt2026 as season } from '../src/seasons/2026-rebuilt';
import * as C from '../src/seasons/2026-rebuilt/constants';

beforeAll(async () => { await RAPIER.init(); });

const SPREAD = 0.02, SPEED = 0.03, RATE = 30, LANES = 4;
function stream(count: number, fill = 1): { balls: DumperBall[]; lanes: number[] } {
  const rng = new Rng(5), s = new DumperStream(), balls: DumperBall[] = [], lanes = [0];
  for (let i = 0; i < count; i++) {
    const b = s.next(rng, LANES, SPREAD, SPEED, RATE, fill);
    balls.push(b);
    lanes.push(b.nextLane);
  }
  return { balls, lanes };
}
const sd = (v: number[]) => { const m = v.reduce((a, b) => a + b, 0) / v.length; return Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / v.length); };
function correlation(a: number[], b: number[]): number {
  const ma = a.reduce((x, y) => x + y, 0) / a.length, mb = b.reduce((x, y) => x + y, 0) / b.length;
  return a.reduce((sum, x, i) => sum + (x - ma) * (b[i] - mb), 0) / a.length / (sd(a) * sd(b));
}

it('balls leave in touching clumps from side-by-side lanes, with gaps between clumps', () => {
  const { balls, lanes } = stream(4000);
  const inClump = balls.map(b => b.interval < 0.01);
  const share = inClump.filter(Boolean).length / balls.length;
  expect(share).toBeGreaterThan(0.4);
  expect(share).toBeLessThan(0.65);
  balls.forEach((_, i) => { if (inClump[i]) expect(Math.abs(lanes[i + 1] - lanes[i])).toBe(1); });
  expect(Math.min(...balls.filter((_, i) => !inClump[i]).map(b => b.interval))).toBeGreaterThan(0.01);
  expect(new Set(lanes).size).toBe(LANES);
});

it('the stream averages the rated feed and keeps the configured error per ball', () => {
  const { balls } = stream(20000);
  expect(balls.length / balls.reduce((t, b) => t + b.interval, 0) / RATE).toBeCloseTo(1, 1);
  expect(sd(balls.map(b => b.yawError)) / SPREAD).toBeCloseTo(1, 1);
  expect(sd(balls.map(b => b.pitchError)) / SPREAD).toBeCloseTo(1, 1);
  expect(sd(balls.map(b => b.speedError)) / SPEED).toBeCloseTo(1, 1);
});

it('neighbouring balls fly together and distant ones do not', () => {
  const yaw = stream(20000).balls.map(b => b.yawError);
  expect(correlation(yaw.slice(0, -1), yaw.slice(1))).toBeGreaterThan(0.5);
  expect(Math.abs(correlation(yaw.slice(0, -60), yaw.slice(60)))).toBeLessThan(0.1);
});

it('the last of the load comes in singles at the same feed rate', () => {
  const full = stream(6000).balls, tail = stream(6000, 0.03).balls;
  const mean = (b: DumperBall[]) => b.reduce((t, x) => t + x.interval, 0) / b.length;
  expect(mean(tail) / mean(full)).toBeCloseTo(1, 1);
  expect(tail.filter(b => b.interval < 0.01).length).toBeLessThan(full.filter(b => b.interval < 0.01).length / 4);
});

it.each([2910, 254, 581])('team %s holds its rated BPS through a whole dump', (team) => {
  const config = season.teamRobots!.find(r => r.team === team)!.config;
  let balls = 0, seconds = 0;
  // One dump varies by about 10 % with its clumps, so average a few.
  for (let seed = 1; seed <= 5; seed++) {
    const sim = new HeadlessSim(season, RAPIER, { robot: config, alliance: 'blue', seed, pose: { x: C.HUB_CENTER.x - 2.6, y: C.HUB_CENTER.y, yaw: 0 } });
    try {
      sim.rules.stage();
      sim.load(config.hopperCapacity);
      const robot = sim.robot;
      sim.run(1);
      const times: number[] = [], launch = robot.launch.bind(robot);
      let frame = 0;
      robot.launch = (target, rng) => { const shot = launch(target, rng); if (shot) times.push(frame * sim.physics.dt); return shot; };
      for (; frame < 900 && robot.held.length > 0; frame++) sim.step({ ...IDLE_COMMAND, shoot: true });
      balls += times.length - 1;
      seconds += times.at(-1)! - times[0];
    } finally { sim.dispose(); }
  }
  expect(balls / seconds / config.launcher.rate).toBeGreaterThan(0.96);
  expect(balls / seconds / config.launcher.rate).toBeLessThan(1.06);
}, 120000);
