import { readFileSync } from 'node:fs';
import { beforeAll, expect, it } from 'vitest';
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { decodeCadModel } from '../src/engine/robot/cadModels';
import { robotModelBuilder, type RobotAnimState } from '../src/engine/robot/models';
import { heroTeamRobots } from '../src/seasons/wcp-hero-heist/teamRobots';
import { normalizeHeroConfig, storage, legalClimbLevel } from '../src/seasons/wcp-hero-heist/config';
import { HeadlessSim } from '../src/engine/testing/headless';
import { heroHeist } from '../src/seasons/wcp-hero-heist';
import { IDLE_COMMAND } from '../src/engine/robot/robot';
import { pieceIdentity } from '../src/seasons/wcp-hero-heist/constants';
import { inch } from '../src/engine/units';

const idle: RobotAnimState = { dt: 0, time: 0, enabled: false, intaking: false, firing: 0, passing: false, aiming: false, hood: .85, fill: 0, climb: 0, blocker: 0, place: null, vx: 0, vz: 0, omega: 0 };
const team498 = () => heroTeamRobots().find(r => r.team === 498)!;
beforeAll(async () => {
  const b = readFileSync('public/models/robots/wcp-hero-heist/hero-mystic-498.glb');
  await decodeCadModel('hero-mystic-498', b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
  await RAPIER.init();
});
const build = (alliance: 'blue' | 'red' = 'blue') => {
  const c = team498().config, visual = new THREE.Group(), turret = new THREE.Group(); visual.add(turret);
  const m = robotModelBuilder(c.model)!({ config: c, visual, turret, alliance, fp: { length: .8, width: .8 }, groundSide: -1, stationSide: -1, mats: { dark: new THREE.MeshStandardMaterial(), alu: new THREE.MeshStandardMaterial(), bumper: new THREE.MeshStandardMaterial() } });
  return { c, visual, turret, m };
};
const settle = (m: { update(s: RobotAnimState): void }, s: Partial<RobotAnimState>) => { for (let i = 0; i < 120; i++) m.update({ ...idle, dt: 1 / 60, ...s }); };

it('498 is a six-bubble Mystic with the CAD frame and a legal HIGH climb', () => {
  const c = normalizeHeroConfig(team498().config);
  expect(c.model).toBe('hero-mystic-498');
  expect(storage(c)).toEqual({ panels: 0, bubbles: 6 });
  expect(2 * (c.frameLength + c.frameWidth)).toBeCloseTo(inch(104), 2);
  expect(c.launcher.turret).toBe(true);
  expect(c.climber.maxLevel).toBe(3);
  expect(legalClimbLevel(c.height)).toBe(3);
  expect(c.intake.groundSide).toBe('back');
});

it('stows legal, then deploys the back intake, tracks the turret, tilts the hood and extends the telescope with the wrench', () => {
  const { visual, turret, m } = build();
  visual.updateMatrixWorld(true);
  const stowed = new THREE.Box3().setFromObject(visual);
  expect(stowed.max.y).toBeLessThan(inch(42));
  const frame = visual.getObjectByName('frame')!, fixed = frame.matrixWorld.clone();
  const intake = visual.getObjectByName('cad-intake-pivot')!, wrench = visual.getObjectByName('cad-climb-wrench-pivot')!, carriage = visual.getObjectByName('cad-climb-carriage-pivot')!;
  const hood = visual.getObjectByName('cad-hood-pivot')!, fly = visual.getObjectByName('cad-flywheel-pivot')!;
  expect(intake.rotation.z).toBe(0);
  expect(carriage.position.y).toBeLessThan(-.3);
  expect(wrench.rotation.x).toBeLessThan(-1.5);
  turret.rotation.y = 1.2;
  settle(m, { enabled: true, intaking: true, aiming: true, hood: 1.1 });
  visual.updateMatrixWorld(true);
  expect(intake.rotation.z).toBeGreaterThan(2.3);
  expect(visual.getObjectByName('cad-turret-pivot')!.rotation.y).toBeCloseTo(1.2);
  expect(hood.rotation.z).toBeGreaterThan(.1);
  expect(Math.abs(fly.rotation.z)).toBeGreaterThan(1);
  expect(frame.matrixWorld.equals(fixed)).toBe(true);
  // Deployed rollers reach the floor outside the back bumper edge.
  const rollers = visual.getObjectsByProperty('name', 'intake-marker');
  expect(rollers).toHaveLength(3);
  const lowest = Math.min(...rollers.map(r => new THREE.Vector3().setFromMatrixPosition(r.matrixWorld).y));
  expect(lowest).toBeGreaterThan(.02); expect(lowest).toBeLessThan(.12);
  settle(m, { enabled: true, climb: 1 });
  visual.updateMatrixWorld(true);
  expect(intake.rotation.z).toBeLessThan(.05);
  expect(carriage.position.y).toBeCloseTo(0, 2);
  expect(wrench.rotation.x).toBeCloseTo(0, 2);
  expect(new THREE.Box3().setFromObject(visual).max.y).toBeGreaterThan(1.2);
  visual.traverse(o => expect(o.matrixWorld.elements.every(Number.isFinite)).toBe(true));
});

it('shows held bubbles inside the robot by fill level, in the alliance colour', () => {
  for (const alliance of ['blue', 'red'] as const) {
    const { visual, m } = build(alliance);
    const held = () => visual.getObjectsByProperty('name', 'held-bubble') as THREE.Mesh[];
    expect(held()).toHaveLength(6);
    settle(m, { fill: 0 }); expect(held().filter(b => b.visible)).toHaveLength(0);
    settle(m, { fill: .5 }); expect(held().filter(b => b.visible)).toHaveLength(3);
    settle(m, { fill: 1 });
    const shown = held().filter(b => b.visible);
    expect(shown).toHaveLength(6);
    const box = new THREE.Box3().setFromObject(visual.getObjectByName('frame')!);
    for (const b of shown) { expect(b.position.x).toBeGreaterThan(-.33); expect(Math.abs(b.position.z)).toBeLessThan(.33); expect(b.position.y).toBeLessThan(box.max.y + .6); }
    expect(((shown[0].material as THREE.MeshStandardMaterial).color.getHex())).toBe(alliance === 'red' ? 0xe83d4f : 0x337fe8);
  }
});

for (const alliance of ['blue', 'red'] as const) it(`collects through the back intake only, ${alliance}`, () => {
  const c = team498().config; c.preload = 0;
  const sim = new HeadlessSim(heroHeist, RAPIER, { robot: c, alliance, pose: { x: 4, y: 4, yaw: alliance === 'blue' ? 0 : Math.PI } });
  try {
    sim.rules.stage(); sim.rules.onPeriodChange(sim.ctx.clock.start());
    const q = sim.robot.body.rotation(), t = sim.robot.body.translation();
    const rot = new THREE.Quaternion(q.x, q.y, q.z, q.w);
    const at = (x: number) => new THREE.Vector3(x, .09, 0).applyQuaternion(rot).add(new THREE.Vector3(t.x, t.y, t.z));
    const bubbles = sim.pool.indices('reserve').filter(i => pieceIdentity(i).kind === 'bubble' && pieceIdentity(i).color === alliance);
    const front = bubbles[0], back = bubbles[1], half = sim.robot.footprint.length / 2;
    sim.pool.placeWorld(front, at(half + .08)); sim.step({ ...IDLE_COMMAND, intake: true });
    expect(sim.pool.owner[front]).not.toBe(sim.robot.id);
    sim.pool.placeWorld(back, at(-(half + .08))); sim.step({ ...IDLE_COMMAND, intake: true });
    expect(sim.pool.owner[back]).toBe(sim.robot.id); expect(sim.pool.state[back]).toBe('held');
  } finally { sim.dispose(); }
});
