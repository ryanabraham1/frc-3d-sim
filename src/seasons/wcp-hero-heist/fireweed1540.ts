import type { TeamRobot } from '@engine/core/season';
import { lb, deg } from '@engine/units';
import { heroRobotDefaults, normalizeHeroConfig } from './config';
import { registerRobotModel, drivebase, box, mat, roller, approach, intakeDeployTarget, type ModelKit } from '@engine/robot/models';
import * as THREE from 'three';

// Lightweight source-shaped fallback for headless play or a failed CAD load: back intake arm, front 4-ball indexer and
// shooter, boat-hook climber mast. The CAD rig lives in engine/robot/heroFireweed1540.ts.
registerRobotModel('hero-fireweed-1540',(k:ModelKit)=>{
  const db=drivebase(k),dark=mat(0x171b20),alu=mat(0xc0c7cf),orange=mat(0xff7a1a,{rough:.5}),ball=mat(k.alliance==='red'?0xe83d4f:0x337fe8,{rough:.7});
  const arm=new THREE.Group();arm.position.set(-.30,.35,0);k.visual.add(arm);
  for(const s of[-1,1])box(arm,.43,.03,.03,alu,-.215,-.1,s*.26);
  roller(arm,.022,.56,orange,-.43,-.2,0);
  box(k.visual,.5,.45,.20,dark,.1,.40,.09);
  const wheel=roller(k.visual,.04,.18,dark,.09,.6,.09);
  const balls=[[.06,.55],[.21,.44],[.135,.285],[-.04,.285]].map(([x,y])=>{const m=new THREE.Mesh(new THREE.SphereGeometry(.085,12,8),ball);m.position.set(x,y,.09);m.visible=false;k.visual.add(m);return m;});
  const mast=box(k.visual,.04,.4,.04,alu,.02,.35,-.15);
  const held=new THREE.Group();k.visual.add(held);
  let dep=0;
  return {replaces:['chassis','launcher','hopper','intakeRollers','climber'],heldAnchor:held,update(s){db.update(s);dep=approach(dep,intakeDeployTarget(s),7,s.dt);arm.rotation.z=-(1-dep)*2.15;wheel.rotation.z-=s.aiming?45*s.dt:0;
    balls.forEach((b,i)=>b.visible=i<Math.round(s.fill*4));mast.scale.y=1+s.climb;mast.position.y=.35+.2*s.climb;
    held.position.set(s.place?s.place.forward:.3,s.place?s.place.height:.45,0);}};
});
export function fireweedTeamRobot(): TeamRobot {
  const c=heroRobotDefaults();
  c.teamNumber=1540;c.options={...c.options,heroClass:'gadgeteer',archetype:'fireweed-1540',bubbleCapacity:4,panelCapacity:1};
  // Binder: 29.5 in swerve frame (SDS MK5, Kraken X60/X44), 4-bubble indexer, boat-hook climb "under two seconds" for all levels. Mass, speed and feed rate are estimates.
  c.frameLength=.749;c.frameWidth=.749;c.height=.743;c.mass=lb(110);
  c.preload=3;c.maxSpeed=4.5;c.maxAccel=7.5;
  c.intake={...c.intake,width:.56,reach:.20};
  c.launcher={...c.launcher,turret:false,height:.62,muzzleForward:.30,rate:3,angle:deg(50),minAngle:deg(15),maxAngle:deg(70)};
  c.placement={...c.placement!,maxLevel:2};
  c.climber={maxLevel:3,secondsPerLevel:1.8};
  return {id:'hero-fireweed-1540',team:1540,name:'Fireweed',description:'The Flaming Chickens’ Hero Heist Gadgeteer: back double-jointed arm (bubble intake plus panel end effector) on a one-stage elevator, four-bubble indexer feeding a servo-hood Stealth-wheel shooter, one STORY PANEL, and a vacuum-cup boat-hook climber. Speed, mass, feed rate and joint travel are estimates.',source:'https://cad.onshape.com/documents/13077706b3602fcaaebf812d/w/7f881b0a224dbb2d9b86c00c/e/20ba2a33bef8a50a9e6c0bb0',config:normalizeHeroConfig(c)};
}
