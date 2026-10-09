import {readFileSync} from 'node:fs';
import {beforeAll,expect,it} from 'vitest';
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import {HeadlessSim} from '../src/engine/testing/headless';
import {IDLE_COMMAND} from '../src/engine/robot/robot';
import {SEASONS} from '../src/seasons';
import {cloneConfig} from '../src/engine/robot/config';
import {cadRobotModelBuilder,decodeCadModel,setCadAnimationEnabled} from '../src/engine/robot/cadModels';
import type {RobotAnimState} from '../src/engine/robot/models';
const season=SEASONS.find(s=>s.year===2026)!;
const config=()=>cloneConfig(season.teamRobots!.find(r=>r.id==='reblitz-2910')!.config);
const idle:RobotAnimState={dt:0,time:0,enabled:false,intaking:false,firing:0,passing:false,aiming:false,hood:.9,fill:0,climb:0,blocker:0,place:null,vx:0,vz:0,omega:0};
beforeAll(async()=>{await RAPIER.init();const b=readFileSync('public/models/robots/2026/reblitz-2910.glb');await decodeCadModel('reblitz-2910',b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength));});
it('2910 replaces donor geometry with bounded, independently articulated source CAD',()=>{
  const c=config(),visual=new THREE.Group(),turret=new THREE.Group();visual.add(turret);
  const m=cadRobotModelBuilder(c.model)!({config:c,visual,turret,alliance:'blue',fp:{length:c.frameLength,width:c.frameWidth},groundSide:-1,stationSide:-1,mats:{dark:new THREE.MeshStandardMaterial(),alu:new THREE.MeshStandardMaterial(),bumper:new THREE.MeshStandardMaterial()}});
  const root=visual.getObjectByName('cad-reblitz-2910')!;
  expect(visual.getObjectByName('hopper-fuel-pile')!.userData.fuelSlots).toBe(c.hopperCapacity);
  for(const name of ['frame','hopper','intake','hood','flywheel','feeder'])expect(root.getObjectByName(name)).toBeDefined();
  const frame=root.getObjectByName('frame')!;visual.updateMatrixWorld(true);const bind=frame.matrixWorld.clone();
  for(let i=0;i<81;i++){
    const t=i/80;m.update({...idle,dt:.025,enabled:i<40,aiming:i<40,hood:.5+t*.75,fill:t});visual.updateMatrixWorld(true);
    root.traverse(o=>expect(o.matrixWorld.elements.every(Number.isFinite)).toBe(true));
    expect(frame.matrixWorld.equals(bind)).toBe(true);
    const intakeBounds=new THREE.Box3().setFromObject(root.getObjectByName('intake')!,true);
    expect(intakeBounds.min.y).toBeGreaterThan(.02);
    expect(m.flow!.feed!(i).every(p=>p.toArray().every(Number.isFinite))).toBe(true);
  }
  m.update(idle);visual.updateMatrixWorld(true);
  expect(new THREE.Box3().setFromObject(root.getObjectByName('intake')!,true).min.x).toBeGreaterThan(-c.frameLength/2-.04);
  m.update({...idle,enabled:true});visual.updateMatrixWorld(true);
  const deployed=m.intakeAnchor!.getWorldPosition(new THREE.Vector3());expect(deployed.x).toBeCloseTo(-.610318,4);
  expect(deployed.y).toBeCloseTo(.160655,4);
  setCadAnimationEnabled(false);const rotation=root.getObjectByName('cad-intake-pivot')!.rotation.z;
  m.update(idle);expect(root.getObjectByName('cad-intake-pivot')!.rotation.z).toBe(rotation);setCadAnimationEnabled(true);
  const report=JSON.parse(readFileSync('public/models/robots/2026/reblitz-2910.report.json','utf8'));
  expect(report.outputBytes).toBeLessThan(7_000_000);expect(report.outputTriangles/report.inputTriangles).toBeLessThan(.12);
});
it('saved 2910 defaults adopt measured dimensions without changing capacity, rate or custom sizes',()=>{
  const old=config();old.frameLength=.6858;old.height=.5334;const c=season.normalizeRobotConfig!(old);
  expect(c.frameLength).toBe(.6985);expect(c.height).toBe(.55);expect(c.hopperCapacity).toBe(50);expect(c.launcher.rate).toBe(33);
  c.frameLength=.70;c.height=.56;const custom=season.normalizeRobotConfig!(c);expect(custom.frameLength).toBe(.70);expect(custom.height).toBe(.56);
});

it('2910 collects through its rear CAD mouth and rejects the shooter side in gameplay',()=>{
  for(const side of [-1,1]){
    const sim=new HeadlessSim(season,RAPIER,{robot:config(),alliance:'blue',pose:{x:3,y:2,yaw:0}});
    try {
      for(const i of sim.robot.held.splice(0))sim.pool.reserve(i);
      sim.pool.placeField(0,3+side*.61,2);
      sim.run(.7,{...IDLE_COMMAND,intake:true});
      expect(sim.robot.held.length).toBe(side===-1?1:0);
    } finally {sim.dispose();}
  }
});
