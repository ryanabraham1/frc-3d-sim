import { readFileSync } from 'node:fs';
import { beforeAll, expect, it } from 'vitest';
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { decodeCadModel } from '../src/engine/robot/cadModels';
import { robotModelBuilder, type RobotAnimState } from '../src/engine/robot/models';
import { heroTeamRobots } from '../src/seasons/wcp-hero-heist/teamRobots';
import { normalizeHeroConfig, storage } from '../src/seasons/wcp-hero-heist/config';
import { HeadlessSim } from '../src/engine/testing/headless';
import { heroHeist } from '../src/seasons/wcp-hero-heist';
import { IDLE_COMMAND } from '../src/engine/robot/robot';
import { pieceIdentity } from '../src/seasons/wcp-hero-heist/constants';
const idle:RobotAnimState={dt:0,time:0,enabled:false,intaking:false,firing:0,passing:false,aiming:false,hood:.85,fill:0,climb:0,blocker:0,place:null,vx:0,vz:0,omega:0};
const team=()=>heroTeamRobots().find(r=>r.team===1318)!;
beforeAll(async()=>{
 await RAPIER.init();
 const b=readFileSync('public/models/robots/wcp-hero-heist/hero-constantine-1318.glb');
 await decodeCadModel('hero-constantine-1318',b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength));
});
const build=()=>{
 const c=team().config,visual=new THREE.Group(),turret=new THREE.Group();visual.add(turret);
 const m=robotModelBuilder(c.model)!({config:c,visual,turret,alliance:'blue',fp:{length:.6477,width:.6477},groundSide:1,stationSide:1,mats:{dark:new THREE.MeshStandardMaterial(),alu:new THREE.MeshStandardMaterial(),bumper:new THREE.MeshStandardMaterial()}});
 return {c,visual,m};
};
it('Constantine is a six-bubble Mystic with a front intake and a binder-limited low climb',()=>{
 const c=normalizeHeroConfig(team().config);
 expect(c.model).toBe('hero-constantine-1318');expect(storage(c)).toEqual({panels:0,bubbles:6});
 expect(c.intake.groundSide).toBe('front');expect(c.launcher.turret).toBeFalsy();expect(c.climber.maxLevel).toBe(1);
});
it('actual CAD deploys the 4-bar intake outward and down, spins the flywheel, raises the hood and extends the telescope',()=>{
 const {visual,m}=build();
 m.update(idle);visual.updateMatrixWorld(true);
 const frame=visual.getObjectByName('frame')!;const fixed=frame.matrixWorld.clone();
 const coupler=visual.getObjectByName('cad-intake-coupler')!,tipAt=()=>{const v=new THREE.Vector3();m.intakeAnchor!.getWorldPosition(v);return v;};
 const stowed=tipAt();
 let deployed=new THREE.Vector3(),linkAngle=0,tipOut=0,tipY=9;
 for(let i=0;i<240;i++){
  m.update({...idle,dt:1/60,enabled:true,intaking:true,aiming:true,hood:1.1,climb:i>150?1:0});visual.updateMatrixWorld(true);expect(frame.matrixWorld.equals(fixed)).toBe(true);
  if(i===150){deployed=coupler.position.clone();linkAngle=visual.getObjectByName('cad-intake-links-pivot')!.rotation.z;tipOut=tipAt().x;tipY=tipAt().y;}
 }
 expect(deployed.x).toBeGreaterThan(.1);expect(deployed.y).toBeLessThan(-.04);expect(linkAngle).toBeLessThan(-.4);
 // The telescope-climb phase folds the intake back in.
 expect(coupler.position.x).toBeLessThan(.02);
 expect(Math.abs(visual.getObjectByName('cad-flywheel-pivot')!.rotation.z)).toBeGreaterThan(.5);
 expect(visual.getObjectByName('cad-hood-pivot')!.rotation.z).toBeGreaterThan(.1);
 expect(visual.getObjectByName('climb-top')!.position.y).toBeGreaterThan(.3);
 expect(tipOut).toBeGreaterThan(stowed.x+.1);expect(tipY).toBeLessThan(stowed.y);
 const b=new THREE.Box3().setFromObject(visual);expect(b.max.y).toBeLessThan(2.1);expect(b.min.y).toBeGreaterThan(-.25);
});
it('Constantine draws its held bubbles and marks the front intake mouth',()=>{
 const {visual,m}=build();
 const spheres=()=>{let n=0;visual.traverse(o=>{if(o instanceof THREE.Mesh&&o.geometry instanceof THREE.SphereGeometry&&o.visible)n++;});return n;};
 m.update({...idle,fill:0});expect(spheres()).toBe(0);
 m.update({...idle,fill:.5});expect(spheres()).toBe(3);
 m.update({...idle,fill:1});expect(spheres()).toBe(6);
 let markers=0;visual.traverse(o=>{if(o instanceof THREE.Mesh&&o.geometry instanceof THREE.CylinderGeometry&&(o.material as THREE.MeshStandardMaterial).color?.getHex()===0xff7a1a)markers++;});
 expect(markers).toBe(1);
});
for(const alliance of ['blue','red'] as const)it(`Constantine collects from its front mouth and shoots out the same side for ${alliance}`,()=>{
 const c=team().config;c.preload=0;
 const sim=new HeadlessSim(heroHeist,RAPIER,{robot:c,alliance,pose:{x:4,y:4,yaw:alliance==='blue'?0:Math.PI}});
 try{
  sim.rules.stage();sim.rules.onPeriodChange(sim.ctx.clock.start());
  const q=sim.robot.body.rotation(),center=sim.robot.body.translation();
  const i=sim.pool.indices('reserve').find(i=>pieceIdentity(i).kind==='bubble'&&pieceIdentity(i).color===alliance)!;
  const p=new THREE.Vector3(sim.robot.footprint.length/2+.10,.09,0).applyQuaternion(new THREE.Quaternion(q.x,q.y,q.z,q.w)).add(new THREE.Vector3(center.x,center.y,center.z));
  sim.pool.placeWorld(i,p);sim.step({...IDLE_COMMAND,intake:true});
  expect(sim.pool.owner[i]).toBe(sim.robot.id);expect(sim.pool.state[i]).toBe('held');
 }finally{sim.dispose();}
});
