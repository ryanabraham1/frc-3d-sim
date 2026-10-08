import { readFileSync } from 'node:fs';
import { beforeAll, expect, it } from 'vitest';
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { decodeCadModel } from '../src/engine/robot/cadModels';
import { robotModelBuilder, type RobotAnimState } from '../src/engine/robot/models';
import { heroTeamRobots } from '../src/seasons/wcp-hero-heist/teamRobots';
import { normalizeHeroConfig, storage, preloads } from '../src/seasons/wcp-hero-heist/config';
import { HeadlessSim } from '../src/engine/testing/headless';
import { heroHeist } from '../src/seasons/wcp-hero-heist';
import { IDLE_COMMAND } from '../src/engine/robot/robot';
import { pieceIdentity } from '../src/seasons/wcp-hero-heist/constants';

const nomad = () => heroTeamRobots().find(t => t.team === 6995)!.config;
const idle: RobotAnimState = { dt: 0, time: 0, enabled: false, intaking: false, firing: 0, passing: false, aiming: false, hood: .85, fill: 0, climb: 0, blocker: 0, place: null, vx: 0, vz: 0, omega: 0 };
beforeAll(async () => {
  await RAPIER.init();
  const b = readFileSync('public/models/robots/wcp-hero-heist/hero-nomad-6995.glb');
  await decodeCadModel('hero-nomad-6995', b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
});

function build() {
  const c = nomad(), visual = new THREE.Group(), turret = new THREE.Group(); visual.add(turret);
  const m = robotModelBuilder(c.model)!({ config: c, visual, turret, alliance: 'blue', fp: { length: .81, width: .81 }, groundSide: -1, stationSide: -1,
    mats: { dark: new THREE.MeshStandardMaterial(), alu: new THREE.MeshStandardMaterial(), bumper: new THREE.MeshStandardMaterial() } });
  return { c, visual, m };
}

it('Nomad is a gadgeteer with 2 panels / 4 bubbles, a fixed shooter and park-only endgame', () => {
  const c = normalizeHeroConfig(nomad());
  expect(c.model).toBe('hero-nomad-6995');
  expect(storage(c)).toEqual({ panels: 2, bubbles: 4 });
  expect(preloads(c)).toEqual({ panels: 1, bubbles: 3 });
  expect(c.launcher.turret).toBe(false);
  expect(c.climber.maxLevel).toBe(0);
  expect(c.intake.groundSide).toBe('back');
});

it('actual CAD animates the slapdown, hood, flywheel and two-stage lift while the frame stays put', () => {
  const { visual, m } = build();
  m.update(idle); visual.updateMatrixWorld(true);
  const frame = visual.getObjectByName('frame')!, fixed = frame.matrixWorld.clone();
  const stage = visual.getObjectByName('elevator-stage')!, effector = visual.getObjectByName('effector')!;
  const low = { stage: stage.position.y, effector: effector.position.y };
  for (let i = 0; i < 120; i++) {
    m.update({ ...idle, dt: 1 / 60, enabled: true, aiming: true, hood: .26 + (i / 119) * .96, place: { height: 1.1, forward: .6, level: 2 } });
    visual.updateMatrixWorld(true);
    visual.traverse(o => expect(o.matrixWorld.elements.every(Number.isFinite)).toBe(true));
    expect(frame.matrixWorld.equals(fixed)).toBe(true);
  }
  expect(visual.getObjectByName('cad-slapdown-pivot')!.rotation.z).toBeGreaterThan(.5);
  expect(Math.abs(visual.getObjectByName('cad-hood-pivot')!.rotation.z)).toBeGreaterThan(.05);
  expect(Math.abs(visual.getObjectByName('cad-flywheel-pivot')!.rotation.z)).toBeGreaterThan(.5);
  expect(stage.position.y - low.stage).toBeGreaterThan(.2);
  expect(effector.position.y - low.effector).toBeGreaterThan(.2);
  const box = new THREE.Box3().setFromObject(visual);
  expect(box.max.y).toBeLessThan(1.6); expect(box.min.y).toBeGreaterThan(-.1);
});

it('Nomad draws its held bubbles, marks both intake mouths and exposes the panel cradle', () => {
  const { visual, m } = build();
  const spheres = () => { let n = 0; visual.traverse(o => { if (o instanceof THREE.Mesh && o.geometry instanceof THREE.SphereGeometry && o.visible) n++; }); return n; };
  m.update({ ...idle, fill: 0 }); expect(spheres()).toBe(0);
  m.update({ ...idle, fill: .5 }); expect(spheres()).toBe(2);
  m.update({ ...idle, fill: 1 }); expect(spheres()).toBe(4);
  let markers = 0; visual.traverse(o => { if (o instanceof THREE.Mesh && o.geometry instanceof THREE.CylinderGeometry && (o.material as THREE.MeshStandardMaterial).color.getHex() === 0xff7a1a) markers++; });
  expect(markers).toBe(2);
  expect(m.heldAnchor).toBeDefined(); expect(m.intakeAnchor).toBeDefined();
});

for (const alliance of ['blue', 'red'] as const) it(`Nomad collects bubbles from its back mouth and shoots them forward (${alliance})`, () => {
  const c = nomad(); c.preload = 0;
  const sim = new HeadlessSim(heroHeist, RAPIER, { robot: c, alliance, pose: { x: 4, y: 4, yaw: alliance === 'blue' ? 0 : Math.PI } });
  try {
    sim.rules.stage(); sim.rules.onPeriodChange(sim.ctx.clock.start());
    const q = sim.robot.body.rotation(), center = sim.robot.body.translation();
    const quat = new THREE.Quaternion(q.x, q.y, q.z, q.w);
    const i = sim.pool.indices('reserve').find(i => pieceIdentity(i).kind === 'bubble' && pieceIdentity(i).color === alliance)!;
    const back = new THREE.Vector3(-(sim.robot.footprint.length / 2 + .10), .09, 0).applyQuaternion(quat).add(new THREE.Vector3(center.x, center.y, center.z));
    sim.pool.placeWorld(i, back);
    sim.step({ ...IDLE_COMMAND, intake: true });
    expect(sim.pool.owner[i]).toBe(sim.robot.id); expect(sim.pool.state[i]).toBe('held');
  } finally { sim.dispose(); }
});
