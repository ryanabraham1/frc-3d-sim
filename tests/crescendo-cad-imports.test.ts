import { beforeAll, describe, expect, it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { cadRobotModelBuilder, decodeCadModel } from '../src/engine/robot/cadModels';
import { cloneConfig, type RobotConfig } from '../src/engine/robot/config';
import type { RobotAnimState, RobotModel } from '../src/engine/robot/models';
import { IDLE_COMMAND } from '../src/engine/robot/robot';
import { HeadlessSim } from '../src/engine/testing/headless';
import { crescendo2024 as season } from '../src/seasons/2024-crescendo';

const idle: RobotAnimState = {dt:0,time:0,enabled:true,intaking:false,firing:0,passing:false,aiming:false,hood:.5,fill:0,climb:0,blocker:0,place:null,vx:0,vz:0,omega:0};
const entry = (id: string) => season.teamRobots!.find(r => r.id === id)!;
const config = (id: string) => cloneConfig(entry(id).config);

async function rig(id: string): Promise<{ model: RobotModel; root: THREE.Object3D; visual: THREE.Group }> {
  const b = readFileSync(`public/models/robots/2024/${id}.glb`);
  await decodeCadModel(id, b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
  const c = config(id), visual = new THREE.Group(), turret = new THREE.Group(); visual.add(turret);
  const model = cadRobotModelBuilder(id)!({config:c,visual,turret,alliance:'blue',fp:{length:c.frameLength,width:c.frameWidth},groundSide:c.intake.groundSide==='front'?1:-1,stationSide:-1,mats:{dark:new THREE.MeshStandardMaterial(),alu:new THREE.MeshStandardMaterial(),bumper:new THREE.MeshStandardMaterial()}});
  return { model, root: visual.getObjectByName(`cad-${id}`)!, visual };
}
const world = (o: THREE.Object3D) => { o.updateWorldMatrix(true, false); return o.getWorldPosition(new THREE.Vector3()); };
const box = (o: THREE.Object3D) => new THREE.Box3().setFromObject(o, true);

beforeAll(async () => { await RAPIER.init(); });

describe('2024 CAD imports: measured joints move the real parts', () => {
  it('1678 Nik stows its back intake over the bumper, raises the tilted AMP elevator and pitches 15-62 degrees', async () => {
    const { model, root } = await rig('nik-1678');
    model.update({...idle, intaking:true});
    const deployed = world(model.intakeAnchor!);
    model.update(idle);
    const stowed = world(model.intakeAnchor!);
    expect(deployed.x).toBeLessThan(-.5); expect(deployed.y).toBeLessThan(.12);
    expect(stowed.y).toBeGreaterThan(deployed.y + .25); expect(stowed.x).toBeGreaterThan(deployed.x + .2);
    const amp = root.getObjectByName('amp')!;
    const low = box(amp).max.y; model.update({...idle, amp:true}); const high = box(amp).max.y;
    expect(high - low).toBeCloseTo(.303 * .94, 2);
    model.update({...idle, aiming:true, hood:THREE.MathUtils.degToRad(62)});
    expect(root.getObjectByName('cad-shooter-pivot')!.rotation.z).toBeCloseTo(THREE.MathUtils.degToRad(47));
    model.update({...idle, aiming:true, hood:.05});
    expect(root.getObjectByName('cad-shooter-pivot')!.rotation.z).toBeCloseTo(0);
    // The gas-spring struts follow the climber arms instead of detaching from them.
    model.update({...idle, climb:1}); const up = world(root.getObjectByName('cad-climb-hook')!);
    model.update(idle); const folded = world(root.getObjectByName('cad-climb-hook')!);
    expect(up.y).toBeGreaterThan(folded.y + .25);
    expect(root.getObjectByName('cad-climber-strut')!.rotation.z).not.toBe(0);
  });

  it('1706 Riot drives its carriage up the 16 degree elevator and extends both telescopes', async () => {
    const { model, root } = await rig('riot-1706');
    const carriage = root.getObjectByName('carriage')!, hooks = root.getObjectByName('climber')!;
    model.update(idle); const rest = world(carriage), hookRest = box(hooks).max.y;
    model.update({...idle, amp:true}); const amp = world(carriage);
    expect(amp.y - rest.y).toBeCloseTo(.3 * .961, 2); expect(amp.x).toBeLessThan(rest.x);
    model.update({...idle, climb:1}); expect(box(hooks).max.y - hookRest).toBeCloseTo(.45, 2);
  });

  it('3005 Surge flips the diverter on the launcher nose for the AMP only', async () => {
    const { model, root } = await rig('surge-3005');
    const diverter = root.getObjectByName('cad-diverter-pivot')!;
    model.update({...idle, aiming:true, passing:true}); expect(diverter.rotation.z).toBe(0);
    model.update({...idle, amp:true}); expect(diverter.rotation.z).toBeLessThan(-1);
  });
});

describe('2024 CAD imports: gameplay pickup uses the real mouths', () => {
  const pickup = (c: RobotConfig, side: -1 | 1) => {
    const sim = new HeadlessSim(season, RAPIER, { robot: c, alliance: 'blue', pose: { x: 4, y: 4, yaw: 0 } });
    try {
      for (const i of sim.robot.held.splice(0)) sim.pool.reserve(i);
      sim.pool.placeField(0, 4 + side * (c.frameLength / 2 + .2), 4);
      sim.run(.8, { ...IDLE_COMMAND, intake: true });
      return sim.robot.held.length;
    } finally { sim.dispose(); }
  };
  for (const id of ['nik-1678', 'ultraviolet-3847'])
    it(`${id} collects behind it and rejects NOTES at the shooter end`, () => {
      expect(pickup(config(id), -1)).toBe(1);
      expect(pickup(config(id), 1)).toBe(0);
    });
  for (const id of ['riot-1706', 'surge-3005'])
    it(`${id} collects through both bumper faces of its double-sided intake`, () => {
      expect(pickup(config(id), -1)).toBe(1);
      expect(pickup(config(id), 1)).toBe(1);
      const single = config(id); single.options = { ...single.options, dualSideIntake: false };
      expect(pickup(single, 1)).toBe(0);
    });
});

describe('2024 CAD imports: saved presets', () => {
  it('a preset saved before dualSideIntake existed keeps both mouths; an explicit opt-out survives', () => {
    for (const id of ['riot-1706', 'surge-3005']) {
      const old = config(id); delete old.options!.dualSideIntake;
      expect(season.normalizeRobotConfig!(old).options!.dualSideIntake).toBe(true);
      const off = config(id); off.options!.dualSideIntake = false;
      expect(season.normalizeRobotConfig!(off).options!.dualSideIntake).toBe(false);
    }
    const other = config('nik-1678'); expect(season.normalizeRobotConfig!(other).options!.dualSideIntake).toBeUndefined();
  });
  it('saved CAD robots keep their roster capacity, climb level and intake side', () => {
    for (const id of ['nik-1678','riot-1706','surge-3005','ultraviolet-3847','nocturne-3467']) {
      const saved = JSON.parse(JSON.stringify(entry(id).config)) as RobotConfig;
      const c = season.normalizeRobotConfig!(saved);
      expect(c.hopperCapacity).toBe(1);
      expect(c.climber.maxLevel).toBe(entry(id).config.climber.maxLevel);
      expect(c.intake.groundSide).toBe(entry(id).config.intake.groundSide);
      expect(c.model).toBe(id);
    }
  });
});
