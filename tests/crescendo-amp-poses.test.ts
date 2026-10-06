import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import * as THREE from 'three';
import {decodeCadModel,cadRobotModelBuilder} from '../src/engine/robot/cadModels';
import {SEASONS} from '../src/seasons';
import {cloneConfig} from '../src/engine/robot/config';
import type {RobotAnimState} from '../src/engine/robot/models';
const idle: RobotAnimState={dt:0,time:0,enabled:true,intaking:false,firing:0,passing:false,amp:false,aiming:false,hood:.7,fill:0,climb:0,blocker:0,place:null,vx:0,vz:0,omega:0};
describe('2024 CAD AMP poses',()=>{
 for(const id of ['twister-118','gold-rush-27','doppler-1690','domotron-604','typhoon-2910']) it(`${id} has a separate connected AMP sweep`,async()=>{
  const bytes=readFileSync(`public/models/robots/2024/${id}.glb`);await decodeCadModel(id,bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
  const config=cloneConfig(SEASONS.find(s=>s.year===2024)!.teamRobots!.find(r=>r.id===id)!.config);
  const visual=new THREE.Group(),turret=new THREE.Group();visual.add(turret);
  const model=cadRobotModelBuilder(id)!({config,visual,turret,alliance:'blue',fp:{length:config.frameLength,width:config.frameWidth},groundSide:config.intake.groundSide==='front'?1:-1,stationSide:-1,mats:{dark:new THREE.MeshStandardMaterial(),alu:new THREE.MeshStandardMaterial(),bumper:new THREE.MeshStandardMaterial()}});
  const root=visual.getObjectByName(`cad-${id}`)!;
  const amp=root.getObjectByName(id==='twister-118'?'cad-diverter-pivot':'cad-amp-pivot');
  model.update(idle);const rest=amp?.rotation.z;
  model.update({...idle,passing:true,amp:false});expect(amp?.rotation.z).toBe(rest);
  visual.updateMatrixWorld(true);
  const hinge=amp?.getWorldPosition(new THREE.Vector3());
  if(id==='twister-118')expect(hinge!.toArray()).toEqual([-.118821,.455295,0]);
  if(id==='gold-rush-27')expect(hinge!.toArray()).toEqual([.2667,.6477,0]);
  const fixed=root.getObjectByName('amp-base');
  const fixedMatrix=fixed?.matrixWorld.clone();
  if(id==='gold-rush-27')expect(fixed).toBeTruthy();
  for(const yaw of [-Math.PI/2,0,Math.PI/2]){
   turret.rotation.y=yaw;
   for(const deployed of [true,false])for(let i=0;i<12;i++){
    model.update({...idle,dt:.05,amp:deployed});visual.updateMatrixWorld(true);
    const bounds=new THREE.Box3().setFromObject(root,true);
    expect(bounds.min.y).toBeGreaterThan(-.035);expect(bounds.max.y).toBeLessThan(2);
    if(fixed)expect(fixed.matrixWorld.equals(fixedMatrix!)).toBe(true);
    if(amp && id!=='twister-118')expect(amp.getWorldPosition(new THREE.Vector3()).distanceTo(hinge!)).toBeLessThan(1e-8);
   }
  }
  model.update({...idle,amp:true});
  if(amp)expect(amp.rotation.z).not.toBe(rest);
  else expect(root.getObjectByName('cad-shooter-pivot')!.rotation.z).not.toBe(0);
 });
});
