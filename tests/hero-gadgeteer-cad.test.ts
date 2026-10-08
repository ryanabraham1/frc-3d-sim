import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, expect, it } from 'vitest';
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { decodeCadModel } from '../src/engine/robot/cadModels';
import { robotModelBuilder, type RobotAnimState } from '../src/engine/robot/models';
import { HeadlessSim } from '../src/engine/testing/headless';
import { IDLE_COMMAND } from '../src/engine/robot/robot';
import { heroHeist } from '../src/seasons/wcp-hero-heist';
import { heroTeamRobots } from '../src/seasons/wcp-hero-heist/teamRobots';
import { normalizeHeroConfig, storage } from '../src/seasons/wcp-hero-heist/config';
import { pieceIdentity } from '../src/seasons/wcp-hero-heist/constants';

const ID = 'hero-gadgeteer-9408';
const idle: RobotAnimState = { dt: 0, time: 0, enabled: false, intaking: false, firing: 0, passing: false, aiming: false, hood: .85, fill: 0, climb: 0, blocker: 0, place: null, vx: 0, vz: 0, omega: 0 };
const robot = () => heroTeamRobots().find(t => t.id === ID)!;
const build = () => {
  const c = robot().config, visual = new THREE.Group(), turret = new THREE.Group(); visual.add(turret);
  const m = robotModelBuilder(c.model)!({ config: c, visual, turret, alliance: 'blue', fp: { length: .89, width: .89 }, groundSide: -1, stationSide: -1, mats: { dark: new THREE.MeshStandardMaterial(), alu: new THREE.MeshStandardMaterial(), bumper: new THREE.MeshStandardMaterial() } });
  return { m, visual };
};
beforeAll(async () => {
  await RAPIER.init();
  const b = readFileSync(`public/models/robots/wcp-hero-heist/${ID}.glb`);
  await decodeCadModel(ID, b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
});
it('9408 is selectable with the sheet capacities and a legal HIGH climb', () => {
  const c = normalizeHeroConfig(robot().config);
  expect(c.model).toBe(ID); expect(c.teamNumber).toBe(9408);
  expect(storage(c)).toEqual({ panels: 2, bubbles: 4 });
  expect(c.climber.maxLevel).toBe(3); expect(c.intake.groundSide).toBe('back');
});
it('actual CAD deploys the intake, spins the flywheel, extends the climber and keeps the frame fixed', () => {
  const { m, visual } = build();
  m.update(idle); const frame = visual.getObjectByName('frame')!; visual.updateMatrixWorld(true); const fixed = frame.matrixWorld.clone();
  const hinge = visual.getObjectByName('cad-intake-pivot')!, fly = visual.getObjectByName('cad-flywheel-pivot')!;
  for (let i = 0; i < 120; i++) { m.update({ ...idle, dt: 1 / 60, enabled: true, aiming: true, climb: i > 80 ? 1 : 0 }); visual.updateMatrixWorld(true); visual.traverse(o => expect(o.matrixWorld.elements.every(Number.isFinite)).toBe(true)); }
  expect(frame.matrixWorld.equals(fixed)).toBe(true);
  expect(fly.rotation.z).toBeGreaterThan(1);
  expect(visual.getObjectByName('climb-end')!.position.y).toBeGreaterThan(.5);
  m.update({ ...idle, dt: 1 / 60, enabled: false, climb: 0 });
  for (let i = 0; i < 120; i++) m.update({ ...idle, dt: 1 / 60, enabled: false });
  expect(hinge.rotation.z).toBeLessThan(-1);
  const b = new THREE.Box3().setFromObject(visual); expect(b.min.y).toBeGreaterThan(-.25);
});
it('draws held bubbles, a held-panel anchor and an orange intake marker', () => {
  const { m, visual } = build();
  const balls = () => { let n = 0; visual.traverse(o => { if (o.name === '9408-held-bubble' && o.visible) n++; }); return n; };
  m.update({ ...idle, fill: 0 }); expect(balls()).toBe(0);
  m.update({ ...idle, fill: .5 }); expect(balls()).toBe(2);
  m.update({ ...idle, fill: 1 }); expect(balls()).toBe(4);
  expect(visual.getObjectByName('9408-intake-marker')).toBeTruthy();
  expect(m.heldAnchor).toBeTruthy();
});
for (const alliance of ['blue', 'red'] as const) it(`9408 collects bubbles on its back floor intake for ${alliance}`, () => {
  const c = robot().config; c.preload = 0;
  const sim = new HeadlessSim(heroHeist, RAPIER, { robot: c, alliance, pose: { x: 4, y: 4, yaw: alliance === 'blue' ? 0 : Math.PI } });
  try {
    sim.rules.stage(); sim.rules.onPeriodChange(sim.ctx.clock.start());
    const q = sim.robot.body.rotation(), center = sim.robot.body.translation();
    const i = sim.pool.indices('reserve').find(i => pieceIdentity(i).kind === 'bubble' && pieceIdentity(i).color === alliance)!;
    const p = new THREE.Vector3(-(sim.robot.footprint.length / 2 + .10), .09, 0).applyQuaternion(new THREE.Quaternion(q.x, q.y, q.z, q.w)).add(new THREE.Vector3(center.x, center.y, center.z));
    sim.pool.placeWorld(i, p); sim.step({ ...IDLE_COMMAND, intake: true });
    expect(sim.pool.owner[i]).toBe(sim.robot.id); expect(sim.pool.state[i]).toBe('held');
  } finally { sim.dispose(); }
});
afterAll(() => undefined);
