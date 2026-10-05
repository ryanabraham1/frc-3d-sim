import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { SEASONS } from '../src/seasons';
import { cloneConfig } from '../src/engine/robot/config';
import { CAD_MODEL_IDS, cadRobotModelBuilder, decodeCadModel, setCadAnimationEnabled } from '../src/engine/robot/cadModels';
import type { RobotAnimState } from '../src/engine/robot/models';

const idle: RobotAnimState = { dt: 0, time: 0, enabled: false, intaking: false, firing: 0, passing: false, aiming: false, hood: .9, fill: 0, climb: 0, blocker: 0, place: null, vx: 0, vz: 0, omega: 0 };
beforeAll(async () => {
  for (const id of CAD_MODEL_IDS) {
    const bytes = readFileSync(`public/models/robots/2026/${id}.glb`);
    await decodeCadModel(id, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  }
});

describe('imported 2026 CAD models', () => {
  for (const id of CAD_MODEL_IDS) it(`${id}: real asset decodes, retains mechanisms, and animates within a finite envelope`, () => {
    const config = cloneConfig(SEASONS.find(s => s.year === 2026)!.teamRobots!.find(r => r.id === id)!.config);
    const visual = new THREE.Group(), turret = new THREE.Group(); visual.add(turret);
    const model = cadRobotModelBuilder(id)!({ config, visual, turret, alliance: 'blue', fp: { length: config.frameLength, width: config.frameWidth }, groundSide: -1, stationSide: -1,
      mats: { dark: new THREE.MeshStandardMaterial(), alu: new THREE.MeshStandardMaterial(), bumper: new THREE.MeshStandardMaterial() } });
    const root = visual.getObjectByName(`cad-${id}`)!;
    expect(root).toBeTruthy();
    for (const name of ['intake','hood','flywheel']) {
      const part = root.getObjectByName(name)!;
      expect(part, name).toBeTruthy();
      let triangles = 0;
      part.traverse(o => { if (o instanceof THREE.Mesh) triangles += (o.geometry.index?.count ?? o.geometry.getAttribute('position').count)/3; });
      expect(triangles, `${name} must contain CAD geometry`).toBeGreaterThan(10);
    }
    const report = JSON.parse(readFileSync(`public/models/robots/2026/${id}.report.json`, 'utf8'));
    expect(report.outputBytes).toBeLessThan(6_000_000);
    expect(report.outputTriangles).toBeLessThan(1_000_000);
    expect(report.outputTriangles/report.inputTriangles).toBeLessThan(.20);
    setCadAnimationEnabled(true);
    model.update(idle);
    const intake = root.getObjectByName('cad-intake-pivot')!;
    if (id === 'toploader-604') {
      const rotor = root.getObjectByName('cad-serializer-pivot')!, turretPivot = root.getObjectByName('cad-turret-pivot')!;
      expect(rotor.position.x).toBeCloseTo(turretPivot.position.x,6);
      expect(rotor.position.z).toBeCloseTo(turretPivot.position.z,6);
    }
    const initial = [...intake.position.toArray(), ...intake.quaternion.toArray()];
    for (let step = 0; step < 100; step++) {
      model.update({ ...idle, dt: .02, time: step*.02, enabled: true, intaking: true, aiming: true, firing: .4, fill: .6, hood: .5+step*.0075 });
      visual.updateMatrixWorld(true);
      root.traverse(o => expect(o.matrixWorld.elements.every(Number.isFinite)).toBe(true));
      const bounds = new THREE.Box3().setFromObject(root, true);
      expect(bounds.max.y).toBeLessThan(1.5);
      expect(bounds.min.y, 'mechanism should not rotate below the floor').toBeGreaterThan(-.08);
      const points = [...model.flow!.intake!(), ...model.flow!.feed!(step), model.flow!.stow!()];
      expect(points.flatMap(p => p.toArray()).every(Number.isFinite)).toBe(true);
    }
    expect([...intake.position.toArray(), ...intake.quaternion.toArray()]).not.toEqual(initial);
    const hood = root.getObjectByName('cad-hood-pivot')!;
    model.update({ ...idle, enabled:true, aiming:true, hood:.5, fill:1 });
    const low = hood.quaternion.clone();
    model.update({ ...idle, enabled:true, aiming:true, hood:1.25, fill:1 });
    expect(low.angleTo(hood.quaternion), 'low and high shots must move the hood visibly').toBeGreaterThan(.6);
    const fuel = visual.getObjectByName('cad-hopper-fuel')!;
    expect(fuel.children.some(o => o instanceof THREE.InstancedMesh && o.count > 10)).toBe(true);
    if (id === 'limestone-1678') {
      const rim = visual.getObjectByName('hopper-lift')!;
      expect(rim.position.y).toBeCloseTo(config.hopperExpansion!.fullHeight-.53,3);
      const verticalBounds = new THREE.Box3().setFromObject(rim,true);
      expect(verticalBounds.min.x).toBeGreaterThan(-config.frameLength/2-.01);
      expect(verticalBounds.max.x).toBeLessThan(config.frameLength/2+.01);
      const fullBounds = new THREE.Box3().setFromObject(visual.getObjectByName('hopper-front')!,true);
      model.update({ ...idle, enabled:false, fill:0 });
      const compactBounds = new THREE.Box3().setFromObject(visual.getObjectByName('hopper-front')!,true);
      expect(fullBounds.min.x).toBeLessThan(compactBounds.min.x-.2);
      expect(rim.position.y).toBeCloseTo(0,3);
    }
  });
});
