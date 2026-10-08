import type { TeamRobot } from '@engine/core/season';
import { lb, deg, inch } from '@engine/units';
import { heroRobotDefaults, normalizeHeroConfig, PLAYING_MASS_ALLOWANCE } from './config';
import { registerRobotModel, drivebase, box, bar, mat, roller, type ModelKit } from '@engine/robot/models';
import * as THREE from 'three';
import { fireweedTeamRobot } from './fireweed1540';

// Lightweight source-shaped fallback for headless play or a failed CAD load.
registerRobotModel('hero-mantis-6800',(k:ModelKit)=>{
  const db=drivebase(k),dark=mat(0x171b20),gold=mat(0xb7994d);
  const turret=new THREE.Group();turret.position.set(.155,.65,0);k.visual.add(turret);
  box(turret,.30,.025,.28,gold,0,0,0);
  const wheel=roller(turret,.0508,.18,dark,.107,.074,0);
  const sides=[-1,1].map(sign=>{const g=new THREE.Group();g.position.set(0,.24,sign*.18415);k.visual.add(g);
    for(const x of [-.28,.28])bar(g,[x,0,0],[x,-.08,sign*.32],.018,gold);
    roller(g,.026,.58,dark,0,-.08,sign*.32).rotation.y=Math.PI/2;return g;});
  box(k.visual,.18,.43,.20,dark,.23,.41,0);
  const mast=box(k.visual,.04,.52,.04,gold,-.26,.29,0);
  return {replaces:['chassis','launcher','hopper','intakeRollers','climber'],update(s){db.update(s);turret.rotation.y=k.turret.rotation.y;wheel.rotation.z+=s.aiming?45*s.dt:0;turret.rotation.z=s.climb>0?-1.4:0;sides.forEach((g,i)=>g.rotation.x=s.enabled?(i===0?-.3:.3):0);mast.scale.y=1+s.climb;}};
});
// Lightweight fallback for headless play or a failed CAD load: frame, front roller bar, same-side shooter and side mast.
registerRobotModel('hero-constantine-1318',(k:ModelKit)=>{
  const db=drivebase(k),dark=mat(0x171b20),steel=mat(0x9aa3ad);
  roller(k.visual,.026,.60,dark,.30,.16,0).rotation.x=Math.PI/2;
  const wheel=roller(k.visual,.05,.18,dark,-.07,.56,0);wheel.rotation.x=Math.PI/2;
  box(k.visual,.22,.20,.22,steel,-.02,.50,0);
  box(k.visual,.05,.60,.05,steel,0,.66,-.20);
  return {replaces:['chassis','launcher','hopper','intakeRollers','climber'],update(s){db.update(s);wheel.rotation.z-=s.aiming?45*s.dt:0;}};
});
export function heroTeamRobots(): TeamRobot[] {
  const c=heroRobotDefaults();
  c.teamNumber=6800;c.options={...c.options,heroClass:'mystic',archetype:'mantis-6800',bubbleCapacity:6,panelCapacity:0,panelPreload:0,dualSideIntake:true};
  c.frameLength=.6604;c.frameWidth=.6096;c.height=.905818;c.mass=lb(131);
  c.preload=3;c.maxSpeed=4.5;c.maxAccel=7.5;
  c.intake={...c.intake,width:.60,reach:.24,groundYaw:Math.PI/2,station:false};
  c.launcher={...c.launcher,turret:true,height:.72425,muzzleForward:.107,mounts:[{forward:.155,side:0}],rate:3,angle:deg(49),minAngle:deg(15),maxAngle:deg(70)};
  // Medium pending full folded-body clearance validation; sheet claims High.
  c.climber={maxLevel:2,secondsPerLevel:1.7};
  const mantis:TeamRobot={id:'hero-mantis-6800',team:6800,name:'Mantis',description:'Valor’s Hero Heist Mystic: dual side intakes, six-bubble spindexer, turret and roller hood, folding magazine and telescoping suction climb. Drive speed, joint travel and playing mass are estimates.',source:'https://cad.onshape.com/documents/e4397ae1ed0ebe3445466e8a/w/dc22b6503a48cdc0a163c772/e/579f1fa8cfef57db8f7205ca',config:normalizeHeroConfig(c)};
  return [mantis,constantine1318(),fireweedTeamRobot()];
}
/** 1318 "Constantine": Mystic with a full-width 4-bar intake and a same-side geared-hood shooter (CAD -Y = sim +X). */
function constantine1318(): TeamRobot {
  const c=heroRobotDefaults();
  c.teamNumber=1318;c.options={...c.options,heroClass:'mystic',archetype:'constantine-1318',intakeSide:'front',bubbleCapacity:6,panelCapacity:0,panelPreload:0};
  // Frame 25.5 in square, 38 in tall, 95 lb robot [binder] + bumpers/battery allowance.
  c.frameLength=.6477;c.frameWidth=.6477;c.height=.955;c.mass=lb(95)+PLAYING_MASS_ALLOWANCE;
  c.preload=3;c.maxSpeed=4.4;c.maxAccel=7.5;
  // The 4-bar intake and the shooter exit are both on the front; the binder's 25 in roller bar defines the mouth.
  c.intake={...c.intake,groundSide:'front',width:inch(24),reach:.20,station:false};
  c.launcher={...c.launcher,turret:false,height:.62,muzzleForward:.20,rate:3,angle:deg(50),minAngle:deg(25),maxAngle:deg(72)};
  // The binder claims a suction LOW climb; the sheet column says High, so the binder (primary source) wins.
  c.climber={maxLevel:1,secondsPerLevel:2.2};
  return {id:'hero-constantine-1318',team:1318,name:'Constantine',description:'Team 1318’s Hero Heist Mystic: full-width collapsing 4-bar intake, indexer loop into a geared-hood shooter on the same side, suction low climb. Drive speed, shooter rate, hood range and playing mass are estimates.',source:'https://cad.onshape.com/documents/34bba2a1872e9254fdab9bc0/w/fb4e5e9e34fc3f6a78a07f49/e/849abb67fbd36e9b8f4f4969',config:normalizeHeroConfig(c)};
}
