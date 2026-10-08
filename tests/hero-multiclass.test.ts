import { readFileSync } from 'node:fs';
import { beforeAll, expect, it } from 'vitest';
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { decodeCadModel } from '../src/engine/robot/cadModels';
import { robotModelBuilder, type RobotAnimState } from '../src/engine/robot/models';
import { HeadlessSim } from '../src/engine/testing/headless';
import { IDLE_COMMAND } from '../src/engine/robot/robot';
import { heroHeist } from '../src/seasons/wcp-hero-heist';
import { heroTeamRobots } from '../src/seasons/wcp-hero-heist/teamRobots';
import { normalizeHeroConfig, storage } from '../src/seasons/wcp-hero-heist/config';
import { pieceIdentity } from '../src/seasons/wcp-hero-heist/constants';

const idle:RobotAnimState={dt:0,time:0,enabled:false,intaking:false,firing:0,passing:false,aiming:false,hood:.85,fill:0,climb:0,blocker:0,place:null,vx:0,vz:0,omega:0};
const config=()=>heroTeamRobots().find(r=>r.team===6731)!.config;
beforeAll(async()=>{
  const b=readFileSync('public/models/robots/wcp-hero-heist/hero-multiclass-6731.glb');
  await decodeCadModel('hero-multiclass-6731',b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength));
  await RAPIER.init();
});
it('Multiclass is a six-bubble Mystic that parks and does not climb',()=>{
  const c=normalizeHeroConfig(config());
  expect(c.model).toBe('hero-multiclass-6731');expect(storage(c)).toEqual({panels:0,bubbles:6});
  expect(c.climber.maxLevel).toBe(0);expect(c.launcher.turret).toBe(false);expect(c.intake.groundSide).toBe('back');
});
it('the CAD shows held bubbles by fill, marks the intake orange, and moves arm, hood and rollers on a fixed frame',()=>{
  const c=config(),visual=new THREE.Group(),turret=new THREE.Group();visual.add(turret);
  const m=robotModelBuilder(c.model)!({config:c,visual,turret,alliance:'blue',fp:{length:.81,width:.81},groundSide:-1,stationSide:-1,mats:{dark:new THREE.MeshStandardMaterial(),alu:new THREE.MeshStandardMaterial(),bumper:new THREE.MeshStandardMaterial()}} as never);
  const shown=()=>visual.children.length&&[0,1,2,3,4,5].filter(i=>visual.getObjectByName(`bubble-${i}`)!.visible).length;
  m.update({...idle,fill:0});expect(shown()).toBe(0);
  m.update({...idle,fill:.5});expect(shown()).toBe(3);
  m.update({...idle,fill:1});expect(shown()).toBe(6);
  const roller=visual.getObjectByName('roller-main')!,color=((roller.getObjectByProperty('isMesh',true) as THREE.Mesh).material as THREE.MeshStandardMaterial).color;
  expect(color.r).toBeGreaterThan(color.b*2);
  visual.updateMatrixWorld(true);const frame=visual.getObjectByName('frame')!,fixed=frame.matrixWorld.clone();
  const arm=visual.getObjectByName('cad-intake-pivot')!,hood=visual.getObjectByName('cad-hood-pivot')!;
  for(let i=0;i<60;i++)m.update({...idle,dt:1/60,enabled:true,intaking:true,aiming:true,firing:i%2?1:0,hood:.26+i/59*.96,fill:1});
  for(let i=0;i<60;i++)m.update({...idle,dt:1/60,enabled:false});
  expect(arm.rotation.z).toBeLessThan(-.5);
  for(let i=0;i<60;i++)m.update({...idle,dt:1/60,enabled:true,aiming:true,hood:1.2});
  expect(arm.rotation.z).toBeCloseTo(0,2);expect(hood.rotation.z).toBeGreaterThan(.2);
  expect(visual.getObjectByName('cad-roller-main-pivot')!.rotation.z).not.toBe(0);
  visual.updateMatrixWorld(true);expect(frame.matrixWorld.equals(fixed)).toBe(true);
  visual.traverse(o=>expect(o.matrixWorld.elements.every(Number.isFinite)).toBe(true));
  const b=new THREE.Box3().setFromObject(visual);expect(b.min.y).toBeGreaterThan(-.05);expect(b.max.y).toBeLessThan(1.1);
});
for(const alliance of ['blue','red'] as const)it(`Multiclass collects from its rear intake and fires three bubbles for ${alliance}`,()=>{
  const c=config();c.preload=0;
  const sim=new HeadlessSim(heroHeist,RAPIER,{robot:c,alliance,pose:{x:4,y:4,yaw:alliance==='blue'?0:Math.PI}});
  try{
    sim.rules.stage();sim.rules.onPeriodChange(sim.ctx.clock.start());
    const q=sim.robot.body.rotation(),t=sim.robot.body.translation();
    const behind=new THREE.Vector3(-(sim.robot.footprint.length/2+.12),.09,0).applyQuaternion(new THREE.Quaternion(q.x,q.y,q.z,q.w)).add(new THREE.Vector3(t.x,t.y,t.z));
    const i=sim.pool.indices('reserve').find(i=>pieceIdentity(i).kind==='bubble'&&pieceIdentity(i).color===alliance)!;
    sim.pool.placeWorld(i,behind);sim.step({...IDLE_COMMAND,intake:true});
    expect(sim.pool.owner[i]).toBe(sim.robot.id);expect(sim.pool.state[i]).toBe('held');
    sim.load(3);sim.run(3,{...IDLE_COMMAND,shoot:true});expect(sim.fired).toBeGreaterThanOrEqual(3);
  }finally{sim.dispose();}
});
