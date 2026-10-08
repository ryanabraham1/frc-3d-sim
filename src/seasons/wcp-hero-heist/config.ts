import type { RobotConfig } from '@engine/robot/config';
import { cloneConfig, DEFAULT_ROBOT, sanitizeConfig } from '@engine/robot/config';
import type { Alliance, FieldPose } from '@engine/coords';
import type { MatchPeriod } from '@engine/match/clock';
import type { RobotOption } from '@engine/core/season';
import { inch, lb, deg } from '@engine/units';
import { CLASS_LIMITS, AUTO_SECONDS, TELEOP_SECONDS, ENDGAME_SECONDS, SETTLE_SECONDS, CLIMB_CLEARANCE, TOWER_HEIGHT_LIMIT, PANEL_RADIUS, type HeroClass } from './constants';
import { mirrorX } from './geometry';

export const TIMELINE: MatchPeriod[] = [
  { id:'auto',label:'AUTO',duration:AUTO_SECONDS,mode:'auto' },
  { id:'teleop',label:'TELEOP',duration:TELEOP_SECONDS-ENDGAME_SECONDS,mode:'teleop',displayGroup:'teleop' },
  { id:'endgame',label:'ENDGAME',duration:ENDGAME_SECONDS,mode:'teleop',displayGroup:'teleop' },
  // G03: scores are final when everything stops or 5 s after the match, whichever is first (we always wait the 5 s).
  { id:'post',label:'FINAL SCORING',duration:SETTLE_SECONDS,mode:'disabled' },
];
export function heroClass(c: RobotConfig): HeroClass {
  const value=c.options?.heroClass;
  return value==='commander'||value==='mystic'?value:'gadgeteer';
}
/** Hardware storage of this build (≤ the class possession limits; a build may hold fewer than its class allows). */
export function storage(c: RobotConfig) {
  const limit=CLASS_LIMITS[heroClass(c)];
  const n=(value:unknown,max:number)=>typeof value==='number'&&Number.isFinite(value)?Math.max(0,Math.min(max,Math.round(value))):max;
  return { panels:n(c.options?.panelCapacity,limit.panels), bubbles:n(c.options?.bubbleCapacity,limit.bubbles) };
}
export function preloads(c: RobotConfig) {
  const s=storage(c);
  const n=(value:unknown,max:number)=>typeof value==='number'&&Number.isFinite(value)?Math.max(0,Math.min(max,Math.round(value))):0;
  return { panels:n(c.options?.panelPreload,Math.min(1,s.panels)), bubbles:n(c.preload,Math.min(3,s.bubbles)) };
}

/**
 * MAILBOX tiers a placement mechanism reaches, from the CAD heights (geometry.ts): 1 = DOWNTOWN horizontal and UPTOWN
 * diagonal slits (panel top ≈ 1.2 m), 2 = + low FOOTHILL baskets (panel lifted over a 0.78 m rim: top ≈ 1.4 m),
 * 3 = + high FOOTHILL baskets (rim 2.23 m: top ≈ 2.86 m, only within a COMMANDER's 120 in).
 */
export const MAILBOX_TIER_TOP = [0, 1.2, 0.78 + 2 * PANEL_RADIUS + 0.02, 2.23 + 2 * PANEL_RADIUS + 0.02];
export function maxMailboxTier(hero: HeroClass): number {
  const h=CLASS_LIMITS[hero].height;
  return hero==='mystic'?0:MAILBOX_TIER_TOP.reduce((best,top,k)=>k>0&&top<=h?k:best,0);
}
/** Highest climb whose hanging robot stays under the 78 in TOWER ZONE ceiling (G18): bottom clearance + height. */
export function legalClimbLevel(height: number): number {
  for (let level=3;level>=1;level--) if (CLIMB_CLEARANCE[level]+height<=TOWER_HEIGHT_LIMIT) return level;
  return 0;
}
/**
 * Simulator playing mass includes bumpers and battery; the class weight limits don't (FRC convention, R06) [EST
 * +28 lb for bumpers and battery].
 */
export const PLAYING_MASS_ALLOWANCE = lb(28);

/** Estimates are explicit design tuning, independent of the manual's class ceilings. */
export function heroRobotDefaults(): RobotConfig {
  const c=cloneConfig(DEFAULT_ROBOT);
  c.model=undefined;
  c.frameLength=c.frameWidth=inch(27);
  c.height=inch(29); c.mass=lb(110);
  c.bumperBottom=inch(.75); c.bumperTop=inch(5.75);
  c.maxSpeed=4.2;c.maxAccel=7.5;
  c.hopperCapacity=3;c.preload=3;
  // Floor intake opposite the launcher/lift (CLAUDE.md); the station funnel catches pieces from the chute and slide.
  c.intake={enabled:true,width:inch(24),reach:inch(7),maxHeight:inch(8),ground:true,groundSide:'back',station:true,stationSide:'back',primary:true,secondary:true};
  c.launcher={...c.launcher,enabled:true,height:inch(26),turret:false,angle:deg(40),minAngle:deg(15),maxAngle:deg(70),minSpeed:2,maxSpeed:9.5,rate:2,spread:.008,speedError:.012};
  c.aimAssist='full';c.autoAlign=true;
  c.climber={maxLevel:2,secondsPerLevel:2.2};
  c.placement={enabled:true,maxLevel:2,liftSpeed:1.2,reach:inch(18),cycleSeconds:.8,harvestSeconds:.5,scoreSide:'front'};
  c.options={heroClass:'gadgeteer',archetype:'gadgeteer-hybrid',panelCapacity:1,bubbleCapacity:3,panelPreload:1,placeAlign:true};
  return normalizeHeroConfig(c);
}

export function normalizeHeroConfig(config: RobotConfig): RobotConfig {
  const hero=heroClass(config),limit=CLASS_LIMITS[hero];
  const c=sanitizeConfig(config,limit.startHeight,limit.perimeter);
  c.options={...c.options,heroClass:hero};
  const s=storage(c);
  c.options.panelCapacity=s.panels;c.options.bubbleCapacity=s.bubbles;
  c.options.placeAlign=c.options.placeAlign!==false;
  c.intake.primary=s.bubbles>0;c.intake.secondary=s.panels>0;
  c.intake.enabled=s.panels+s.bubbles>0 && (c.intake.ground!==false||!!c.intake.station);
  // CLAUDE.md default is a back intake; a real team build that intakes and shoots on the same end sets options.intakeSide='front'.
  c.intake.groundSide=c.options.intakeSide==='front'?'front':'back';c.intake.stationSide='back';
  c.launcher.enabled=s.bubbles>0;
  if(!c.launcher.enabled){c.launcher.turret=false;c.autoAlign=false;}
  const tier=Math.min(maxMailboxTier(hero),Math.max(1,Math.round(c.placement?.maxLevel??1)));
  c.placement={...c.placement,enabled:s.panels>0,maxLevel:s.panels>0?tier:0,liftSpeed:c.placement?.liftSpeed??1.2,reach:Math.min(inch(18),c.placement?.reach??inch(18)),cycleSeconds:c.placement?.cycleSeconds??.8,harvestSeconds:c.placement?.harvestSeconds??.5,scoreSide:'front'};
  // Typed inventory lives in the rules; the generic hopper holds SPEECH BUBBLES only.
  delete c.hopperExpansion;delete c.shotBlocker;
  c.hopperCapacity=s.bubbles;
  c.mass=Math.min(c.mass,limit.mass+PLAYING_MASS_ALLOWANCE);
  const preload=preloads(c);
  c.preload=preload.bubbles;c.options.panelPreload=preload.panels;
  c.climber.maxLevel=Math.round(Math.min(legalClimbLevel(c.height),Math.max(0,c.climber.maxLevel)));
  c.model=`hero-${String(c.options.archetype??hero)}`;
  return c;
}

export function heroRobotPresets() {
  const make=(id:string,label:string,description:string,hero:HeroClass,change:(c:RobotConfig)=>void)=>{
    const c=heroRobotDefaults();c.options={...c.options,heroClass:hero,archetype:id,panelCapacity:CLASS_LIMITS[hero].panels,bubbleCapacity:CLASS_LIMITS[hero].bubbles};
    c.preload=hero==='commander'?0:3;c.options.panelPreload=hero==='mystic'?0:1;
    c.placement!.maxLevel=maxMailboxTier(hero);
    change(c);return {id,label,description,config:normalizeHeroConfig(c)};
  };
  return [
    make('gadgeteer-hybrid','Gadgeteer · dual mechanisms','Separate panel cradle (reaches the low FOOTHILL baskets) and a 3-ball feeder; claims a district with a panel, then farms it with bubbles. Like 2019 hatch + cargo robots.', 'gadgeteer',c=>{c.maxSpeed=4.2;c.options!.panelCapacity=1;c.options!.bubbleCapacity=3;c.climber.maxLevel=3;}),
    make('commander-roller','Commander · panel magazine','Floor and station panel rollers, a three-panel magazine and a tall lift that reaches every MAILBOX including the high FOOTHILL baskets. Too tall to climb above LOW.', 'commander',c=>{c.height=inch(46);c.mass=lb(145);c.maxSpeed=3.8;c.placement!.cycleSeconds=.9;c.climber.maxLevel=1;}),
    make('commander-simple','Commander · station gripper','One panel from the human player slide, a short lift for the DOWNTOWN and UPTOWN slits only. Simple hatch-style ownership specialist with a high climb.', 'commander',c=>{c.height=inch(30);c.mass=lb(118);c.maxSpeed=4.6;c.intake.ground=false;c.options!.panelCapacity=1;c.placement!.maxLevel=1;c.placement!.cycleSeconds=.6;c.climber.maxLevel=3;}),
    make('mystic-turret','Mystic · turret shooter','Six-ball hopper, floor and chute intake, adjustable hood and turret: shoots on the move into any CITY BLOCK in range. Like 2020/2022 turret shooters.', 'mystic',c=>{c.height=inch(39);c.mass=lb(124);c.maxSpeed=4.4;c.launcher.turret=true;c.launcher.height=inch(34);c.launcher.rate=4;c.climber.maxLevel=2;}),
    make('mystic-fixed','Mystic · chassis shooter','Four-ball hopper and a fixed hood aimed by turning the chassis; fewer good shooting spots, but compact enough for a HIGH climb.', 'mystic',c=>{c.height=inch(28);c.mass=lb(112);c.maxSpeed=4.8;c.options!.bubbleCapacity=4;c.launcher.minAngle=c.launcher.maxAngle=c.launcher.angle=deg(45);c.launcher.rate=2.5;c.climber.maxLevel=3;}),
    make('gadgeteer-flex','Gadgeteer · shared tool','One shared intake and end effector: two panels OR four bubbles, never mixed, so it must empty before switching. Low baskets and slits; low climb.', 'gadgeteer',c=>{c.height=inch(28);c.mass=lb(112);c.maxSpeed=4.5;c.options!.sharedTool=true;c.options!.panelCapacity=2;c.options!.bubbleCapacity=4;c.placement!.cycleSeconds=1.1;c.options!.panelPreload=0;c.climber.maxLevel=1;}),
  ];
}

const opt=(id:string,label:string,choices:[string,string][],get:(c:RobotConfig)=>string,set:(c:RobotConfig,v:string)=>void,hint?:string):RobotOption=>({id,label,hint,choices:choices.map(([id,label])=>({id,label})),get,set(c,v){set(c,v);Object.assign(c,normalizeHeroConfig(c));}});
export const heroRobotOptions: RobotOption[] = [
  opt('class','Hero class',[['commander','Commander'],['mystic','Mystic'],['gadgeteer','Gadgeteer']],heroClass,(c,v)=>{const h=v as HeroClass;c.options={...c.options,heroClass:h,panelCapacity:CLASS_LIMITS[h].panels,bubbleCapacity:CLASS_LIMITS[h].bubbles,archetype:h};c.placement={...c.placement!,maxLevel:maxMailboxTier(h)};},'Declared before the match; sets size, height and possession limits (manual p. 18).'),
  opt('intake','Piece collection',[['both','Floor + station'],['station','Station only']],c=>c.intake.ground===false?'station':'both',(c,v)=>{c.intake.ground=v==='both';c.intake.station=true;}),
  opt('aim','Bubble aiming',[['align','Chassis assist'],['turret','Turret'],['manual','Manual']],c=>c.launcher.turret?'turret':c.autoAlign?'align':'manual',(c,v)=>{c.launcher.turret=v==='turret';c.autoAlign=v==='align';}),
  opt('reach','Mailbox reach',[['1','Slits'],['2','+ Low baskets'],['3','+ High baskets']],c=>String(c.placement?.maxLevel??0),(c,v)=>{c.placement={...c.placement!,maxLevel:Number(v)};},'Limited by class height: Gadgeteers reach the low FOOTHILL baskets, only Commanders the high ones.'),
  opt('placeAlign','Panel auto-align',[['on','Vision assist'],['off','Driver']],c=>c.options?.placeAlign===false?'off':'on',(c,v)=>{c.options={...c.options,placeAlign:v==='on'};}),
  opt('panelPreload','Panel preload',[['0','None'],['1','One panel']],c=>String(preloads(c).panels),(c,v)=>{c.options={...c.options,panelPreload:Number(v)};}),
  opt('climb','Tower climber',[['0','None'],['1','Low'],['2','Medium'],['3','High']],c=>String(c.climber.maxLevel),(c,v)=>{c.climber.maxLevel=Number(v);},'A climb must keep the whole robot under 78 in (G18), so tall robots are limited to LOW.'),
];

/** Driver station y positions (squad wall, CAD glass panels at cadY -1.829 / 0 / 1.829). */
const STATION_Y = [2.286, 4.1148, 5.9436];
/** G01: start fully inside your TOWER ZONE, under the truss, facing the center. */
export function startPose(a: Alliance, station: number): FieldPose {
  const y=[3.2,4.9,6.6][Math.min(3,Math.max(1,station))-1];
  return { x:mirrorX(a,4.115), y, yaw:a==='blue'?0:Math.PI };
}
export function driverEye(a: Alliance, station: number) {
  return { x:mirrorX(a,-0.9), y:STATION_Y[Math.min(3,Math.max(1,station))-1], z:1.75, yaw:a==='blue'?0:Math.PI };
}
