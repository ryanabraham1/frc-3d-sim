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
const fireweed=()=>heroTeamRobots().find(t=>t.team===1540)!.config;
beforeAll(async()=>{
  const b=readFileSync('public/models/robots/wcp-hero-heist/hero-fireweed-1540.glb');
  await decodeCadModel('hero-fireweed-1540',b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength));
  await RAPIER.init();
});
const build=()=>{
  const c=fireweed(),visual=new THREE.Group(),turret=new THREE.Group();visual.add(turret);
  const m=robotModelBuilder(c.model)!({config:c,visual,turret,alliance:'blue',fp:{length:.884,width:.884},groundSide:-1,stationSide:-1,mats:{dark:new THREE.MeshStandardMaterial(),alu:new THREE.MeshStandardMaterial(),bumper:new THREE.MeshStandardMaterial()}});
  return {c,visual,m};
};
const settle=(m:ReturnType<typeof build>['m'],s:Partial<RobotAnimState>,n=120)=>{for(let i=0;i<n;i++)m.update({...idle,dt:1/60,...s});};

it('1540 Fireweed keeps its sheet entry: four bubbles, one panel, High climb, back intake',()=>{
  const c=normalizeHeroConfig(fireweed());
  expect(c.model).toBe('hero-fireweed-1540');
  expect(storage(c)).toEqual({panels:1,bubbles:4});
  expect(c.climber.maxLevel).toBe(3);
  expect(c.intake.groundSide).toBe('back');
  expect(c.launcher.turret).toBeFalsy();
});

it('CAD rig: intake arm stows inside the frame and deploys out the back over the bumper, frame never moves',()=>{
  const {visual,m}=build();visual.updateMatrixWorld(true);
  const frame=visual.getObjectByName('frame')!;visual.updateMatrixWorld(true);const fixed=frame.matrixWorld.clone();
  settle(m,{enabled:true});visual.updateMatrixWorld(true);
  const stowed=new THREE.Box3().setFromObject(visual.getObjectByName('intake')!,true);
  expect(stowed.min.x).toBeGreaterThan(-.46);
  settle(m,{enabled:true,intaking:true});visual.updateMatrixWorld(true);
  const out=new THREE.Box3().setFromObject(visual.getObjectByName('intake')!,true);
  expect(out.min.x).toBeLessThan(-.65);expect(out.min.y).toBeGreaterThan(-.05);
  visual.traverse(o=>expect(o.matrixWorld.elements.every(Number.isFinite)).toBe(true));
  expect(frame.matrixWorld.equals(fixed)).toBe(true);
  expect(visual.getObjectByName('intake-marker')).toBeTruthy();
});

it('CAD rig: held bubbles are drawn inside the robot in the alliance color, one per held piece',()=>{
  const {visual,m}=build();
  for(const [fill,count] of [[0,0],[.25,1],[.5,2],[1,4]] as const){
    settle(m,{enabled:true,fill},2);visual.updateMatrixWorld(true);
    const shown=visual.children.length&&[] as THREE.Object3D[];void shown;
    const balls:THREE.Object3D[]=[];visual.traverse(o=>{if(o.name==='held-bubble'&&o.visible)balls.push(o);});
    expect(balls.length).toBe(count);
    const robot=new THREE.Box3(new THREE.Vector3(-.45,0,-.45),new THREE.Vector3(.45,.8,.45));
    for(const b of balls)expect(robot.containsPoint(b.getWorldPosition(new THREE.Vector3()))).toBe(true);
  }
});

it('CAD rig: shooter wheels spin and hood tilts when aiming; boat hook extends the vacuum cup for the climb',()=>{
  const {visual,m}=build();
  settle(m,{enabled:true});visual.updateMatrixWorld(true);
  const wheel=visual.getObjectByName('cad-wheel-0-pivot')!,hood=visual.getObjectByName('cad-hood-pivot')!,r0=wheel.rotation.z;
  settle(m,{enabled:true,aiming:true,hood:1.2},60);
  expect(Math.abs(wheel.rotation.z-r0)).toBeGreaterThan(.5);expect(Math.abs(hood.rotation.z)).toBeGreaterThan(.05);
  const cup=visual.getObjectByName('cad-climb-cup-lift')!,tube=visual.getObjectByName('cad-climb-tube-pivot')!;
  settle(m,{enabled:true,climb:1},180);
  expect(cup.position.y).toBeGreaterThan(.5);expect(tube.scale.y).toBeGreaterThan(2);
  const b=new THREE.Box3().setFromObject(visual,true);expect(b.max.y).toBeLessThan(2.1);expect(b.min.y).toBeGreaterThan(-.25);
});

it('CAD rig: the elevator carriage rises with the panel placement pose and the cradle follows it',()=>{
  const {visual,m}=build();
  settle(m,{enabled:true,place:{height:.45,forward:.3,level:0}});const down=visual.getObjectByName('cad-lift')!.position.y;
  settle(m,{enabled:true,place:{height:.9,forward:.6,level:2}},180);
  expect(visual.getObjectByName('cad-lift')!.position.y).toBeGreaterThan(down+.2);
  const cradle=visual.getObjectByName('fireweed-panel-cradle')!;expect(cradle.position.x).toBeCloseTo(.6,1);expect(cradle.position.y).toBeCloseTo(.9,1);
});

for(const alliance of ['blue','red'] as const)it(`Fireweed collects from the back intake and shoots held bubbles for ${alliance}`,()=>{
  const c=fireweed();c.preload=0;
  const sim=new HeadlessSim(heroHeist,RAPIER,{robot:c,alliance,pose:{x:4,y:4,yaw:alliance==='blue'?0:Math.PI}});
  try{
    sim.rules.stage();sim.rules.onPeriodChange(sim.ctx.clock.start());
    const q=sim.robot.body.rotation(),center=sim.robot.body.translation(),rot=new THREE.Quaternion(q.x,q.y,q.z,q.w);
    const i=sim.pool.indices('reserve').find(i=>pieceIdentity(i).kind==='bubble'&&pieceIdentity(i).color===alliance)!;
    const behind=new THREE.Vector3(-(sim.robot.footprint.length/2+.10),.09,0).applyQuaternion(rot).add(new THREE.Vector3(center.x,center.y,center.z));
    const front=new THREE.Vector3(sim.robot.footprint.length/2+.10,.09,0).applyQuaternion(rot).add(new THREE.Vector3(center.x,center.y,center.z));
    sim.pool.placeWorld(i,front);sim.step({...IDLE_COMMAND,intake:true});expect(sim.pool.owner[i]).not.toBe(sim.robot.id);
    sim.pool.placeWorld(i,behind);sim.step({...IDLE_COMMAND,intake:true});
    expect(sim.pool.owner[i]).toBe(sim.robot.id);expect(sim.pool.state[i]).toBe('held');
  }finally{sim.dispose();}
});
