import {it} from 'vitest';
import {readFileSync,writeFileSync} from 'node:fs';
import * as THREE from 'three';
import {CAD_MODEL_IDS,decodeCadModel} from '../src/engine/robot/cadModels';
import {cloneConfig} from '../src/engine/robot/config';
import {SEASONS} from '../src/seasons';
import {HeadlessSim} from '../src/engine/testing/headless';
import RAPIER from '@dimforge/rapier3d-compat';
import {IDLE_COMMAND} from '../src/engine/robot/robot';
it('all roster diagnostics',async()=>{
 await RAPIER.init();
 for(const id of [...CAD_MODEL_IDS,'intake-581-donor','shooter-581-donor','rotor-604-donor']){const b=readFileSync(`public/models/robots/2026/${id}.glb`);await decodeCadModel(id,b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength));}
 const season=SEASONS.find(s=>s.year===2026)!,report:unknown[]=[];
 for(const t of season.teamRobots!){
  const sim=new HeadlessSim(season,RAPIER,{robot:cloneConfig(t.config),alliance:'blue',pose:{x:0,y:0,yaw:0}}),r=sim.robot;
  r.optimizeVisual();r.enabled=true;r.lastCommand={...IDLE_COMMAND,intake:true};
  r.enablePieceFlow(()=>new THREE.Mesh(new THREE.SphereGeometry(.075),new THREE.MeshStandardMaterial()),true);
  r.syncVisual(1/60);
  const failures: unknown[] = [];
  for(let f=0;f<t.config.hopperCapacity*10+120;f++){
   if(f%10===0&&r.held.length<t.config.hopperCapacity){const n=r.held.length;const lane=[-.15,0,.15][n%3];const L=r.footprint.length;r.visual.updateMatrixWorld(true);r.noteCapture(r.visual.localToWorld(new THREE.Vector3(-L/2-.12,.075,lane)));r.held.push(-1);}
   r.syncVisual(1/60);
   const flow = (r as any).flow;
   for (const token of flow.live) if(token.kind==='intake' && token.t>token.dur+.76) failures.push({held:r.held.length,p:token.obj.position.toArray(),end:token.pts.at(-1).toArray()});
  }
  const bins:unknown[]=[];r.visual.traverse(o=>{if(o instanceof THREE.InstancedMesh&&o.userData.fuelBin){const b=new THREE.Box3(),p=new THREE.Vector3(),m=new THREE.Matrix4();for(let i=0;i<o.count;i++){o.getMatrixAt(i,m);p.setFromMatrixPosition(m);b.expandByPoint(p);}bins.push({count:o.count,slots:o.userData.fuelSlots,bin:o.userData.fuelBin,min:b.min.toArray(),max:b.max.toArray()});}});
  report.push({id:t.id,capacity:t.config.hopperCapacity,held:r.held.length,audit:r.fuelTransportAudit,failures,bins});sim.dispose();
 }
 writeFileSync('/tmp/fuel-roster.json',JSON.stringify(report,null,2));
},120000);
