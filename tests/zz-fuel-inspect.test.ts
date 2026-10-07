import {it} from 'vitest';
import {readFileSync,appendFileSync,writeFileSync} from 'node:fs';
import * as THREE from 'three';
import {decodeCadModel,cadRobotModelBuilder} from '../src/engine/robot/cadModels';
import {cloneConfig} from '../src/engine/robot/config';
import {SEASONS} from '../src/seasons';
it('inspect',async()=>{
writeFileSync('/tmp/fuel-inspect.txt',''); const log=(...v:unknown[])=>appendFileSync('/tmp/fuel-inspect.txt',JSON.stringify(v)+'\n');
 for(const id of ['limestone-1678','reblitz-2910','toploader-604','rubble-581','mixtape-971','simbot-tim-1114','downpour-6800','ctrl-alt-defeat-9470']) {log(id); const bytes=readFileSync(`public/models/robots/2026/${id}.glb`);await decodeCadModel(id,bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
 const config=cloneConfig(SEASONS.find(s=>s.year===2026)!.teamRobots!.find(t=>t.id===id)!.config),visual=new THREE.Group();
 const model=cadRobotModelBuilder(id)!({config,visual,turret:new THREE.Group(),alliance:'blue',fp:{length:.7,width:.7},groundSide:-1,stationSide:-1,mats:{dark:new THREE.MeshStandardMaterial(),alu:new THREE.MeshStandardMaterial(),bumper:new THREE.MeshStandardMaterial()}});
 for(let i=0;i<120;i++)model.update({dt:1/60,time:0,enabled:true,intaking:true,firing:0,passing:false,aiming:false,hood:.9,fill:1,climb:0,blocker:0,place:null,vx:0,vz:0,omega:0});
 log('flow',model.flow?.intake?.(), 'capacity',config.hopperCapacity);
 const root=visual.getObjectByName(`cad-${id}`)!;root.updateMatrixWorld(true);
 if(id==='limestone-1678'){const rc=new THREE.Raycaster();const hf=root.getObjectByName('hopper-front')!;for(const x of [-.58,-.53,-.48,-.4,-.32,-.26]){rc.set(new THREE.Vector3(x,1,0),new THREE.Vector3(0,-1,0));log('ramp',x,rc.intersectObject(hf,true).map(h=>({y:h.point.y,name:h.object.name})));}}
 for(const o of root.children)log('assembly',o.name,new THREE.Box3().setFromObject(o).min.toArray(),new THREE.Box3().setFromObject(o).max.toArray());
 for(const name of ['hopper','hopper-slide','hopper-front','hopper-lift','intake','floor','roller-floor','feeder','serializer','turret-left','turret-right']){
 const o=root.getObjectByName(name);if(o)log(name,new THREE.Box3().setFromObject(o).min.toArray(),new THREE.Box3().setFromObject(o).max.toArray());
 }
 visual.traverse(o=>{if(o.userData.fuelSlots)log('pile',o.userData.fuelSlots,o.userData.fuelBin);});
}
});
