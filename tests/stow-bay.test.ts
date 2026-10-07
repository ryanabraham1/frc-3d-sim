import { expect, it } from 'vitest';
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { SEASONS } from '../src/seasons';
import { HeadlessSim } from '../src/engine/testing/headless';
import { cloneConfig } from '../src/engine/robot/config';
import { IDLE_COMMAND } from '../src/engine/robot/robot';
import type { RobotCommand } from '../src/engine/robot/robot';

const season = () => SEASONS.find(s => s.year === 2026)!;
const make = (config = season().robotDefaults, load = 0, pose = { x: 2, y: 2, yaw: 0 }) => {
  const sim = new HeadlessSim(season(), RAPIER, { robot: cloneConfig(config), alliance: 'blue', pose });
  sim.robot.enabled = true;
  sim.load(load);
  return sim;
};
const run = (sim: HeadlessSim, frames: number, cmd: RobotCommand = IDLE_COMMAND) => {
  for (let i = 0; i < frames; i++) { sim.step(cmd); sim.step(cmd); sim.robot.syncVisual(1 / 45); }
};
const local = (sim: HeadlessSim, i: number) => {
  const p = sim.pool.bodies[i].translation(), t = sim.robot.body.translation(), r = sim.robot.body.rotation();
  // Robot-frame position (the chassis here is only yawed).
  const yaw = 2 * Math.atan2(r.y, r.w), c = Math.cos(yaw), s = Math.sin(yaw);
  const dx = p.x - t.x, dz = p.z - t.z;
  return { x: dx * c - dz * s, y: p.y - t.y, z: dx * s + dz * c };
};

it('held FUEL are the pool\'s own live bodies, resting inside the hopper walls', async () => {
  await RAPIER.init();
  const sim = make(undefined, 20);
  try {
    expect(sim.robot.bay).not.toBeNull();
    run(sim, 120);
    const cav = sim.robot.fuelCavity()!;
    expect(sim.robot.bay!.stowed.size).toBe(20);
    for (const i of sim.robot.held) {
      expect(sim.pool.isStowed(i)).toBe(true);
      expect(sim.pool.bodies[i].isEnabled()).toBe(true);
      const p = local(sim, i);
      expect(p.x).toBeGreaterThan(cav.min.x - 0.01); expect(p.x).toBeLessThan(cav.max.x + 0.01);
      expect(Math.abs(p.z)).toBeLessThan(Math.max(cav.max.z, -cav.min.z) + 0.01);
      expect(p.y).toBeGreaterThan(cav.min.y); expect(p.y).toBeLessThan(cav.max.y + 0.01);
    }
  } finally { sim.dispose(); }
});

it('a captured ball is counted and drawn immediately, then pulled into the hopper as the same body', async () => {
  await RAPIER.init();
  const sim = make();
  try {
    const r = sim.robot, side = r.fuelIntakeSide();
    const t = r.body.translation();
    // Put a ball just in front of the intake mouth and run the intake.
    const idx = sim.pool.indices('reserve')[0];
    sim.pool.placeWorld(idx, new THREE.Vector3(t.x + side * (r.config.frameLength / 2 + 0.2), 0.08, t.z), undefined);
    const cmd = { ...IDLE_COMMAND, intake: true };
    let capturedAt = -1;
    for (let k = 0; k < 120 && capturedAt < 0; k++) { sim.step(cmd); if (r.held.length) capturedAt = k; }
    expect(capturedAt).toBeGreaterThanOrEqual(0);
    expect(r.held).toEqual([idx]);
    expect(sim.pool.bodies[idx].isEnabled()).toBe(true);
    expect(r.piecesInTransit).toBe(0);
    run(sim, 60, cmd);
    expect(r.bay!.stowed.has(idx)).toBe(true);
  } finally { sim.dispose(); }
});

it('an open hopper keeps intaking past full: extras roll over the rim as the same bodies, nothing is spawned', async () => {
  await RAPIER.init();
  const team = season().teamRobots!.find(t => t.team === 971)!;
  const sim = make(team.config, team.config.hopperCapacity);
  try {
    const r = sim.robot;
    expect(r.openHopper).toBe(true);
    run(sim, 120);
    const before = new Set(r.held);
    const poolBodies = sim.pool.count;
    // Feed more balls straight into the mouth than the hopper can hold.
    const side = r.fuelIntakeSide(), t = r.body.translation();
    const extras = sim.pool.indices('reserve').slice(0, 10);
    for (const i of extras) sim.pool.hold(i, r.id), r.held.push(i);
    run(sim, 240);
    expect(sim.pool.count).toBe(poolBodies);
    // Everything is accounted for: held, or loose on the field, never duplicated.
    const heldNow = new Set(r.held), escaped = [...before, ...extras].filter(i => !heldNow.has(i));
    for (const i of heldNow) expect(sim.pool.state[i]).toBe('held');
    for (const i of escaped) {
      expect(sim.pool.state[i]).toBe('field');
      expect(sim.pool.isStowed(i)).toBe(false);
    }
    void side; void t;
  } finally { sim.dispose(); }
});

it('shooting takes the ball nearest the launcher and that ball leaves, the rest stay', async () => {
  await RAPIER.init();
  const sim = make(undefined, 12);
  try {
    run(sim, 90);
    const before = new Set(sim.robot.held);
    run(sim, 30, { ...IDLE_COMMAND, shoot: true });
    expect(sim.robot.held.length).toBeLessThan(12);
    const gone = [...before].filter(i => !sim.robot.held.includes(i));
    for (const i of gone) expect(sim.pool.state[i]).toBe('field');
    for (const i of sim.robot.held) expect(sim.pool.isStowed(i)).toBe(true);
  } finally { sim.dispose(); }
});

it('every 2026 robot with a hopper holds its full rated load and loses none at rest', async () => {
  await RAPIER.init();
  const robots = [season().robotDefaults, ...season().teamRobots!.map(t => t.config)];
  let withBay = 0;
  for (const config of robots) {
    const sim = make(config);
    try {
      const r = sim.robot;
      r.optimizeVisual();
      if (!r.bay) continue;
      withBay++;
      const cap = r.config.hopperCapacity;
      sim.load(cap);
      run(sim, 150);
      expect([config.model, r.held.length, r.bay.count]).toEqual([config.model, cap, cap]);
      expect(sim.pool.indices('field').length).toBe(0);
    } finally { sim.dispose(); }
  }
  expect(withBay).toBeGreaterThanOrEqual(15);
}, 120000);

it('a deep pile simulates only its top layers; the buried ones ride the chassis and come back when the pile is used up', async () => {
  await RAPIER.init();
  const sim = make(undefined, 0);
  try {
    const r = sim.robot, bay = r.bay!;
    sim.load(60);
    run(sim, 200);
    // The lower layers are buried, nothing is lost, and every ball is still inside the hopper.
    expect(bay.count).toBe(60);
    expect(r.held.length).toBe(60);
    expect(bay.buriedCount).toBeGreaterThan(0);
    expect(bay.stowed.size).toBeLessThan(60);
    expect(bay.stowed.size).toBeGreaterThanOrEqual(8);
    const cav = r.fuelCavity()!;
    for (const i of r.held) {
      const p = local(sim, i);
      expect(p.x).toBeGreaterThan(cav.min.x - 0.02); expect(p.x).toBeLessThan(cav.max.x + 0.02);
      expect(p.y).toBeGreaterThan(cav.min.y - 0.02);
    }
    // Driving carries the buried layers with the robot: they stay at the same spot in the hopper.
    const before = r.held.map(i => local(sim, i));
    run(sim, 90, { ...IDLE_COMMAND, vx: 1.5 });
    const after = r.held.map(i => local(sim, i));
    const drift = Math.max(...before.map((b, k) => Math.hypot(b.x - after[k].x, b.z - after[k].z)));
    expect(drift).toBeLessThan(0.3);
    // Shooting everything wakes the buried layers as the live ones run out: every ball leaves, none is stranded.
    run(sim, 900, { ...IDLE_COMMAND, shoot: true });
    expect(r.held.length).toBe(0);
    expect(bay.count).toBe(0);
  } finally { sim.dispose(); }
}, 120000);

it('a ball taken in on top of a buried pile lands above the raised floor and stays in the hopper', async () => {
  await RAPIER.init();
  const sim = make(undefined, 0);
  try {
    const r = sim.robot, bay = r.bay!;
    sim.load(38);
    run(sim, 200);
    expect(bay.buriedCount).toBeGreaterThan(0);
    const side = r.fuelIntakeSide(), t = r.body.translation();
    const idx = sim.pool.indices('reserve')[0];
    sim.pool.placeWorld(idx, new THREE.Vector3(t.x + side * (r.config.frameLength / 2 + 0.2), 0.08, t.z), undefined);
    run(sim, 150, { ...IDLE_COMMAND, intake: true });
    expect(r.held).toContain(idx);
    expect(bay.count).toBe(r.held.length);
    const cav = r.fuelCavity()!, p = local(sim, idx);
    expect(p.x).toBeGreaterThan(cav.min.x - 0.02); expect(p.x).toBeLessThan(cav.max.x + 0.02);
    expect(p.y).toBeGreaterThan(cav.min.y);
  } finally { sim.dispose(); }
}, 120000);
