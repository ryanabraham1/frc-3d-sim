import {it} from 'vitest';
import {writeFileSync} from 'node:fs';
import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import {loadCad2026} from './helpers/cad2026';
import {getSeason} from '../src/seasons';
import {cloneConfig} from '../src/engine/robot/config';
import {HeadlessSim} from '../src/engine/testing/headless';
import {FuelContacts} from '../src/engine/robot/fuelContacts';
it('inspect',async()=>{await RAPIER.init();await loadCad2026();const season=getSeason('2026-rebuilt'),report:unknown[]=[];
for(const id of ['aimbot-3256','reblitz-2910','limestone-1678','ripcurrent-4414']){
const config=cloneConfig(season.teamRobots!.find(t=>t.id===id)!.config),sim=new HeadlessSim(season,RAPIER,{robot:config,alliance:'blue',pose:{x:2,y:2,yaw:0}});const r=sim.robot;r.detachPool(sim.pool);r.enabled=true;r.hopperRaised=true;r.held.length=config.hopperCapacity;
for(let i=0;i<240;i++)r.syncVisual(1/60);const bins:unknown[]=[];r.visual.updateMatrixWorld(true);
r.visual.traverse(o=>{const surface=o.userData.fuelSurface?.();if(!surface)return;const contacts=new FuelContacts(r.visual,o,false,true);contacts.sync();const probe=new Float32Array(surface.positions),v=new Float32Array(probe.length);let penetration=0;for(let i=0;i<surface.count;i++){const j=i*3,p=new THREE.Vector3().fromArray(probe,j);contacts.resolve(probe,v,j,surface.radius*.94);penetration=Math.max(penetration,p.distanceTo(new THREE.Vector3().fromArray(probe,j)));}bins.push({slots:o.userData.fuelSlots,count:surface.count,spill:o.userData.fuelSpillCap,bin:o.userData.fuelBin,maxPenetration:penetration});});
const cad=r.visual.getObjectByName('cad-'+id);const boxes:unknown[]=[];if(cad)for(const o of cad.children){const b=new THREE.Box3().setFromObject(o).applyMatrix4(r.visual.matrixWorld.clone().invert());boxes.push([o.name,b.min.toArray(),b.max.toArray()]);}report.push({id,bins,boxes});sim.dispose();}
writeFileSync('/tmp/frc-resume-backup/pile-report.json',JSON.stringify(report,null,2));},120000);
