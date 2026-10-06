import { expect, it } from 'vitest';
import * as THREE from 'three';
import { fillBlock, type RobotAnimState } from '../src/engine/robot/models';

const state = (): RobotAnimState => ({dt:1/60,time:0,enabled:true,intaking:false,firing:0,passing:false,aiming:false,hood:0,fill:0,climb:0,blocker:0,place:null,vx:0,vz:0,omega:0});
function pile() {
  const group = new THREE.Group();
  const fill = fillBlock(group, {x:0,y0:0.2,length:0.6,width:0.6,height:0.45,color:0xf2c200,capacity:32,ceiling:() => 0.65,inside:(x,z) => x < 0.15 || Math.abs(z) > 0.12});
  const mesh = group.children[0] as THREE.InstancedMesh;
  const step = mesh.userData.animateFuel as (s:RobotAnimState) => void;
  return {fill, mesh, step};
}
it('stirs with driving and feeding, settles, then stops uploading idle matrices', () => {
  const {fill,mesh,step} = pile(), s = state();
  fill.set(0.8);
  for(let i=0;i<180;i++) step(s);
  const rest = mesh.instanceMatrix.array.slice();
  const version = mesh.instanceMatrix.version;
  for(let i=0;i<120;i++) step(s);
  expect(mesh.instanceMatrix.version).toBe(version);
  s.vx=4;s.intaking=true;
  for(let i=0;i<12;i++) step(s);
  expect(Array.from(mesh.instanceMatrix.array)).not.toEqual(Array.from(rest));
  s.vx=0;s.intaking=false;
  for(let i=0;i<240;i++) step(s);
  const settled = mesh.instanceMatrix.version;
  for(let i=0;i<120;i++) step(s);
  expect(mesh.instanceMatrix.version).toBe(settled);
});
it('keeps incoming and agitated balls inside the roof and shaped footprint at bounded upload rate', () => {
  const {fill,mesh,step}=pile(), s=state();
  fill.set(0);fill.set(1);
  const matrix=new THREE.Matrix4(),pos=new THREE.Vector3(),scale=new THREE.Vector3(),rotation=new THREE.Quaternion();
  const version=mesh.instanceMatrix.version;
  for(let frame=0;frame<120;frame++) {
    s.vx=frame%2 ? 5 : -5;s.vz=frame%2 ? -5 : 5;s.omega=3;s.intaking=true;
    step(s);
    for(let i=0;i<mesh.count;i++) {
      mesh.getMatrixAt(i,matrix);matrix.decompose(pos,rotation,scale);
      expect(pos.y+0.075*scale.y).toBeLessThanOrEqual(0.650001);
      expect(Math.abs(pos.x)+0.075*scale.x).toBeLessThanOrEqual(0.300001);
      expect(Math.abs(pos.z)+0.075*scale.z).toBeLessThanOrEqual(0.300001);
      expect(pos.x<0.15 || Math.abs(pos.z)>0.12).toBe(true);
    }
  }
  expect(mesh.instanceMatrix.version-version).toBeLessThanOrEqual(60);
  fill.set(0);const empty=mesh.instanceMatrix.version;
  for(let i=0;i<120;i++) step(s);
  expect(mesh.count).toBe(0);
  expect(mesh.instanceMatrix.version).toBe(empty);
});

it('animates default and team 2026 hoppers through the robot render loop after optimization', async () => {
  const {default:RAPIER}=await import('@dimforge/rapier3d-compat');
  const {SEASONS}=await import('../src/seasons');
  const {HeadlessSim}=await import('../src/engine/testing/headless');
  const {cloneConfig}=await import('../src/engine/robot/config');
  await RAPIER.init();
  const season=SEASONS.find(s=>s.year===2026)!;
  for(const config of [season.robotDefaults,season.teamRobots!.find(t=>t.team===254)!.config]) {
    const sim=new HeadlessSim(season,RAPIER,{robot:cloneConfig(config),alliance:'blue',pose:{x:2,y:2,yaw:0}});
    try {
      const robot=sim.robot;
      robot.optimizeVisual();
      sim.load(20);robot.enabled=true;
      for(let frame=0;frame<180;frame++) robot.syncVisual(1/60);
      const mesh=robot.visual.getObjectByName('hopper-fuel-pile') as THREE.InstancedMesh;
      expect(mesh).toBeDefined();expect(mesh.count).toBeGreaterThan(0);
      const rest=mesh.instanceMatrix.array.slice();
      robot.body.setLinvel({x:4,y:0,z:0},true);
      for(let frame=0;frame<4;frame++) robot.syncVisual(1/60);
      expect(Array.from(mesh.instanceMatrix.array)).not.toEqual(Array.from(rest));
    } finally {sim.dispose();}
  }
});
