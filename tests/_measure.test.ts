import { it } from 'vitest';
import * as THREE from 'three';
it('measure', async () => {
  const {default:RAPIER}=await import('@dimforge/rapier3d-compat');
  const {SEASONS}=await import('../src/seasons');
  const {HeadlessSim}=await import('../src/engine/testing/headless');
  const {cloneConfig}=await import('../src/engine/robot/config');
  await RAPIER.init();
  const season=SEASONS.find(s=>s.year===2026)!;
  const list:any[]=[{n:'default',c:season.robotDefaults},...(season.robotPresets??[]).map((p:any)=>({n:'preset '+p.name,c:{...season.robotDefaults,...p.config}})),...season.teamRobots!.map((t:any)=>({n:'team '+t.team,c:t.config}))];
  const rows:string[]=[];
  for(const {n,c} of list){
    try{
    const sim=new HeadlessSim(season,RAPIER,{robot:cloneConfig(c),alliance:'blue',pose:{x:2,y:2,yaw:0}});
    const r=sim.robot; let max=0;
    let bin:any=null; r.visual.traverse((o:any)=>{ if(o.name==='hopper-fuel-pile'){ if(o.instanceMatrix.count>=max){max=o.instanceMatrix.count;bin=o.userData.fuelBin;} } }); const cc=r.config; const f=(v:number)=>v.toFixed(2); const env=`env L${f(cc.frameLength)} W${f(cc.frameWidth)} bt${f(cc.bumperTop)} H${f(cc.height)}`; const b=bin?`bin x${f(bin.x)} y0${f(bin.y0)} L${f(bin.length)} W${f(bin.width)} h${f(bin.height)} vol%=${Math.round(100*bin.length*bin.width*bin.height/(cc.frameLength*cc.frameWidth*(cc.height-cc.bumperTop)))}`:'nobin';
    rows.push(`${n}\tcap=${r.config.hopperCapacity}\t${env}\t${b}`);
    sim.dispose();}catch(e:any){rows.push(n+' ERR '+e.message)}
  }
  (await import('fs')).writeFileSync('/private/tmp/claude-501/-Users-ryanabraham-Downloads-frc-3d-sim/fc725793-08a5-425b-9999-634d3c84ab7f/scratchpad/m.txt',rows.join('\n'));
},120000);
