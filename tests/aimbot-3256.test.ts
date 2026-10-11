import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { SEASONS } from '../src/seasons';
import { cloneConfig } from '../src/engine/robot/config';
import { cadRobotModelBuilder, decodeCadModel } from '../src/engine/robot/cadModels';
import type { RobotAnimState } from '../src/engine/robot/models';
import { inch } from '../src/engine/units';

/** 3256 Aimbot: supplied CAD + technical binder (tall bump bot, 100 FUEL, 8-10 FUEL/s, turret, slapdown intake). */
const season = SEASONS.find(s => s.year === 2026)!;
const ID = 'aimbot-3256';
const idle: RobotAnimState = { dt: 0, time: 0, enabled: false, intaking: false, firing: 0, passing: false, aiming: false, hood: .9, fill: 0, climb: 0, blocker: 0, place: null, vx: 0, vz: 0, omega: 0 };
const build = () => {
  const c = cloneConfig(season.teamRobots!.find(r => r.id === ID)!.config), visual = new THREE.Group(), turret = new THREE.Group(); visual.add(turret);
  const m = cadRobotModelBuilder(c.model)!({ config: c, visual, turret, alliance: 'blue', fp: { length: c.frameLength, width: c.frameWidth }, groundSide: -1, stationSide: -1, mats: { dark: new THREE.MeshStandardMaterial(), alu: new THREE.MeshStandardMaterial(), bumper: new THREE.MeshStandardMaterial() } });
  return { c, visual, turret, m, root: visual.getObjectByName(`cad-${ID}`)! };
};

beforeAll(async () => {
  await RAPIER.init();
  const b = readFileSync(`public/models/robots/2026/${ID}.glb`);
  await decodeCadModel(ID, b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
});

describe('3256 Aimbot', () => {
  it("uses the team's figures: 100 FUEL, 9 FUEL/s, turret at the ring centre, tall legal chassis", () => {
    const { c } = build();
    expect(c.hopperCapacity).toBe(100);
    expect(c.launcher.rate).toBeGreaterThanOrEqual(8); expect(c.launcher.rate).toBeLessThanOrEqual(10);
    expect(c.launcher.turret).toBe(true);
    expect(c.launcher.mounts).toEqual([{ forward: .145, side: -.145 }]);
    expect(c.height).toBeCloseTo(inch(30), 6);
    expect(c.frameLength).toBeCloseTo(.68, 6);
    expect(2 * (c.frameLength + c.frameWidth)).toBeLessThanOrEqual(inch(110) + 1e-9);
  });

  it('decodes a bounded asset with every articulated group and a hopper that holds 100', () => {
    const report = JSON.parse(readFileSync(`public/models/robots/2026/${ID}.report.json`, 'utf8'));
    expect(report.outputBytes).toBeLessThan(10_000_000);
    expect(report.outputTriangles).toBeLessThan(1_000_000);
    const { visual, root } = build();
    for (const g of ['frame', 'turret', 'hood', 'flywheel', 'rotor', 'intake', 'hopper-ext']) expect(root.getObjectByName(g), g).toBeDefined();
    expect(visual.getObjectByName('hopper-fuel-pile')!.userData.fuelSlots).toBe(100);
    // CAD stays under the 30 in limit.
    expect(new THREE.Box3().setFromObject(root, true).max.y).toBeLessThanOrEqual(inch(30) + 1e-6);
  });

  it('sweeps every mechanism finitely with a fixed frame, and the turret follows the aim', () => {
    const { visual, turret, m, root } = build();
    const frame = root.getObjectByName('frame')!; visual.updateMatrixWorld(true); const bind = frame.matrixWorld.clone();
    for (let i = 0; i < 121; i++) {
      const t = i / 120;
      turret.rotation.y = Math.sin(t * 7) * 1.2;
      m.update({ ...idle, dt: .025, time: t * 3, enabled: i < 60, aiming: i % 30 < 20, intaking: i % 20 < 10, firing: i > 30 && i < 50 ? 1 : 0, hood: .5 + t * .8, fill: t });
      visual.updateMatrixWorld(true);
      root.traverse(o => expect(o.matrixWorld.elements.every(Number.isFinite)).toBe(true));
      expect(frame.matrixWorld.equals(bind)).toBe(true);
      expect(m.flow!.feed!(i).every(p => p.toArray().every(Number.isFinite))).toBe(true);
    }
    const pivot = root.getObjectByName('cad-turret-pivot')!;
    turret.rotation.y = .6; m.update({ ...idle, dt: .05, enabled: true, aiming: true });
    expect(pivot.rotation.y).toBeCloseTo(.6, 6);
  });

  it('slaps down out the back with the hopper wall, and folds inside the frame when stowed', () => {
    const { c, visual, m, root } = build();
    const tip = () => { visual.updateMatrixWorld(true); return m.intakeAnchor!.getWorldPosition(new THREE.Vector3()); };
    const out = tip();
    expect(out.x).toBeLessThan(-c.frameLength / 2 - c.bumperThickness);
    expect(out.y).toBeGreaterThan(.03); expect(out.y).toBeLessThan(.15);
    const wall = root.getObjectByName('cad-hopper-ext-pivot')!;
    for (let i = 0; i < 80; i++) m.update({ ...idle, dt: .05 });
    const stowed = tip();
    expect(stowed.x).toBeGreaterThan(-c.frameLength / 2);
    expect(wall.position.x).toBeCloseTo(.30, 2);
    for (let i = 0; i < 80; i++) m.update({ ...idle, dt: .05, enabled: true });
    expect(tip().distanceTo(out)).toBeLessThan(.01);
    expect(wall.position.x).toBeCloseTo(0, 2);
  });
});
