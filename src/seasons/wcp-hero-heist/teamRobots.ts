import type { TeamRobot } from '@engine/core/season';
import { lb, deg, inch } from '@engine/units';
import { heroRobotDefaults, normalizeHeroConfig, PLAYING_MASS_ALLOWANCE } from './config';
import { registerRobotModel, drivebase, box, bar, mat, roller, type ModelKit } from '@engine/robot/models';
import * as THREE from 'three';
import { multiclass6731Robot } from './multiclass6731';
import { fireweedTeamRobot } from './fireweed1540';
import { team5800Robots } from './team5800';
import { poofs254Robot } from './team254';
import { sentinel1923Robot } from './sentinel1923';
import { hero498Robot } from './robot498';

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
  const intakeBar=roller(k.visual,.026,.60,dark,.30,.16,0);intakeBar.rotation.x=Math.PI/2;
  const wheel=roller(k.visual,.05,.18,dark,-.07,.56,0);wheel.rotation.x=Math.PI/2;
  box(k.visual,.22,.20,.22,steel,-.02,.50,0);
  box(k.visual,.05,.60,.05,steel,0,.66,-.20);
  return {replaces:['chassis','launcher','hopper','intakeRollers','climber'],update(s){db.update(s);intakeBar.position.set(s.enabled?.51:.30,s.enabled?.07:.16,0);wheel.rotation.z-=s.aiming?45*s.dt:0;}};
});
// Lightweight source-shaped fallback for headless play or a failed CAD load: intake low at the back, midtake, shooter and panel lift at the front.
registerRobotModel('hero-nomad-6995',(k:ModelKit)=>{
  const db=drivebase(k),dark=mat(0x171b20),red=mat(0xb02a2a);
  const slap=new THREE.Group();slap.position.set(-.09,.44,0);k.visual.add(slap);
  roller(slap,.026,.56,dark,-.14,-.05,0).rotation.x=Math.PI/2;
  roller(k.visual,.03,.60,dark,-.31,.26,0).rotation.x=Math.PI/2;
  box(k.visual,.36,.22,.42,dark,-.06,.14,0);box(k.visual,.28,.20,.30,red,.16,.38,0);
  const stage=box(k.visual,.06,.76,.52,dark,.02,.40,0);box(k.visual,.5,.06,.30,red,.22,.98,0);
  return {replaces:['chassis','launcher','hopper','intakeRollers','climber','funnel'],update(s){db.update(s);slap.rotation.z=s.enabled?.95:0;stage.scale.y=1;}};
});
export function heroTeamRobots(): TeamRobot[] {
  return [...mantis6800(), ...gadgeteer9408()];
}
function mantis6800(): TeamRobot[] {
  const c=heroRobotDefaults();
  c.teamNumber=6800;c.options={...c.options,heroClass:'mystic',archetype:'mantis-6800',bubbleCapacity:6,panelCapacity:0,panelPreload:0,dualSideIntake:true};
  c.frameLength=.6604;c.frameWidth=.6096;c.height=.905818;c.mass=lb(131);
  c.preload=3;c.maxSpeed=4.5;c.maxAccel=7.5;
  c.intake={...c.intake,width:.60,reach:.24,groundYaw:Math.PI/2,station:false};
  c.launcher={...c.launcher,turret:true,height:.72425,muzzleForward:.107,mounts:[{forward:.155,side:0}],rate:3,angle:deg(49),minAngle:deg(15),maxAngle:deg(70)};
  // Medium pending full folded-body clearance validation; sheet claims High.
  c.climber={maxLevel:2,secondsPerLevel:1.7};
  const mantis:TeamRobot={id:'hero-mantis-6800',team:6800,name:'Mantis',description:'Valor’s Hero Heist Mystic: dual side intakes, six-bubble spindexer, turret and roller hood, folding magazine and telescoping suction climb. Drive speed, joint travel and playing mass are estimates.',source:'https://cad.onshape.com/documents/e4397ae1ed0ebe3445466e8a/w/dc22b6503a48cdc0a163c772/e/579f1fa8cfef57db8f7205ca',config:normalizeHeroConfig(c)};
  return [mantis,constantine1318(),nomad6995(),fireweedTeamRobot(),...team5800Robots(),poofs254Robot(),sentinel1923Robot(),multiclass6731Robot(),hero498Robot()];
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
/** 6995 "Nomad": gadgeteer, panel slapdown + linear bubble intake on the back, fixed hooded shooter and 2-stage panel lift on the front. */
function nomad6995(): TeamRobot {
  const n=heroRobotDefaults();
  // 6995 NOMAD: gadgeteer with a panel slapdown + linear ball intake on the back, a fixed hooded shooter and a 2-stage panel lift on the front.
  n.teamNumber=6995;n.options={...n.options,heroClass:'gadgeteer',archetype:'nomad-6995',bubbleCapacity:4,panelCapacity:2,panelPreload:1};
  n.frameLength=.6477;n.frameWidth=.6477;n.height=inch(30);n.mass=lb(95);n.preload=3;n.maxSpeed=4.3;n.maxAccel=7.5;
  n.intake={...n.intake,width:.60,reach:.22,ground:true,station:false};
  n.launcher={...n.launcher,turret:false,height:.45,muzzleForward:.26,rate:2.5,angle:deg(55),minAngle:deg(40),maxAngle:deg(67)};
  n.placement={...n.placement!,maxLevel:2,liftSpeed:1.2};
  n.climber={maxLevel:0,secondsPerLevel:2.2}; // park only (sheet: Park)
  return {id:'hero-nomad-6995',team:6995,name:'Nomad',description:'Gadgeteer: floor slapdown for STORY PANELS and a linear BUBBLE intake on one end (up to 2 panels or 4 bubbles), midtake belts, a fixed hooded shooter and a 2-stage belted elevator with a pivoting end effector (low FOOTHILL baskets). Park only. Speed, shooter rate, hood range and joint travel are estimates.',source:'https://cad.onshape.com/documents/dc43b19f2e46981255d7d233/w/0a4080792ce2fab8a15b6f4c/e/e2fb5b73bb40afbd07be44d8',config:normalizeHeroConfig(n)};
}

// Lightweight source-shaped fallback for headless play or a failed CAD load: swerve frame, floor intake arm on the back,
// elevator mast with claw, shooter drum and the telescoping climber.
registerRobotModel('hero-gadgeteer-9408',(k:ModelKit)=>{
  const db=drivebase(k),dark=mat(0x171b20),steel=mat(0xb9c0c8),orange=mat(0xff7a1a),purple=mat(0x6a3fa0);
  const arm=new THREE.Group();arm.position.set(-.198,.177,0);k.visual.add(arm);
  for(const z of [-.34,.34])bar(arm,[0,0,z],[-.42,-.04,z],.02,mat(0x2f9a3c));
  roller(arm,.02,.62,orange,-.42,-.04,0).rotation.x=Math.PI/2;
  box(k.visual,.09,.70,.09,purple,0,.40,.2);
  const drum=roller(k.visual,.07,.5,dark,.03,.709,0);
  const climb=box(k.visual,.05,.5,.05,steel,.082,.30,-.241);
  return {replaces:['chassis','launcher','hopper','intakeRollers','climber'],update(s){db.update(s);arm.rotation.z=s.enabled&&!s.climb?0:-1.3;drum.rotation.z+=s.aiming?60*s.dt:0;climb.scale.y=1+s.climb*1.8;}};
});
function gadgeteer9408(): TeamRobot[] {
  const c=heroRobotDefaults();
  // [EST] values: the sheet gives 4 bubbles, 2 panels, HIGH climb; the binder was not accessible for speeds/rates.
  c.teamNumber=9408;c.options={...c.options,heroClass:'gadgeteer',archetype:'gadgeteer-9408',bubbleCapacity:4,panelCapacity:2,panelPreload:1};
  c.frameLength=.7112;c.frameWidth=.7112;c.height=.762;c.mass=lb(120);
  c.preload=3;c.maxSpeed=4.4;c.maxAccel=7.5;
  c.intake={...c.intake,width:.60,reach:.20,groundSide:'back',station:true,stationSide:'back'};
  c.launcher={...c.launcher,turret:false,height:.709,muzzleForward:.08,mounts:[{forward:.025,side:0}],rate:2,angle:deg(55),minAngle:deg(30),maxAngle:deg(75)};
  c.placement={...c.placement!,enabled:true,maxLevel:2,reach:.45};
  c.climber={maxLevel:3,secondsPerLevel:2};
  return [{id:'hero-gadgeteer-9408',team:9408,name:'Gadgeteer',description:'Gadgeteer 9408: swerve with an over-the-bumper floor intake, four-bubble hopper into a roller shooter, elevator with a two-panel claw and a three-stage suction-pad climber. Speeds, rates, joint travel and playing mass are estimates.',source:'https://cad.onshape.com/documents/62596cdc81bb8ddb30be7a64/w/bca4094c412230aacf299609/e/e2ba57da6aec137f2ef4fe0b',config:normalizeHeroConfig(c)}];
}
