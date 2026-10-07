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
  for(let i=0;i<360;i++) step(s);
  const rest = mesh.instanceMatrix.array.slice();
  const version = mesh.instanceMatrix.version;
  for(let i=0;i<120;i++) step(s);
  expect(mesh.instanceMatrix.version).toBe(version);
  s.vx=4;s.intaking=true;
  for(let i=0;i<12;i++) step(s);
  expect(Array.from(mesh.instanceMatrix.array)).not.toEqual(Array.from(rest));
  s.vx=0;s.intaking=false;
  for(let i=0;i<360;i++) step(s);
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

it('a wall stop permanently rearranges a half-full pile rather than returning to stored slots', () => {
  const {fill,mesh,step}=pile(), s=state();
  fill.set(0.5);
  for(let frame=0;frame<360;frame++) step(s);
  s.vx=4;
  for(let frame=0;frame<180;frame++) step(s);
  const before=mesh.instanceMatrix.array.slice();
  s.vx=0; // chassis loses its velocity on impact; the FUEL retains forward momentum
  for(let frame=0;frame<360;frame++) step(s);
  let changed=0;
  for(let i=0;i<mesh.count;i++) {
    const j=i*16;
    const travel=Math.hypot(mesh.instanceMatrix.array[j+12]-before[j+12],mesh.instanceMatrix.array[j+14]-before[j+14]);
    if(travel>0.02) changed++;
  }
  expect(changed).toBeGreaterThan(mesh.count/3);
  const settled=mesh.instanceMatrix.version;
  for(let frame=0;frame<120;frame++) step(s);
  expect(mesh.instanceMatrix.version).toBe(settled);
});

it('continues an incoming ball from the intake endpoint, then rolls into a new resting pocket', () => {
  const {fill,mesh,step}=pile(), s=state();
  fill.set(0.5);
  for(let frame=0;frame<360;frame++) step(s);
  const old=mesh.count;
  const entry=mesh.userData.fuelEntry(new THREE.Vector3(-0.23,0.35,0.18)) as THREE.Vector3;
  mesh.userData.receiveFuel(entry);
  fill.set((old+1)/(mesh.userData.fuelSlots as number));
  const matrix=new THREE.Matrix4(),pos=new THREE.Vector3();
  mesh.getMatrixAt(old,matrix);pos.setFromMatrixPosition(matrix);
  expect(pos.distanceTo(entry)).toBeLessThan(1e-6);
  for(let frame=0;frame<180;frame++) step(s);
  mesh.getMatrixAt(old,matrix);pos.setFromMatrixPosition(matrix);
  expect(pos.distanceTo(entry)).toBeGreaterThan(0.025);
});

it('rearranges fuel when the real chassis collides with a field wall', async () => {
  const {default:RAPIER}=await import('@dimforge/rapier3d-compat');
  const {SEASONS}=await import('../src/seasons');
  const {HeadlessSim}=await import('../src/engine/testing/headless');
  const {cloneConfig}=await import('../src/engine/robot/config');
  const {IDLE_COMMAND}=await import('../src/engine/robot/robot');
  await RAPIER.init();
  const season=SEASONS.find(s=>s.year===2026)!;
  const sim=new HeadlessSim(season,RAPIER,{robot:cloneConfig(season.robotDefaults),alliance:'blue',pose:{x:3,y:1.8,yaw:0}});
  try {
    sim.load(20);const r=sim.robot;
    r.enabled=true;
    for(let frame=0;frame<360;frame++)r.syncVisual(1/60);
    const mesh=r.visual.getObjectByName('hopper-fuel-pile') as THREE.InstancedMesh;
    let preImpact: Float32Array | null=null, speed=0, collided=false;
    for(let frame=0;frame<240;frame++) {
      const old=mesh.instanceMatrix.array.slice() as Float32Array;
      sim.step({...IDLE_COMMAND,vx:-4});
      const next=r.body.linvel().x;
      if(speed < -2 && next-speed>1) {preImpact=old;collided=true;}
      speed=next;r.syncVisual(sim.physics.dt);
    }
    expect(collided).toBe(true);
    for(let frame=0;frame<360;frame++){sim.step(IDLE_COMMAND);r.syncVisual(sim.physics.dt);}
    let changed=0;
    for(let i=0;i<mesh.count;i++) {
      const j=i*16;
      if(Math.hypot(mesh.instanceMatrix.array[j+12]-preImpact![j+12],mesh.instanceMatrix.array[j+14]-preImpact![j+14])>0.02)changed++;
    }
    expect(changed).toBeGreaterThan(2);
  } finally {sim.dispose();}
});

it('also puts a dense full hopper to sleep instead of spending CPU forever on resting contacts', () => {
  const {fill,mesh,step}=pile(),s=state();fill.set(1);
  for(let frame=0;frame<600;frame++)step(s);
  const version=mesh.instanceMatrix.version;
  for(let frame=0;frame<120;frame++)step(s);
  expect(mesh.instanceMatrix.version).toBe(version);
});

function packed(open: boolean, balls: number) {
  const group = new THREE.Group();
  const fill = fillBlock(group, { x: 0, y0: 0.09, length: 0.6, width: 0.6, height: 0.4, color: 0xf2c200, capacity: 60 });
  const mesh = group.children[0] as THREE.InstancedMesh;
  mesh.userData.setFuelOpen(open);
  const out: number[] = [];
  mesh.userData.fuelEscape = (_m: unknown, _x: number, y: number) => out.push(y);
  fill.set(balls / mesh.userData.fuelSlots);
  const step = mesh.userData.animateFuel as (s: RobotAnimState) => void;
  return { mesh, step, out };
}
it('a hard hit throws the top of a brim-full open hopper over the rim; a lid, or a shallow pile, keeps it in', () => {
  const run = (open: boolean, balls: number) => {
    const { mesh, step, out } = packed(open, balls), s = state();
    for (let i = 0; i < 120; i++) step(s);
    s.vx = 6; for (let i = 0; i < 3; i++) step(s);
    s.vx = 0; for (let i = 0; i < 90; i++) step(s); // stopped dead by a wall
    return { escaped: out.length, left: mesh.count };
  };
  const full = packed(true, 1).mesh.userData.fuelSlots as number;
  expect(run(true, full).escaped).toBeGreaterThan(0);
  expect(run(false, full).escaped).toBe(0);
  expect(run(true, 5).escaped).toBe(0);
});
it('a tilted open hopper pours toward the low side, a level one stays put', () => {
  const tilted = (ang: number) => {
    const { mesh, step, out } = packed(true, 40), s = state();
    for (let i = 0; i < 120; i++) step(s);
    s.upx = 0; s.upy = Math.cos(ang); s.upz = Math.sin(ang);
    for (let i = 0; i < 180; i++) step(s);
    return { escaped: out.length, left: mesh.count };
  };
  expect(tilted(0).escaped).toBe(0);
  expect(tilted(Math.PI).escaped).toBeGreaterThan(30);
});
