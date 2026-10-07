import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { CAD_2024_MODEL_IDS, decodeCadModel, cadRobotModelBuilder, setCadAnimationEnabled } from '../src/engine/robot/cadModels';
import { SEASONS } from '../src/seasons';
import { cloneConfig } from '../src/engine/robot/config';
import type { RobotAnimState } from '../src/engine/robot/models';
const idle: RobotAnimState = {dt:0,time:0,enabled:false,intaking:false,firing:0,passing:false,aiming:false,hood:.7,fill:0,climb:0,blocker:0,place:null,vx:0,vz:0,omega:0};
describe('supplied CRESCENDO CAD',()=>{
  for(const id of CAD_2024_MODEL_IDS)it(`${id}: decoded mechanisms stay connected and finite through poses`,async()=>{
    const b=readFileSync(`public/models/robots/2024/${id}.glb`);await decodeCadModel(id,b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength));
    const entry=SEASONS.find(s=>s.year===2024)!.teamRobots!.find(r=>r.id===id)!;
    expect(entry).toBeTruthy(); const config=cloneConfig(entry.config);
    const visual=new THREE.Group(),turret=new THREE.Group();visual.add(turret);
    const model=cadRobotModelBuilder(id)!({config,visual,turret,alliance:'blue',fp:{length:config.frameLength,width:config.frameWidth},groundSide:config.intake.groundSide==='front'?1:-1,stationSide:-1,mats:{dark:new THREE.MeshStandardMaterial(),alu:new THREE.MeshStandardMaterial(),bumper:new THREE.MeshStandardMaterial()}});
    const root=visual.getObjectByName(`cad-${id}`)!;expect(root).toBeTruthy();
    if (id === 'typhoon-2910') {
      turret.rotation.y=0; model.update({...idle,enabled:true,aiming:true,hood:.7});
      const path=model.flow!.feed!();
      expect(path[1].x).toBeGreaterThan(path[0].x);
      expect(path[1].y).toBeGreaterThan(path[0].y);
      expect(root.getObjectByName('cad-shooter-pivot')!.getWorldPosition(new THREE.Vector3()).distanceTo(new THREE.Vector3(.1397-.05193045,.28691241,0))).toBeLessThan(.001);
    }
    if (id === 'snoopy-6036') {
      const assembly = root.getObjectByName('cad-turret-pivot')!;
      const shooter = root.getObjectByName('cad-shooter-pivot')!;
      turret.rotation.y = -.8; model.update({...idle,enabled:true,aiming:true});
      const first = shooter.getWorldPosition(new THREE.Vector3());
      turret.rotation.y = .9; model.update({...idle,enabled:true,aiming:true});
      expect(assembly.rotation.y).toBeCloseTo(.9);
      turret.rotation.y=0; model.update({...idle,enabled:true,aiming:true,hood:.7});
      const path=model.flow!.feed!();
      expect(path[1].x).toBeGreaterThan(path[0].x);
      expect(path[1].y).toBeGreaterThan(path[0].y);
      const direction=path[1].clone().sub(path[0]);
      expect(Math.atan2(direction.y,direction.x)).toBeCloseTo(.7,2);
      turret.rotation.y=.9; model.update({...idle,enabled:true,aiming:true});
      expect(shooter.getWorldPosition(new THREE.Vector3()).distanceTo(first)).toBeGreaterThan(.15);
      model.update({...idle,enabled:true,intaking:true,aiming:true});
      expect(assembly.rotation.y).toBeCloseTo(.9);
      model.update({...idle,enabled:true,intaking:true,firing:1});
      expect(assembly.rotation.y).toBeCloseTo(.9);
      model.update({...idle,enabled:true,intaking:true});
      expect(assembly.rotation.y).toBeCloseTo(0);
      model.update({...idle,enabled:true});
      expect(assembly.rotation.y).toBeCloseTo(0);
    }
    // A midfield feed uses the same shooter geometry at its pass elevation;
    // it must not trigger this robot's separate AMP mechanism deployment.
    model.update({...idle,enabled:true,aiming:true,amp:false,hood:.5});visual.updateMatrixWorld(true);
    const speakerPivot=root.getObjectByName('cad-shooter-pivot')!.matrixWorld.clone();
    model.update({...idle,enabled:true,aiming:true,passing:true,amp:false,hood:.5});visual.updateMatrixWorld(true);
    expect(root.getObjectByName('cad-shooter-pivot')!.matrixWorld.equals(speakerPivot)).toBe(true);
    const frame=root.getObjectByName('frame')!;const original=frame.matrix.clone();
    for(let i=0;i<=60;i++){
      turret.rotation.y=(i/60-.5)*Math.PI*2;
      model.update({...idle,aiming:true,hood:.14+i/60*.94,climb:i/60,enabled:true,intaking:true});visual.updateMatrixWorld(true);
      root.traverse(o=>expect(o.matrixWorld.elements.every(Number.isFinite)).toBe(true));
      expect(frame.matrix.equals(original)).toBe(true);
      const bounds=new THREE.Box3().setFromObject(root,true);expect(bounds.min.y).toBeGreaterThan(-.035);expect(bounds.max.y).toBeLessThan(2);
      expect(model.flow!.feed!().every(p=>p.toArray().every(Number.isFinite))).toBe(true);

    }
    if (id === 'roti-5940' || id === 'presto-6328') {
      model.update({...idle,aiming:true,hood:.7});visual.updateMatrixWorld(true);
      const direction = new THREE.Vector3(1,0,0).applyQuaternion(model.heldAnchor!.getWorldQuaternion(new THREE.Quaternion()));
      expect(Math.atan2(direction.y,direction.x)).toBeCloseTo(.7);
      model.update({...idle,amp:true});visual.updateMatrixWorld(true);
      const ampPose = model.heldAnchor!.getWorldPosition(new THREE.Vector3());
      model.update(idle);visual.updateMatrixWorld(true);
      expect(ampPose.distanceTo(model.heldAnchor!.getWorldPosition(new THREE.Vector3()))).toBeGreaterThan(.2);
    }
    if (id === 'doppler-1690') {
      model.update(idle); visual.updateMatrixWorld(true);
      const shooter = root.getObjectByName('shooter')!;
      const rest = new THREE.Box3().setFromObject(shooter, true);
      const heldRest = model.heldAnchor!.getWorldPosition(new THREE.Vector3());
      // A released shoot button must not flatten the assembly during the shot.
      model.update({...idle, enabled:true, firing:1, aiming:false, hood:.8});
      visual.updateMatrixWorld(true);
      expect(root.getObjectByName('cad-shooter-pivot')!.rotation.z).toBeCloseTo(.78);
      expect(new THREE.Box3().setFromObject(shooter,true).max.y).toBeGreaterThan(rest.max.y + .2);
      expect(model.heldAnchor!.getWorldPosition(new THREE.Vector3()).y).toBeGreaterThan(heldRest.y + .18);
      expect(frame.matrix.equals(original)).toBe(true);
      model.update({...idle, enabled:true, passing:true});
      expect(root.getObjectByName('cad-shooter-pivot')!.rotation.z).toBeCloseTo(1.5);
      model.update({...idle, dt:.1});
      expect(root.getObjectByName('cad-shooter-pivot')!.rotation.z).toBeGreaterThan(0);
      expect(root.getObjectByName('cad-shooter-pivot')!.rotation.z).toBeLessThan(1.5);
    }
    setCadAnimationEnabled(false);model.update(idle);visual.updateMatrixWorld(true);
    expect(root.getObjectByName('cad-shooter-pivot')!.rotation.z).toBe(0);
    const sourceBounds=new THREE.Box3().setFromObject(root,true);
    const recorded=JSON.parse(readFileSync(`public/models/robots/2024/${id}.report.json`,'utf8')).bounds;
    for(let i=0;i<3;i++){expect(Math.abs(sourceBounds.min.getComponent(i)-recorded.min[i])).toBeLessThan(.001);expect(Math.abs(sourceBounds.max.getComponent(i)-recorded.max[i])).toBeLessThan(.001);}
    setCadAnimationEnabled(true);
    expect(Math.sign(model.intakeAnchor!.getWorldPosition(new THREE.Vector3()).x)).toBe(config.intake.groundSide==='front'?1:-1);
    const report=JSON.parse(readFileSync(`public/models/robots/2024/${id}.report.json`,'utf8'));expect(report.outputBytes).toBeLessThan(id==='domotron-604'?20_000_000:15_000_000);expect(report.outputTriangles).toBeLessThan(1_200_000);
  });
});
