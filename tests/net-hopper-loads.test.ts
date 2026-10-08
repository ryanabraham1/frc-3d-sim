import {readFileSync} from 'node:fs';
import {afterEach,beforeAll,expect,it} from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import {SEASONS} from '../src/seasons';
import {HeadlessSim} from '../src/engine/testing/headless';
import {cloneConfig} from '../src/engine/robot/config';
import {CAD_MODEL_IDS,decodeCadModel,setCadModelsEnabled} from '../src/engine/robot/cadModels';
const season=SEASONS.find(s=>s.year===2026)!;
const sims:HeadlessSim[]=[];
beforeAll(async()=>{
  await RAPIER.init();
  for(const id of [...CAD_MODEL_IDS,'intake-581-donor','shooter-581-donor','rotor-604-donor']){
    const bytes=readFileSync(`public/models/robots/2026/${id}.glb`);
    await decodeCadModel(id,bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
  }
  setCadModelsEnabled(true);
});
afterEach(()=>{for(const sim of sims.splice(0))sim.dispose();});
function make(team:number){
  const c=cloneConfig(season.teamRobots!.find(t=>t.team===team)!.config);
  const sim=new HeadlessSim(season,RAPIER,{robot:c,alliance:'blue',pose:{x:2,y:2,yaw:0}});
  sims.push(sim);return sim;
}
for(const team of [254,581,6800,9470,1323,4414])it(`${team}: a full physical load pushes its net above the rim and conserves the balls`,()=>{
  const sim=make(team),r=sim.robot,c=r.config;
  r.syncVisual(.05);sim.load(c.hopperExpansion!.startCount);
  for(let i=0;i<60;i++){sim.step();r.syncVisual(1/60);}
  const slack=r.visual.getObjectByName('stretching-hopper-net') as THREE.LineSegments;
  const slackPoints=slack.geometry.getAttribute('position');
  for(let i=0;i<slackPoints.count;i++)expect(slackPoints.getY(i)).toBeLessThanOrEqual(c.height+.001);
  sim.load(c.hopperCapacity-c.hopperExpansion!.startCount);
  const ids=r.held.slice();
  for(let i=0;i<120;i++){sim.step();r.syncVisual(1/60);}
  const net=r.visual.getObjectByName('stretching-hopper-net') as THREE.LineSegments;
  const p=net.geometry.getAttribute('position'),grid=net.userData.grid as number[];
  let top=0;
  for(let i=0;i<p.count;i++){
    top=Math.max(top,p.getY(i));
    if(Math.abs(grid[i*3])===1||Math.abs(grid[i*3+2])===1)expect(p.getY(i)).toBeCloseTo(c.height,3);
  }
  expect(top).toBeGreaterThan(c.height+.06);
  expect(top).toBeLessThanOrEqual(c.hopperExpansion!.fullHeight+.001);
  expect(r.held).toEqual(ids);
  // Gallery/replica piles must agree visibly with the real match load, using the same conserved count.
  r.detachPool(sim.pool);
  for(let i=0;i<120;i++)r.syncVisual(1/60);
  let previewTop=0,drawn=0;
  for(let i=0;i<p.count;i++)previewTop=Math.max(previewTop,p.getY(i));
  r.visual.traverse(o=>{const surface=o.userData.fuelSurface?.();if(surface)drawn+=surface.count;});
  expect(drawn).toBe(c.hopperCapacity);
  expect(previewTop).toBeGreaterThan(c.height+.045);


});
it('604 captures from the carpet even while its intake starts folded',()=>{
  const sim=make(604),r=sim.robot;
  r.enabled=false;r.syncVisual(.05);
  const path=r.intakePath(new THREE.Vector3(-.65,.075,0));
  expect(Math.max(...path.map(p=>p.y))).toBeLessThan(.36);
  const idx=sim.pool.indices('reserve')[0];
  const from=r.visual.localToWorld(new THREE.Vector3(-.60,.075,0));
  sim.pool.placeWorld(idx,from,new THREE.Vector3());
  sim.pool.hold(idx,r.id);r.held.push(idx);
  for(let i=0;i<120;i++){
    sim.step();r.syncVisual(1/60);
    const pos=r.visual.worldToLocal(new THREE.Vector3().copy(sim.pool.bodies[idx].translation()));
    expect(pos.y).toBeLessThan(r.config.height);
  }
  expect(r.held).toEqual([idx]);
  const pos=r.visual.worldToLocal(new THREE.Vector3().copy(sim.pool.bodies[idx].translation()));
  const cavity=r.fuelCavity()!;
  expect(pos.x).toBeGreaterThan(cavity.min.x);
  expect(pos.x).toBeLessThan(cavity.max.x);
  expect(pos.y).toBeLessThan(cavity.max.y-sim.pool.colliderRadius*.8);
});
