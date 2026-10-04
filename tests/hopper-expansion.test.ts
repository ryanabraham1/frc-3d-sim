import { afterEach, beforeAll, expect, it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { SEASONS } from '../src/seasons';
import { cloneConfig, loadedRobotHeight } from '../src/engine/robot/config';
import { HeadlessSim } from '../src/engine/testing/headless';
import { IDLE_COMMAND } from '../src/engine/robot/robot';
import * as C from '../src/seasons/2026-rebuilt/constants';

const season = SEASONS.find(s => s.year === 2026)!;
const sims: HeadlessSim[] = [];
beforeAll(async () => { await RAPIER.init(); });
afterEach(() => { for (const sim of sims.splice(0)) sim.dispose(); });

it('the requested 2026 dumper rates survive normalization', () => {
  for (const [team, rate] of [[254,25],[3476,20],[2910,33]]) {
    const c = season.teamRobots!.find(t => t.team === team)!.config;
    expect(season.normalizeRobotConfig!(cloneConfig(c)).launcher.rate).toBe(rate);
  }
});

for (const team of [254,4414,1678]) it(`${team}: expanded net physically blocks a full hopper at the trench and retracts when emptied`, () => {
  const c = cloneConfig(season.teamRobots!.find(t => t.team === team)!.config);
  const start = { x: C.HUB_CENTER.x - 2, y: C.TRENCH_OPENING_CENTER_Y, yaw: 0 };
  const sim = new HeadlessSim(season, RAPIER, { robot: c, alliance: 'blue', pose: start }); sims.push(sim);
  const r = sim.robot, threshold = c.hopperExpansion!.startCount;
  expect(loadedRobotHeight(c, threshold)).toBeLessThan(C.TRENCH_CLEARANCE);
  sim.load(c.hopperCapacity); r.syncVisual(0.05);
  const net = r.visual.getObjectByName(team === 1678 ? 'telescoping-hopper-net' : 'stretching-hopper-net') as THREE.LineSegments;
  expect(net).toBeDefined();
  if(team === 1678) {
    expect(r.visual.getObjectByName('stretching-hopper-net')).toBeUndefined();
    const roof = r.visual.getObjectByName('telescoping-hopper-roof')!;
    expect(roof.position.y).toBeCloseTo(c.hopperExpansion!.fullHeight-c.height);
  }
  const p = net.geometry.getAttribute('position');
  let maxY = 0; for (let i = 0; i < p.count; i++) maxY = Math.max(maxY,p.getY(i));
  expect(maxY).toBeGreaterThan(C.TRENCH_CLEARANCE);
  expect(r.clearanceHeight).toBeGreaterThan(C.TRENCH_CLEARANCE);
  const mass = r.body.mass();
  sim.run(2.5, { ...IDLE_COMMAND, vx: 2 });
  expect(r.pose.x).toBeLessThan(C.HUB_CENTER.x + C.TRENCH_DEPTH / 2);
  // Emptying lowers the collision envelope and allows the same robot through.
  for (const i of r.held) sim.pool.reserve(i); r.held.length = 0;
  r.syncVisual(0.05);
  expect(r.clearanceHeight).toBe(c.height);
  if(team === 1678) expect(r.visual.getObjectByName('telescoping-hopper-roof')!.position.y).toBe(0);
  expect(r.body.mass()).toBeCloseTo(mass, 3);
  sim.run(3, { ...IDLE_COMMAND, vx: 2 });
  expect(r.pose.x).toBeGreaterThan(C.HUB_CENTER.x + C.TRENCH_DEPTH / 2 + 0.5);
});

it('net and telescoping expansion do not inflate the requested total capacities', () => {
  for(const [team,capacity] of [[254,50],[1678,60],[2910,40],[971,33]]) {
    const c=season.teamRobots!.find(t=>t.team===team)!.config;
    expect(c.hopperCapacity).toBe(capacity);
    expect(season.normalizeRobotConfig!(cloneConfig(c)).hopperCapacity).toBe(capacity);
    if(c.hopperExpansion) expect(c.hopperExpansion.startCount).toBeLessThan(capacity);
  }
});

for (const team of [254, 4414, 1678]) it(`${team}: intaking through the trench stops at the trench-safe load instead of jamming, then resumes after`, () => {
  const c = cloneConfig(season.teamRobots!.find(t => t.team === team)!.config);
  let safe = c.hopperExpansion!.startCount;
  while (loadedRobotHeight(c, safe + 1) <= C.TRENCH_SAFE_HEIGHT) safe++;
  const hubX = C.HUB_CENTER.x, y = C.TRENCH_OPENING_CENTER_Y;
  // Intake is on the back: face away from travel (yaw π) with FUEL strewn inside the trench and beyond it.
  const sim = new HeadlessSim(season, RAPIER, { robot: c, alliance: 'blue', pose: { x: hubX - 2.2, y, yaw: Math.PI } }); sims.push(sim);
  const r = sim.robot;
  sim.load(safe);
  sim.scatter([-0.9, -0.5, -0.1, 0.3, 0.7, 1.2, 1.5, 1.8].map((dx, k) => ({ x: hubX + dx, y: y + (k % 2 ? 0.1 : -0.1) })));
  let peak = 0, inside = 0;
  sim.run(8, { ...IDLE_COMMAND, vx: 1.5, intake: true }, () => {
    const under = r.overheadLimit < Infinity && Math.abs(r.pose.x - hubX) < C.TRENCH_DEPTH / 2;
    if (under) { peak = Math.max(peak, r.clearanceHeight); inside = Math.max(inside, r.held.length); }
    return false;
  });
  expect(inside).toBe(safe);
  expect(peak).toBeLessThanOrEqual(C.TRENCH_SAFE_HEIGHT);
  expect(r.pose.x).toBeGreaterThan(hubX + C.TRENCH_DEPTH / 2 + 0.5);
  expect(r.held.length).toBeGreaterThan(safe);
});

it('a net robot under the trench may keep intaking below the trench-safe load, and a plain robot is never limited', () => {
  const c = cloneConfig(season.teamRobots!.find(t => t.team === 254)!.config);
  const sim = new HeadlessSim(season, RAPIER, { robot: c, alliance: 'blue', pose: { x: C.HUB_CENTER.x, y: C.TRENCH_OPENING_CENTER_Y, yaw: 0 } }); sims.push(sim);
  const r = sim.robot;
  let safe = c.hopperExpansion!.startCount;
  while (loadedRobotHeight(c, safe + 1) <= C.TRENCH_SAFE_HEIGHT) safe++;
  sim.load(safe - 3);
  r.overheadLimit = sim.rules.overheadClearance!(r);
  expect(r.overheadLimit).toBe(C.TRENCH_SAFE_HEIGHT);
  expect(r.intakeRoom).toBe(3);
  const plain = new HeadlessSim(season, RAPIER, { robot: cloneConfig(season.robotDefaults), alliance: 'blue', pose: { x: C.HUB_CENTER.x, y: C.TRENCH_OPENING_CENTER_Y, yaw: 0 } }); sims.push(plain);
  expect(plain.rules.overheadClearance!(plain.robot)).toBe(Infinity);
});
