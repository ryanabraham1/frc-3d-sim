import { expect, it } from 'vitest';
import * as THREE from 'three';
import { FuelContacts } from '../src/engine/robot/fuelContacts';
import { fillBlock, type RobotAnimState } from '../src/engine/robot/models';
import { cadHopper } from '../src/engine/robot/cadHopper';
import { cloneConfig, DEFAULT_ROBOT } from '../src/engine/robot/config';

const state = (): RobotAnimState => ({dt:1/60,time:0,enabled:false,intaking:false,firing:0,passing:false,aiming:false,hood:0,fill:0,climb:0,blocker:0,place:null,vx:0,vz:0,omega:0});
function fixture() {
  const visual = new THREE.Group();
  const fill = fillBlock(visual,{x:0,y0:.1,length:.7,width:.7,height:.6,color:0xf2c200,capacity:8,exactFloor:true});
  const bin = visual.getObjectByName('hopper-fuel-pile') as THREE.InstancedMesh;
  const panel = new THREE.Mesh(new THREE.BoxGeometry(.7,.04,.7),new THREE.MeshStandardMaterial());
  panel.position.y=.24;visual.add(panel);
  return {visual,fill,bin,panel};
}
it('settles balls on the actual robot floor rather than passing through to fitted bin bounds', () => {
  const {visual,fill,bin}=fixture();
  bin.userData.bindFuelContacts(visual);
  bin.userData.receiveFuel(new THREE.Vector3(0,.5,0));fill.set(1/8);
  for(let i=0;i<300;i++)bin.userData.animateFuel(state());
  const p=new THREE.Vector3().setFromMatrixPosition(new THREE.Matrix4().fromArray(bin.instanceMatrix.array));
  expect(p.y).toBeGreaterThan(.328);expect(p.y).toBeLessThan(.34);
  const version=bin.instanceMatrix.version;
  for(let i=0;i<120;i++)bin.userData.animateFuel(state());
  expect(bin.instanceMatrix.version).toBe(version);
});
it('contacts follow moving CAD parts and cancel whole-chassis translation/rotation', () => {
  const {visual,bin,panel}=fixture();
  const contacts=new FuelContacts(visual,bin);contacts.sync();
  expect(contacts.sync()).toBe(false);
  visual.position.set(5,3,8);visual.rotation.y=1.2;
  expect(contacts.sync()).toBe(false);
  panel.position.y=.3;expect(contacts.sync()).toBe(true);
  const p=new Float32Array([0,.36,0]),v=new Float32Array([0,-1,0]);
  contacts.resolve(p,v,0,.075);
  expect(p[1]).toBeCloseTo(.3951,4);expect(v[1]).toBeGreaterThanOrEqual(0);
});
it('resolves an angled surface normal rather than treating CAD as a bounding box', () => {
  const {visual,bin,panel}=fixture();panel.rotation.z=.3;
  const contacts=new FuelContacts(visual,bin);contacts.sync();
  const centre=new THREE.Vector3(0,.05,0).applyMatrix4(panel.matrixWorld);
  const p=new Float32Array(centre.toArray()),v=new Float32Array([0,-1,0]);
  contacts.resolve(p,v,0,.075);
  const corrected=new THREE.Vector3().fromArray(p).applyMatrix4(panel.matrixWorld.clone().invert());
  expect(corrected.y).toBeCloseTo(.0951,4);
  expect(p[0]).toBeLessThan(centre.x);
});
it('expanding CAD hopper retains the same pile and positions through the old halfway switch', () => {
  const visual=new THREE.Group(),config=cloneConfig(DEFAULT_ROBOT);
  const hopper=cadHopper('limestone-1678',{visual,config,turret:new THREE.Group(),alliance:'blue',fp:{length:.7,width:.7},groundSide:-1,stationSide:-1,mats:{dark:new THREE.MeshStandardMaterial(),alu:new THREE.MeshStandardMaterial(),bumper:new THREE.MeshStandardMaterial()}},{});
  hopper.update(.4,.49,0);
  const mesh=visual.getObjectByName('hopper-fuel-pile') as THREE.InstancedMesh;
  const before=mesh.instanceMatrix.array.slice();
  hopper.update(.4,.51,0);
  expect(mesh.instanceMatrix.array).toEqual(before);
  const piles:THREE.Object3D[]=[];visual.traverse(o=>{if(o.name==='hopper-fuel-pile')piles.push(o);});
  expect(piles).toHaveLength(1);
  expect(mesh.userData.fuelBin.y0).toBe(.17);
  expect(mesh.userData.fuelBin.length).toBeCloseTo(.5125);
});

it('runs actual 2026 CAD piles through optimized Robot render animation', async () => {
  const {readFileSync}=await import('node:fs');
  const {decodeCadModel}=await import('../src/engine/robot/cadModels');
  const {default:RAPIER}=await import('@dimforge/rapier3d-compat');
  const {SEASONS}=await import('../src/seasons');
  const {HeadlessSim}=await import('../src/engine/testing/headless');
  await RAPIER.init();
  const season=SEASONS.find(s=>s.year===2026)!;
  for(const id of ['reblitz-2910','limestone-1678','toploader-604','mixtape-971']) {
    const bytes=readFileSync(`public/models/robots/2026/${id}.glb`);
    await decodeCadModel(id,bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
    const config=cloneConfig(season.teamRobots!.find(t=>t.id===id)!.config);
    const sim=new HeadlessSim(season,RAPIER,{robot:config,alliance:'blue',pose:{x:2,y:2,yaw:0}});
    sim.pool.bays.clear(); sim.robot.bay = null; // visual particle-pile path (multiplayer replicas, gallery)
    try {
      sim.robot.optimizeVisual();sim.load(15);sim.robot.enabled=true;
      for(let i=0;i<120;i++)sim.robot.syncVisual(1/60);
      const mesh=sim.robot.visual.getObjectByName('hopper-fuel-pile') as THREE.InstancedMesh;
      expect(mesh.count,id).toBeGreaterThan(0);
      expect(Array.from(mesh.instanceMatrix.array).every(Number.isFinite),id).toBe(true);
      const initial=mesh.instanceMatrix.array.slice();
      sim.robot.body.setLinvel({x:3,y:0,z:0},true);
      for(let i=0;i<15;i++)sim.robot.syncVisual(1/60);
      expect(Array.from(mesh.instanceMatrix.array),id).not.toEqual(Array.from(initial));
    } finally {sim.dispose();}
  }
},30000);

it('intake transport contacts CAD and hands off its actual position instead of teleporting through a wall', async () => {
  const {PieceFlow}=await import('../src/engine/robot/pieceFlow');
  const visual=new THREE.Group();
  const wall=new THREE.Mesh(new THREE.BoxGeometry(.04,1,1),new THREE.MeshStandardMaterial());
  wall.position.y=.5;visual.add(wall);
  let arrived:THREE.Vector3|undefined;
  const flow=new PieceFlow(visual,()=>new THREE.Mesh(new THREE.SphereGeometry(.075),new THREE.MeshStandardMaterial()),{
    intake:()=>[new THREE.Vector3(.3,.5,0)],arrive:p=>{arrived=p.clone();}
  },true,.075,new FuelContacts(visual,visual));
  flow.update(1/60,0,.1);
  flow.noteCapture({x:-.3,y:.5,z:0});
  for(let i=0;i<120;i++)flow.update(1/60,1,.1);
  expect(arrived).toBeDefined();expect(arrived!.x).toBeLessThan(-.09);
  expect(arrived!.y).toBeGreaterThan(.4);
  expect(flow.inTransit).toBe(0);flow.dispose();
});
