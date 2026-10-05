import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { SEASONS } from '../src/seasons';
import { cloneConfig } from '../src/engine/robot/config';
import { CAD_MODEL_IDS, cadRobotModelBuilder, decodeCadModel, setCadAnimationEnabled } from '../src/engine/robot/cadModels';
import type { RobotAnimState } from '../src/engine/robot/models';

const idle: RobotAnimState = { dt: 0, time: 0, enabled: false, intaking: false, firing: 0, passing: false, aiming: false, hood: .9, fill: 0, climb: 0, blocker: 0, place: null, vx: 0, vz: 0, omega: 0 };
beforeAll(async () => {
  for (const id of [...CAD_MODEL_IDS,'intake-581-donor']) {
    const bytes = readFileSync(`public/models/robots/2026/${id}.glb`);
    await decodeCadModel(id, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  }
});

describe('imported 2026 CAD models', () => {
  for (const id of CAD_MODEL_IDS.filter(id => ['toploader-604','limestone-1678','rubble-581'].includes(id))) it(`${id}: real asset decodes, retains mechanisms, and animates within a finite envelope`, () => {
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
      // Intake deploys around its lower fixed hinge; the hopper slides separately.
      expect(intake.position.x).toBeCloseTo(-.30465,5);
      expect(intake.position.y).toBeCloseTo(.1689,5);
      const tip = visual.worldToLocal(model.intakeAnchor!.getWorldPosition(new THREE.Vector3()));
      expect(tip.x).toBeLessThan(-.5);
      expect(tip.x).toBeGreaterThan(-.65);
      expect(tip.y).toBeGreaterThan(.08);
      expect(tip.y).toBeLessThan(.18);
      expect(visual.getObjectByName('hopper-front')!.quaternion.angleTo(new THREE.Quaternion())).toBeLessThan(.001);
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


describe('additional supplied CAD',()=>{
  for(const id of ['ctrl-alt-defeat-9470','downpour-6800','mixtape-971']) it(`${id}: keeps assemblies coherent through deployment, aim and fill sweeps`,()=>{
    const config=cloneConfig(SEASONS.find(s=>s.year===2026)!.teamRobots!.find(r=>r.id===id)!.config);
    const visual=new THREE.Group(),turret=new THREE.Group();visual.add(turret);
    const model=cadRobotModelBuilder(id)!({config,visual,turret,alliance:'blue',fp:{length:config.frameLength,width:config.frameWidth},groundSide:-1,stationSide:-1,mats:{dark:new THREE.MeshStandardMaterial(),alu:new THREE.MeshStandardMaterial(),bumper:new THREE.MeshStandardMaterial()}});
    const root=visual.getObjectByName(`cad-${id}`)!;
    const report=JSON.parse(readFileSync(`public/models/robots/2026/${id}.report.json`,'utf8'));
    expect(report.outputBytes).toBeLessThan(6_000_000);
    expect(report.outputTriangles/report.inputTriangles).toBeLessThan(.2);
    setCadAnimationEnabled(true);
    const intake=root.getObjectByName('cad-intake-pivot')!;
    model.update(idle);
    const stowed=intake.position.clone(),initial=intake.quaternion.clone();
    for(let i=0;i<100;i++){
      turret.rotation.y=(i/99-.5)*Math.PI;
      model.update({...idle,dt:.02,enabled:true,intaking:true,aiming:true,fill:i/99,hood:.5+.75*i/99});
      visual.updateMatrixWorld(true);
      root.traverse(o=>expect(o.matrixWorld.elements.every(Number.isFinite)).toBe(true));
      const bounds=new THREE.Box3().setFromObject(root,true);
      expect(bounds.min.y).toBeGreaterThan(-.08);expect(bounds.max.y).toBeLessThan(1.5);
      expect([...model.flow!.intake!(),...model.flow!.feed!(i),model.flow!.stow!()].flatMap(p=>p.toArray()).every(Number.isFinite)).toBe(true);
    }
    model.update({...idle,enabled:true,fill:1,aiming:true,hood:.5});
    expect(intake.position.distanceTo(stowed)+intake.quaternion.angleTo(initial)).toBeGreaterThan(.15);
    if(id==='mixtape-971'){
      const left=root.getObjectByName('cad-turret-left-pivot')!,right=root.getObjectByName('cad-turret-right-pivot')!;
      expect(left.position.z).toBeCloseTo(-right.position.z,4);
      expect(root.getObjectByName('cad-hood-left-pivot')!.parent).toBe(left);
      expect(root.getObjectByName('cad-hood-right-pivot')!.parent).toBe(right);
    } else if(id==='downpour-6800') {
      expect(intake.position.x).toBeCloseTo(0,4);
      expect(root.getObjectByName('hopper-slide')!.position.x).toBeCloseTo(intake.position.x,5);
    } else {
      const donor=root.getObjectByName('adapted-581-intake');expect(donor).toBeTruthy();
      expect(new THREE.Box3().setFromObject(donor!,true).getSize(new THREE.Vector3()).z).toBeGreaterThan(.5);
    }
    const hood=root.getObjectByName(id==='mixtape-971'?'cad-hood-left-pivot':'cad-hood-pivot')!;
    const low=hood.quaternion.clone();model.update({...idle,enabled:true,fill:1,aiming:true,hood:1.25});
    expect(hood.quaternion.angleTo(low)).toBeGreaterThan(.5);
    const pile=visual.getObjectByName('cad-hopper-fuel')!;
    expect(pile.children.some(o=>o instanceof THREE.InstancedMesh&&o.count>10)).toBe(true);
  });
});
