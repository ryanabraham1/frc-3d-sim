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
    const frame=root.getObjectByName('frame')!;const original=frame.matrix.clone();
    for(let i=0;i<=60;i++){
      turret.rotation.y=(i/60-.5)*Math.PI*2;
      model.update({...idle,aiming:true,hood:.14+i/60*.94,climb:i/60,enabled:true,intaking:true});visual.updateMatrixWorld(true);
      root.traverse(o=>expect(o.matrixWorld.elements.every(Number.isFinite)).toBe(true));
      expect(frame.matrix.equals(original)).toBe(true);
      const bounds=new THREE.Box3().setFromObject(root,true);expect(bounds.min.y).toBeGreaterThan(-.035);expect(bounds.max.y).toBeLessThan(2);
      expect(model.flow!.feed!().every(p=>p.toArray().every(Number.isFinite))).toBe(true);
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
    expect(Math.sign(model.intakeAnchor!.position.x)).toBe(config.intake.groundSide==='front'?1:-1);
    const report=JSON.parse(readFileSync(`public/models/robots/2024/${id}.report.json`,'utf8'));expect(report.outputBytes).toBeLessThan(id==='domotron-604'?20_000_000:15_000_000);expect(report.outputTriangles).toBeLessThan(1_200_000);
  });
});
