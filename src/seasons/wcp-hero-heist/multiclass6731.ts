import type { TeamRobot } from '@engine/core/season';
import { lb, deg, inch } from '@engine/units';
import { heroRobotDefaults, normalizeHeroConfig } from './config';
import { registerRobotModel, drivebase, box, roller, mat, type ModelKit } from '@engine/robot/models';
import * as THREE from 'three';

/**
 * 6731 Multiclass, WCP CADathon 2025 (sheet row: Multiclass, 6 bubbles, 1 panel, Park). Source: Onshape assembly
 * "main cadathon assembly"; the 2025 technical binder (Mailbox) was not reachable, so the rest is read from the CAD.
 * Mapped from the CAD: swerve 25.5 in square frame; rear over-bumper compliant-wheel floor intake on a hinged arm (hex at
 * x -0.0955); fixed front shooter, two 4 in flywheels in a pivoting hood (no turret); six SPEECH BUBBLEs modelled in the
 * hopper; a STORY PANEL plate on the intake. No climber (Park). [EST]: playing mass, speed, fire rate, hood range, intake travel.
 * Sim gap: the class table gives a MYSTIC 6 bubbles / 0 panels and a GADGETEER 4 bubbles / 2 panels, so the sheet's 6 + 1
 * build is simulated as a Mystic; the story-panel plate is visual only.
 */
registerRobotModel('hero-multiclass-6731',(k:ModelKit)=>{
  const db=drivebase(k),dark=mat(0x171b20),orange=mat(0xff7a1a);
  const hood=new THREE.Group();hood.position.set(.08,.51,0);k.visual.add(hood);
  const wheel=roller(hood,.0508,.2,dark,.19,-.135,0);
  box(k.visual,.30,.18,.34,dark,.12,.30,0);
  const arm=new THREE.Group();arm.position.set(-.0955,.194,0);k.visual.add(arm);
  roller(arm,.0508,.62,orange,-.466,-.13,0);
  return {replaces:['chassis','launcher','hopper','intakeRollers','climber'],update(s){db.update(s);hood.rotation.z=s.aiming?Math.max(-.45,Math.min(.5,s.hood-.85)):0;wheel.rotation.z+=s.aiming?60*s.dt:0;arm.rotation.z=s.enabled?0:-1;}};
});
export function multiclass6731Robot(): TeamRobot {
  const c=heroRobotDefaults();
  c.teamNumber=6731;c.options={...c.options,heroClass:'mystic',archetype:'multiclass-6731',bubbleCapacity:6,panelCapacity:0,panelPreload:0};
  c.frameLength=c.frameWidth=inch(25.5);c.height=.68;c.mass=lb(105);
  c.preload=3;c.maxSpeed=4.5;c.maxAccel=7.5;
  c.intake={...c.intake,width:.62,reach:.22,station:false};
  c.launcher={...c.launcher,turret:false,height:.42,muzzleForward:.30,mounts:[{forward:0,side:0}],rate:3,angle:deg(49),minAngle:deg(25),maxAngle:deg(70)};
  c.climber={maxLevel:0,secondsPerLevel:2.2};
  return {id:'hero-multiclass-6731',team:6731,name:'Multiclass',description:'Mailbox’s Hero Heist Mystic build: rear over-bumper roller intake, six-bubble hopper, fixed shooter with a pivoting hood (chassis aims), park only. Speed, mass, fire rate and joint travel are estimates; the sheet’s single-panel capacity is not simulated.',source:'https://cad.onshape.com/documents/44d79a4408847ce19d00f4f8/w/76e03ec9a527d1f1ec8b04f3/e/2c036c551c14893708853833',config:normalizeHeroConfig(c)};
}
