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
it('4414 net follows local ball pressure instead of inflating empty pockets from the held count', () => {
  const sim = make(4414), r = sim.robot, c = r.config;
  sim.load(c.hopperCapacity);
  const contact = {x: -.12, y: c.height + .14, z: 0};
  r.bay!.forEachLocal = cb => cb(contact.x, contact.y, contact.z);
  for (let i = 0; i < 120; i++) r.syncVisual(1/60);
  const net = r.visual.getObjectByName('stretching-hopper-net') as THREE.LineSegments;
  const p = net.geometry.getAttribute('position');
  let near = 0, far = 0;
  for (let i = 0; i < p.count; i++) {
    const distance = Math.hypot(p.getX(i)-contact.x, p.getZ(i)-contact.z);
    if (distance < .07) near = Math.max(near, p.getY(i));
    if (distance > .4) far = Math.max(far, p.getY(i));
  }
  expect(near).toBeGreaterThan(c.height + .08);
  expect(far).toBeLessThanOrEqual(c.height + .001);
  // One contact must fall continuously toward the rim. Extending the sphere's equator outside its radius
  // created vertical steps at the tension cutoff, visible as spikes around a full load.
  for(let i=0;i<p.count;i+=2) {
    const distance=Math.hypot(p.getX(i)-p.getX(i+1),p.getZ(i)-p.getZ(i+1));
    if(distance>.0001&&distance<.035)expect(Math.abs(p.getY(i)-p.getY(i+1))).toBeLessThan(.065);
  }
  r.bay!.forEachLocal = () => {};
  for (let i = 0; i < 120; i++) r.syncVisual(1/60);
  for (let i = 0; i < p.count; i++) expect(p.getY(i)).toBeLessThanOrEqual(c.height + .001);
});
for(const team of [254,581,6800,9470,1323,4414])it(`${team}: a full physical load pushes its net above the rim and conserves the balls`,()=>{
  const sim=make(team),r=sim.robot,c=r.config;
  r.syncVisual(.05);sim.load(20); // a part load: the pile stays in the rigid hopper
  for(let i=0;i<60;i++){sim.step();r.syncVisual(1/60);}
  const slack=r.visual.getObjectByName('stretching-hopper-net') as THREE.LineSegments;
  const slackPoints=slack.geometry.getAttribute('position');
  for(let i=0;i<slackPoints.count;i++)expect(slackPoints.getY(i)).toBeLessThanOrEqual(c.height+.025); // slack: resting at the rim (heaped balls just touch it)
  sim.load(c.hopperCapacity-20);
  const ids=r.held.slice();
  for(let i=0;i<120;i++){sim.step();r.syncVisual(1/60);}
  const net=r.visual.getObjectByName('stretching-hopper-net') as THREE.LineSegments;
  const p=net.geometry.getAttribute('position'),grid=net.userData.grid as number[];
  let top=0;
  for(let i=0;i<p.count;i++){
    top=Math.max(top,p.getY(i));
    if(Math.abs(grid[i*3])===1||Math.abs(grid[i*3+2])===1)expect(p.getY(i)).toBeCloseTo(c.height,3);
  }
  expect(top).toBeGreaterThan(c.height+.04);
  expect(top).toBeLessThanOrEqual(.762+.006); // the dome's middle may peak past fullHeight, never past the 30 in limit
  expect(r.held).toEqual(ids);
  // Gallery/replica piles must agree visibly with the real match load, using the same conserved count.
  r.detachPool(sim.pool);
  for(let i=0;i<120;i++)r.syncVisual(1/60);
  let previewTop=0,drawn=0;
  for(let i=0;i<p.count;i++)previewTop=Math.max(previewTop,p.getY(i));
  r.visual.traverse(o=>{const surface=o.userData.fuelSurface?.();if(surface)drawn+=surface.count;});
  expect(drawn).toBe(c.hopperCapacity);
  // Preview FUEL packs at 0.9 of its radius (foam squish), so a load sized for full-radius packing may sit under the rim.
  expect(previewTop).toBeGreaterThanOrEqual(c.height-.001);


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

for(const team of [4414,1690])it(`${team}: a full hopper leaves the shooter envelope clear in match and preview`,()=>{
  const sim=make(team),r=sim.robot;sim.load(r.config.hopperCapacity);
  for(let i=0;i<120;i++){sim.step();r.syncVisual(1/60);}
  const envelopes=r.visual.userData.fuelKeepouts as {x:number;z:number;radius:number;bottom:number;top:number}[];
  const check=(x:number,y:number,z:number,radius:number)=>{
    for(const e of envelopes)if(y+radius>e.bottom+.002&&y-radius<e.top-.002)
      expect(Math.hypot(x-e.x,z-e.z)).toBeGreaterThanOrEqual(e.radius+radius-.003);
  };
  r.bay!.forEachLocal((x,y,z)=>check(x,y,z,sim.pool.colliderRadius*(r.config.hopperExpansion?1:.93)));
  expect(r.held.length).toBe(r.config.hopperCapacity);
  r.detachPool(sim.pool);
  for(let i=0;i<120;i++)r.syncVisual(1/60);
  let drawn=0;
  r.visual.traverse(o=>{const surface=o.userData.fuelSurface?.();if(!surface)return;
    for(let i=0;i<surface.count;i++){
      const p=r.visual.worldToLocal(o.localToWorld(new THREE.Vector3().fromArray(surface.positions,i*3)));
      check(p.x,p.y,p.z,surface.radius*.94);drawn++;
    }
  });
  expect(drawn).toBe(r.config.hopperCapacity);
});

it('4946 retains its full load inside the curved hopper wall in match and preview',()=>{
  const sim=make(4946),r=sim.robot;sim.load(r.config.hopperCapacity);
  const outline=r.visual.userData.fuelOutline as [number,number][];
  expect(outline.length).toBeGreaterThan(12);
  let area=0;for(let i=0;i<outline.length;i++){const a=outline[i],b=outline[(i+1)%outline.length];area+=a[0]*b[1]-b[0]*a[1];}
  const sign=area>0?1:-1;
  const check=(x:number,z:number,radius:number)=>{
    for(let i=0;i<outline.length;i++){
      const a=outline[i],b=outline[(i+1)%outline.length],dx=b[0]-a[0],dz=b[1]-a[1],length=Math.hypot(dx,dz);
      if(length<1e-8)continue;
      expect((-(x-a[0])*dz+(z-a[1])*dx)/length*sign).toBeGreaterThan(radius-.004);
    }
  };
  for(let i=0;i<120;i++){sim.step();r.syncVisual(1/60);}
  r.bay!.forEachLocal((x,_y,z)=>check(x,z,sim.pool.colliderRadius*.93));
  expect(r.held.length).toBe(r.config.hopperCapacity);
  r.detachPool(sim.pool);for(let i=0;i<120;i++)r.syncVisual(1/60);
  let drawn=0;r.visual.traverse(o=>{const surface=o.userData.fuelSurface?.();if(!surface)return;
    for(let i=0;i<surface.count;i++){const p=r.visual.worldToLocal(o.localToWorld(new THREE.Vector3().fromArray(surface.positions,i*3)));check(p.x,p.z,surface.radius*.96);drawn++;}
  });expect(drawn).toBe(r.config.hopperCapacity);
});
