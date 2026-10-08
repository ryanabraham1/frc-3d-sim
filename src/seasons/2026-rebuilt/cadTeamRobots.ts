import type { TeamRobot } from '@engine/core/season';
import { box, bar, mat, drivebase, deployableIntake, fillBlock, hopperWalls, roller, registerRobotModel, type ModelKit } from '@engine/robot/models';
import { build, normalizeRebuiltConfig, setRebuiltAccuracy } from './config';
import { inch } from '@engine/units';
import { slidingHopper } from '@engine/robot/slidingHopper';

// User-supplied MAIN / VR26A CAD + TBA refs/{9470,6800}-2026/sheet.jpg.
// 9470: wide fixed drum, rear intake, clear side walls and white roof, raw silver/black.
// 6800: supplied wide-drum variant with linear rear intake and sliding hopper, black/gold.
// Valor's earlier binder describes a turret variant; this roster follows the supplied CAD.
// Frame 27 in square for both; rates 16 / 18 and speeds [EST]. Capacities are real-size FUEL packed into the CAD hopper:
// 9470 40 under the rigid rim plus 12 net stretch; 6800 31 under the rigid rim plus about 10 as its black net roof stretches (41) [EST].
// These individual builders are the lightweight fallback; loaded CAD replaces them.
registerRobotModel('ctrl-alt-defeat-9470',(k:ModelKit)=>{
  const db=drivebase(k),clear=mat(0xd9e1e8,{opacity:.22}),dark=mat(0x20252b);
  hopperWalls(k.visual,{x:-.03,length:.61,width:.63,y0:.17,height:.37,m:clear});
  if(!k.config.hopperExpansion)box(k.visual,.37,.006,.63,mat(0xe2e4e7),-.145,.55,0);
  for(const z of [-.31,.31])bar(k.visual,[.26,.14,z],[.26,.50,z],.028,k.mats.alu);
  const wheel=roller(k.visual,.052,.59,dark,.24765,.492823,0);
  const intake=deployableIntake(k,{reach:.20,rollers:2,frame:k.mats.alu,rollerMaterial:dark});
  const extension=slidingHopper(k,{wall:clear,frame:k.mats.alu,length:.22});
  const pile=fillBlock(k.visual,{x:-.03,y0:.17,length:.59,width:.61,height:.37,color:0xf2c200,capacity:k.config.hopperCapacity});
  return {replaces:['chassis','launcher','hopper','intakeRollers'],intakeAnchor:intake.tip,
    update(s){db.update(s);const deploy=s.enabled?1:0;intake.update(s,deploy);extension.set(deploy,s.fill);pile.set(s.fill);wheel.rotation.z+=s.enabled?45*s.dt:0;}};
});
registerRobotModel('downpour-6800',(k:ModelKit)=>{
  const db=drivebase(k),dark=mat(0x15191f),gold=mat(0xc79a30,{metal:.4});
  hopperWalls(k.visual,{x:-.10,length:.55,width:.65,y0:.19,height:.32,m:dark});
  for(const z of [-.32,.32]) {
    bar(k.visual,[.27,.15,z],[.27,.54,z],.032,gold);
    bar(k.visual,[.27,.54,z],[-.34,.51,z],.024,gold);
  }
  const wheel=roller(k.visual,.051,.61,dark,.26035,.474486,0);
  box(k.visual,.05,.025,.61,gold,.07,.59,0);
  const intake=deployableIntake(k,{reach:.23,rollers:4,frame:gold,rollerMaterial:dark});
  return {replaces:['chassis','launcher','hopper','intakeRollers'],intakeAnchor:intake.tip,
    update(s){db.update(s);intake.update(s,s.enabled?1:0);wheel.rotation.z+=s.enabled?45*s.dt:0;}};
});
function config(team:number,id:string,capacity:number,rate:number,height:number,net?:{startCount:number;fullHeight:number}) {
  const c=build({intake:'both',aim:'align',dumper:true,hopper:capacity,tall:false,rate,climb:0});
  c.teamNumber=team;c.model=id;c.frameLength=c.frameWidth=.6858;c.height=height;c.maxSpeed=4.7;
  if(team===9470)c.hopperCovered=true;
  if(net){c.hopperCovered=true;c.hopperExpansion={...net,area:team===9470?{cx:-.307,sx:.321,sz:.32}:{cx:-.295,sx:.32,sz:.325}};}
  c.launcher.exitSpan=.59;setRebuiltAccuracy(c,86);return normalizeRebuiltConfig(c);
}
export function cadRebuiltTeamRobots():TeamRobot[] {return [
  {id:'ctrl-alt-defeat-9470',team:9470,name:'Ctrl-Alt-Defeat',description:'9470. Complete supplied CAD with a wide drum shooter, clear hopper and sliding intake-side extension under a flexible net (40 FUEL below the rim, 52 with stretch) and its supplied intake and indexer. Capacity, rate and drive speed are simulator estimates.',source:'User supplied 9470-2026-MAIN.glb; https://www.thebluealliance.com/team/9470/2026',config:config(9470,'ctrl-alt-defeat-9470',52,16,.55,{startCount:40,fullHeight:inch(25.5)})},
  {id:'downpour-6800',team:6800,name:'Downpour',description:'6800 Valor. Supplied wide drum variant with an adjustable roller hood, translating intake and horizontally expanding hopper under a black net roof: 31 FUEL in the rigid hopper, 41 with the net stretched (past 31 it bulges above TRENCH height). Capacity, rate and drive speed are simulator estimates.',source:'User supplied VR26A-0000 Main.glb; https://www.chiefdelphi.com/t/frc-6800-valor-2026-robot-cad-release/520715',config:config(6800,'downpour-6800',41,18,.55,{startCount:31,fullHeight:inch(25.5)})},
];}
