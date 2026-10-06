import { readFileSync } from 'node:fs';
import { beforeAll, expect, it } from 'vitest';
import * as THREE from 'three';
import { SEASONS } from '../src/seasons';
import { cloneConfig } from '../src/engine/robot/config';
import { CAD_2025_MODEL_IDS, decodeCadModel, cadRobotModelBuilder, setCadAnimationEnabled } from '../src/engine/robot/cadModels';
import type { RobotAnimState } from '../src/engine/robot/models';
const idle:RobotAnimState={dt:0,time:0,enabled:false,intaking:false,firing:0,passing:false,aiming:false,hood:.9,fill:0,climb:0,blocker:0,place:null,vx:0,vz:0,omega:0};
beforeAll(async()=>{
  for(const id of CAD_2025_MODEL_IDS){const b=readFileSync(`public/models/robots/2025/${id}.glb`);await decodeCadModel(id,b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength));}
},60000);
for(const id of CAD_2025_MODEL_IDS)it(`${id}: decoded CAD retains its export bounds and connected moving holders`,()=>{
  const config=cloneConfig(SEASONS.find(s=>s.year===2025)!.teamRobots!.find(r=>r.id===id)!.config);
  const visual=new THREE.Group(),turret=new THREE.Group();visual.add(turret);
  const material=new THREE.MeshStandardMaterial();
  const model=cadRobotModelBuilder(id)!({config,visual,turret,alliance:'blue',fp:{length:config.frameLength,width:config.frameWidth},groundSide:-1,stationSide:-1,mats:{dark:material,alu:material,bumper:material}});
  const root=visual.getObjectByName(`cad-${id}`)!;
  const report=JSON.parse(readFileSync(`public/models/robots/2025/${id}.report.json`,'utf8'));
  // Catch compression corruption against bounds measured before encoding.
  setCadAnimationEnabled(false);model.update(idle);visual.updateMatrixWorld(true);
  const b=new THREE.Box3().setFromObject(root,true);
  b.min.toArray().forEach((v,i)=>expect(v).toBeCloseTo(report.bounds.min[i],4));
  b.max.toArray().forEach((v,i)=>expect(v).toBeCloseTo(report.bounds.max[i],4));
  expect(report.outputBytes/report.inputBytes).toBeLessThan(.06);
  expect(report.outputTriangles/report.inputTriangles).toBeLessThan(.12);
  for(const name of ['frame','arm','carriage','elevator-stage',id==='wildstang-111'?'coral-head':'effector'])expect(root.getObjectByName(name)).toBeTruthy();
  setCadAnimationEnabled(true);model.update(idle);visual.updateMatrixWorld(true);
  if(id==='firefly-118'){const latch=root.getObjectByName('climber-latch')!;expect(latch.parent?.name).toBe('cad-climber-pivot');const stowed=new THREE.Box3().setFromObject(latch,true);expect(stowed.max.x).toBeLessThan(config.frameLength/2);}
  if(['subzero-1778','zuma-581'].includes(id))expect(model.coralAxis).toEqual(id==='zuma-581'?[1,0,0]:[0,0,1]);
  const initial=model.heldAnchor!.getWorldPosition(new THREE.Vector3());
  const fixed=root.getObjectByName('frame')!.matrixWorld.clone();
  const poses=[{height:.45,forward:.3,level:1},{height:1.75,forward:.7,level:4},{height:2.03,forward:.45,level:3,algae:true},{height:.45,forward:.3,level:1,handoff:.5}];
  for(const pose of poses){
    for(let n=0;n<30;n++)model.update({...idle,dt:.03,enabled:true,intaking:true,climb:n/29,place:pose});
    visual.updateMatrixWorld(true);expect(root.getObjectByName('frame')!.matrixWorld.equals(fixed)).toBe(true);
    root.traverse(o=>expect(o.matrixWorld.elements.every(Number.isFinite)).toBe(true));
    const bound=new THREE.Box3().setFromObject(root,true);
    expect(bound.min.y,'CAD should clear the carpet').toBeGreaterThan(-.04);
    expect(bound.max.y).toBeLessThan(3);
    expect(model.heldAnchor!.getWorldPosition(new THREE.Vector3()).toArray().every(Number.isFinite)).toBe(true);
  }
  model.update({...idle,place:{height:1.75,forward:.7,level:4}});visual.updateMatrixWorld(true);
  expect(model.heldAnchor!.getWorldPosition(new THREE.Vector3()).distanceTo(initial)).toBeGreaterThan(.1);
},30000);
