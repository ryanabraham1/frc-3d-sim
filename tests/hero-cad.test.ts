import { readFileSync } from 'node:fs';
import { beforeAll, expect, it } from 'vitest';
import * as THREE from 'three';
import { decodeCadModel } from '../src/engine/robot/cadModels';
import { robotModelBuilder, type RobotAnimState } from '../src/engine/robot/models';
import { heroTeamRobots } from '../src/seasons/wcp-hero-heist/teamRobots';
import { normalizeHeroConfig, storage } from '../src/seasons/wcp-hero-heist/config';
const idle:RobotAnimState={dt:0,time:0,enabled:false,intaking:false,firing:0,passing:false,aiming:false,hood:.85,fill:0,climb:0,blocker:0,place:null,vx:0,vz:0,omega:0};
beforeAll(async()=>{const b=readFileSync('public/models/robots/wcp-hero-heist/hero-mantis-6800.glb');await decodeCadModel('hero-mantis-6800',b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength));});
it('Mantis remains selectable after normalization and carries six bubbles with no panels',()=>{
 const c=normalizeHeroConfig(heroTeamRobots()[0].config);expect(c.model).toBe('hero-mantis-6800');expect(storage(c)).toEqual({panels:0,bubbles:6});expect(c.launcher.mounts).toEqual([{forward:.155,side:0}]);
});
it('actual CAD follows turret yaw, deploys both side intakes, folds and extends the separate telescope stages',()=>{
 const c=heroTeamRobots()[0].config,visual=new THREE.Group(),turret=new THREE.Group();visual.add(turret);
 const m=robotModelBuilder(c.model)!({config:c,visual,turret,alliance:'blue',fp:{length:.81,width:.76},groundSide:-1,stationSide:-1,mats:{dark:new THREE.MeshStandardMaterial(),alu:new THREE.MeshStandardMaterial(),bumper:new THREE.MeshStandardMaterial()}});
 m.update(idle);const frame=visual.getObjectByName('frame')!;visual.updateMatrixWorld(true);const fixed=frame.matrixWorld.clone();
 for(let i=0;i<90;i++) {turret.rotation.y=(i/89-.5)*Math.PI*2;m.update({...idle,dt:1/60,enabled:true,intaking:true,aiming:true,hood:.26+i/89*.96,climb:i>60?1:0});visual.updateMatrixWorld(true);visual.traverse(o=>expect(o.matrixWorld.elements.every(Number.isFinite)).toBe(true));expect(frame.matrixWorld.equals(fixed)).toBe(true);}
 expect(visual.getObjectByName('cad-turret-pivot')!.rotation.y).toBeCloseTo(Math.PI);
 expect(Math.abs(visual.getObjectByName('cad-fold-pivot')!.rotation.z)).toBeGreaterThan(.5);
 expect(visual.getObjectByName('climb-end')!.position.y).toBeGreaterThan(.3);
 const b=new THREE.Box3().setFromObject(visual);expect(b.max.y).toBeLessThan(2.1);expect(b.min.y).toBeGreaterThan(-.25);
});

import RAPIER from '@dimforge/rapier3d-compat';
import { HeadlessSim } from '../src/engine/testing/headless';
import { heroHeist } from '../src/seasons/wcp-hero-heist';
import { IDLE_COMMAND } from '../src/engine/robot/robot';
import { pieceIdentity } from '../src/seasons/wcp-hero-heist/constants';
beforeAll(async()=>{await RAPIER.init();});
for(const alliance of ['blue','red'] as const)it(`Mantis collects from both physical sides for ${alliance}`,()=>{
 const c=heroTeamRobots()[0].config;c.preload=0;
 const sim=new HeadlessSim(heroHeist,RAPIER,{robot:c,alliance,pose:{x:4,y:4,yaw:alliance==='blue'?0:Math.PI}});
 try {
  sim.rules.stage();sim.rules.onPeriodChange(sim.ctx.clock.start());
  const q=sim.robot.body.rotation();const center=sim.robot.body.translation();
  for(const side of [-1,1]){
   const i=sim.pool.indices('reserve').find(i=>pieceIdentity(i).kind==='bubble'&&pieceIdentity(i).color===alliance)!;
   const p=new THREE.Vector3(0,.09,side*(sim.robot.footprint.width/2+.10)).applyQuaternion(new THREE.Quaternion(q.x,q.y,q.z,q.w)).add(new THREE.Vector3(center.x,center.y,center.z));
   sim.pool.placeWorld(i,p);sim.step({...IDLE_COMMAND,intake:true});expect(sim.pool.owner[i]).toBe(sim.robot.id);expect(sim.pool.state[i]).toBe('held');
  }
 }finally{sim.dispose();}
});
