import { afterEach, beforeAll, expect, it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { SEASONS } from '../src/seasons';
import { cloneConfig, hopperNetArea, hopperNetCeiling, loadedRobotHeight } from '../src/engine/robot/config';
import { HeadlessSim } from '../src/engine/testing/headless';
import { IDLE_COMMAND } from '../src/engine/robot/robot';
import * as C from '../src/seasons/2026-rebuilt/constants';

const season = SEASONS.find(s => s.id === '2026-rebuilt')!;
const sims: HeadlessSim[] = [];
beforeAll(async () => { await RAPIER.init(); });
afterEach(() => { for (const sim of sims.splice(0)) sim.dispose(); });

it('the requested 2026 dumper rates survive normalization', () => {
  for (const [team, rate] of [[254,25],[3476,20],[2910,33]]) {
    const c = season.teamRobots!.find(t => t.team === team)!.config;
    expect(season.normalizeRobotConfig!(cloneConfig(c)).launcher.rate).toBe(rate);
  }
});

for (const team of [254,4414]) it(`${team}: expanded net physically blocks a full hopper at the trench and retracts when emptied`, () => {
  const c = cloneConfig(season.teamRobots!.find(t => t.team === team)!.config);
  const start = { x: C.HUB_CENTER.x - 2, y: C.TRENCH_OPENING_CENTER_Y, yaw: 0 };
  const sim = new HeadlessSim(season, RAPIER, { robot: c, alliance: 'blue', pose: start }); sims.push(sim);
  const r = sim.robot, threshold = c.hopperExpansion!.startCount;
  expect(loadedRobotHeight(c, threshold)).toBeLessThan(C.TRENCH_CLEARANCE);
  r.syncVisual(0.05);
  sim.load(c.hopperCapacity);
  const net = r.visual.getObjectByName(team === 1678 ? 'telescoping-hopper-net' : 'stretching-hopper-net') as THREE.LineSegments;
  expect(net).toBeDefined();
  const netTop = () => { const q = net.geometry.getAttribute('position'); let m = 0; for (let i = 0; i < q.count; i++) m = Math.max(m, q.getY(i)); return m; };
  // The bulge creeps up over several frames instead of jumping to the full envelope.
  const steps: number[] = [];
  for (let k = 0; k < 4; k++) { r.syncVisual(0.05); steps.push(netTop()); }
  expect(steps[0]).toBeLessThan(steps[3]);
  for (let k = 0; k < 60; k++) r.syncVisual(0.05); // settle
  expect(steps[0]).toBeLessThan(netTop() - 0.02);
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
  for (let k = 0; k < 60; k++) r.syncVisual(0.05);
  expect(r.clearanceHeight).toBe(c.height);
  if(team === 1678) expect(r.visual.getObjectByName('telescoping-hopper-roof')!.position.y).toBe(0);
  expect(r.body.mass()).toBeCloseTo(mass, 3);
  sim.run(3, { ...IDLE_COMMAND, vx: 2 });
  expect(r.pose.x).toBeGreaterThan(C.HUB_CENTER.x + C.TRENCH_DEPTH / 2 + 0.5);
});

it('net and telescoping expansion do not inflate the requested total capacities', () => {
  for(const [team,capacity] of [[254,62],[1678,65],[2910,40],[604,85],[9470,62],[9128,45],[971,35],[581,65],[6800,51],[4414,85],[1323,74]]) {
    const c=season.teamRobots!.find(t=>t.team===team)!.config;
    expect(c.hopperCapacity).toBe(capacity);
    expect(season.normalizeRobotConfig!(cloneConfig(c)).hopperCapacity).toBe(capacity);
    if(c.hopperExpansion) expect(c.hopperExpansion.startCount).toBeLessThan(capacity);
  }
});

for (const team of [254, 4414]) it(`${team}: intaking through the trench stops at the trench-safe load instead of jamming, then resumes after`, () => {
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
    // Under = the robot overlaps the arm (a 6in tube over the opening; the 47in TRENCH depth is the pedestal).
    const under = r.overheadLimit < Infinity && Math.abs(r.pose.x - hubX) < C.TRENCH_ARM_DEPTH / 2 + r.footprint.length / 2;
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

for (const [team, oldHeight] of [[971, 0.638352], [6800, 0.63]]) it(`${team} migrates its saved raised-hood height without changing custom heights`, () => {
  const c = cloneConfig(season.teamRobots!.find(t => t.team === team)!.config);
  c.height = oldHeight;
  expect(season.normalizeRobotConfig!(c).height).toBe(0.55);
  c.height = 0.762;
  expect(season.normalizeRobotConfig!(c).height).toBe(0.762);
});

for(const team of [971,6800]) it(`${team} uses its compact travel height and physically clears the trench with a trench-safe load`,()=>{
  const c=cloneConfig(season.teamRobots!.find(t=>t.team===team)!.config);
  expect(c.height).toBeLessThan(C.TRENCH_SAFE_HEIGHT);
  const sim=new HeadlessSim(season,RAPIER,{robot:c,alliance:'blue',pose:{x:C.HUB_CENTER.x-2,y:C.TRENCH_OPENING_CENTER_Y,yaw:0}});sims.push(sim);
  // 6800's net bulges above the TRENCH past its rigid load; up to that load it clears.
  sim.load(c.hopperExpansion?.startCount ?? c.hopperCapacity);
  expect(sim.robot.clearanceHeight).toBeLessThan(C.TRENCH_CLEARANCE);
  sim.run(4,{...IDLE_COMMAND,vx:2});
  expect(sim.robot.pose.x).toBeGreaterThan(C.HUB_CENTER.x+C.TRENCH_DEPTH/2+.5);
});


it('1678 manually toggles capacity and clearance, preserves excess fuel, and cannot raise under the trench', () => {
  const c = cloneConfig(season.teamRobots!.find(t => t.team === 1678)!.config);
  const sim = new HeadlessSim(season, RAPIER, { robot: c, alliance: 'blue', pose: { x: 2, y: 2, yaw: 0 } }); sims.push(sim);
  const r = sim.robot;
  expect(r.hopperCapacity).toBe(50);
  sim.load(50);
  expect(r.capacityLeft).toBe(0);
  expect(r.clearanceHeight).toBe(c.height);
  r.drive({ ...IDLE_COMMAND, block: true }, .02);
  expect(r.hopperCapacity).toBe(65);
  expect(r.capacityLeft).toBe(15);
  expect(r.clearanceHeight).toBe(c.hopperExpansion!.fullHeight);
  sim.load(15);
  r.drive(IDLE_COMMAND, .02);
  expect(r.hopperRaised).toBe(true);
  expect(r.held.length).toBe(65);
  for (const i of r.held.splice(50)) sim.pool.reserve(i);
  r.drive(IDLE_COMMAND, .02);
  expect(r.hopperCapacity).toBe(50);
  expect(r.clearanceHeight).toBe(c.height);
  r.overheadLimit = C.TRENCH_SAFE_HEIGHT;
  r.drive({ ...IDLE_COMMAND, block: true }, .02);
  expect(r.hopperRaised).toBe(false);
  r.overheadLimit = Infinity;
  r.drive({ ...IDLE_COMMAND, block: true }, .02);
  for(let i=0;i<60;i++) r.syncVisual(.05);
  expect(r.visual.getObjectByName('telescoping-hopper-roof')!.position.y).toBeCloseTo(c.hopperExpansion!.fullHeight-c.height);
  r.drive(IDLE_COMMAND, .02);
  for(let i=0;i<60;i++) r.syncVisual(.05);
  expect(r.visual.getObjectByName('telescoping-hopper-roof')!.position.y).toBe(0);
});

for (const team of [581, 6800, 1323, 9470]) it(`${team}: its net stays at the rim up to the rigid load and stretches past TRENCH height when full`, () => {
  const c = cloneConfig(season.teamRobots!.find(t => t.team === team)!.config);
  const e = c.hopperExpansion!;
  expect(e.mechanism).toBeUndefined();
  const sim = new HeadlessSim(season, RAPIER, { robot: c, alliance: 'blue', pose: { x: 2, y: 2, yaw: 0 } }); sims.push(sim);
  const r = sim.robot;
  sim.load(e.startCount);
  expect(r.clearanceHeight).toBe(c.height);
  sim.load(c.hopperCapacity - e.startCount);
  expect(r.held.length).toBe(c.hopperCapacity);
  expect(r.clearanceHeight).toBeCloseTo(e.fullHeight);
  expect(r.clearanceHeight).toBeGreaterThan(C.TRENCH_SAFE_HEIGHT);
});

it('a FUEL entering a slack net lands at the rim, not up in the fully stretched dome', () => {
  const c = cloneConfig(season.teamRobots!.find(t => t.team === 6800)!.config);
  const ceiling = hopperNetCeiling(c, 0.5);
  const cx = hopperNetArea(c).cx;
  expect(ceiling(cx, 0)).toBeCloseTo(c.hopperExpansion!.fullHeight);
  ceiling.setStretch(0);
  expect(ceiling(cx, 0)).toBeCloseTo(0.5);
  ceiling.setStretch(0.5);
  expect(ceiling(cx, 0)).toBeCloseTo((0.5 + c.hopperExpansion!.fullHeight) / 2);
  // Robot drives the stretch from its drawn net: a lightly loaded net robot keeps its pile ceiling at the rim.
  const m = cloneConfig(season.teamRobots!.find(t => t.team === 1323)!.config);
  const sim = new HeadlessSim(season, RAPIER, { robot: m, alliance: 'blue', pose: { x: 2, y: 2, yaw: 0 } }); sims.push(sim);
  sim.load(5);
  for (let i = 0; i < 30; i++) sim.robot.syncVisual(.05);
  let tallest = 0;
  sim.robot.visual.traverse(o => { const f = o.userData.fuelCeiling; if (f) tallest = Math.max(tallest, f(-m.frameLength * 0.1, 0)); });
  expect(tallest).toBeGreaterThan(0);
  expect(tallest).toBeLessThan(m.height + 0.01);
});

it('the stretching net rises only where actual balls push it, while its rim stays anchored', () => {
  const c = cloneConfig(season.teamRobots!.find(t => t.team === 254)!.config);
  const sim = new HeadlessSim(season, RAPIER, { robot: c, alliance: 'blue', pose: { x: 2, y: 2, yaw: 0 } }); sims.push(sim);
  const r = sim.robot;
  r.detachPool(sim.pool);
  r.held.length = c.hopperCapacity;
  // Isolate fabric response from the pile solver: no contact points, despite a full requested load.
  let positions = new Float32Array();
  r.visual.traverse(o => {
    if (o.userData.fuelSurface) o.userData.fuelSurface = () => ({ positions, count: positions.length / 3, radius: .075 });
  });
  const net = r.visual.getObjectByName('stretching-hopper-net') as THREE.LineSegments;
  const maxY = () => {
    const p = net.geometry.getAttribute('position'); let top = 0;
    for (let i = 0; i < p.count; i++) top = Math.max(top, p.getY(i));
    return top;
  };
  for (let i = 0; i < 60; i++) r.syncVisual(.05);
  expect(maxY()).toBeLessThanOrEqual(c.height + .001);
  // A single upper ball raises the cloth locally. The rest remains tied to the rigid rim.
  positions = new Float32Array([-c.frameLength * .1, c.hopperExpansion!.fullHeight - .075, 0]);
  for (let i = 0; i < 60; i++) r.syncVisual(.05);
  expect(maxY()).toBeGreaterThan(c.height + .04);
  const p = net.geometry.getAttribute('position'), grid = net.userData.grid as number[];
  for (let i = 0; i < p.count; i++) {
    if (Math.abs(grid[i * 3]) === 1 || Math.abs(grid[i * 3 + 2]) === 1) expect(p.getY(i)).toBeCloseTo(c.height, 3);
  }
  expect(net.getObjectByName('stretching-hopper-cords')).toBeDefined();
});

it('254 Overload stays trench-safe up to 50 FUEL, then swells past the TRENCH', () => {
  const c = season.normalizeRobotConfig!(cloneConfig(season.teamRobots!.find(t => t.team === 254)!.config));
  expect(loadedRobotHeight(c, 50)).toBeLessThanOrEqual(C.TRENCH_SAFE_HEIGHT);
  expect(loadedRobotHeight(c, 51)).toBeGreaterThan(C.TRENCH_SAFE_HEIGHT);
  expect(loadedRobotHeight(c, c.hopperCapacity)).toBeCloseTo(c.hopperExpansion!.fullHeight, 5);
});
