import { readFileSync } from 'node:fs';
import { beforeAll, expect, it } from 'vitest';
import * as THREE from 'three';
import { SEASONS } from '../src/seasons';
import { cloneConfig } from '../src/engine/robot/config';
import { CAD_2025_MODEL_IDS, decodeCadModel, cadRobotModelBuilder, setCadAnimationEnabled } from '../src/engine/robot/cadModels';
import type { RobotAnimState } from '../src/engine/robot/models';
// The 2025 top-EPA imports (5940, 422, 1706, 3005, 190) have no separate arm group: elevator-mounted heads and pivots.
const TOP_EPA=new Set<string>(['taiyaki-5940','wisp-422','singularity-1706','relay-3005','redundancy-190']);
const idle:RobotAnimState={dt:0,time:0,enabled:false,intaking:false,firing:0,passing:false,aiming:false,hood:.9,fill:0,climb:0,blocker:0,place:null,vx:0,vz:0,omega:0};
beforeAll(async()=>{
  for(const id of CAD_2025_MODEL_IDS){const b=readFileSync(`public/models/robots/2025/${id}.glb`);await decodeCadModel(id,b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength));}
},60000);
for(const id of CAD_2025_MODEL_IDS)it(`${id}: decoded CAD retains its export bounds and connected moving holders`,()=>{
  const config=cloneConfig(SEASONS.find(s=>s.year===2025)!.teamRobots!.find(r=>r.id===id)!.config);
  const visual=new THREE.Group(),turret=new THREE.Group();visual.add(turret);
  const material=new THREE.MeshStandardMaterial();
  const model=cadRobotModelBuilder(id)!({config,visual,turret,alliance:'blue',fp:{length:config.frameLength,width:config.frameWidth},groundSide:-1,stationSide:-1,mats:{dark:material,alu:material,bumper:material}});
  const root=visual.getObjectByName(`cad-${id}`)!;
  const report=JSON.parse(readFileSync(`public/models/robots/2025/${id}.report.json`,'utf8'));
  // Catch compression corruption against bounds measured before encoding.
  setCadAnimationEnabled(false);model.update(idle);visual.updateMatrixWorld(true);
  const b=new THREE.Box3().setFromObject(root,true);
  b.min.toArray().forEach((v,i)=>expect(v).toBeCloseTo(report.bounds.min[i],4));
  b.max.toArray().forEach((v,i)=>expect(v).toBeCloseTo(report.bounds.max[i],4));
  expect(report.outputBytes/report.inputBytes).toBeLessThan(.06);
  expect(report.outputTriangles/report.inputTriangles).toBeLessThan(.12);
  for(const name of ['frame',...(TOP_EPA.has(id)?[]:['arm']),'carriage','elevator-stage',id==='wildstang-111'?'coral-head':'effector'])expect(root.getObjectByName(name)).toBeTruthy();
  setCadAnimationEnabled(true);model.update(idle);visual.updateMatrixWorld(true);
  if(id==='firefly-118'){const latch=root.getObjectByName('climber-latch')!;expect(latch.parent?.name).toBe('cad-climber-pivot');const stowed=new THREE.Box3().setFromObject(latch,true);expect(stowed.max.x).toBeLessThan(config.frameLength/2);}
  if(id==='subzero-1778')expect(model.coralAxis).toEqual([0,0,1]);
  const rigidHead=root.getObjectByName('cad-effector-pivot');
  const headBind=rigidHead?.quaternion.clone();
  if(id==='spectre-2910'){
    const shoulder=root.getObjectByName('cad-arm-pivot')!,mid=root.getObjectByName('cad-elevator-stage-pivot')!,inner=root.getObjectByName('cad-carriage-pivot')!;
    expect(mid.parent).toBe(shoulder);expect(inner.parent).toBe(mid);
    expect(root.getObjectByName('cad-effector-pivot')!.parent).toBe(inner);
    for(const side of [0,2]){
      for(let n=0;n<150;n++)model.update({...idle,dt:.03,place:{height:1.75,forward:.7,level:4,side}});
      visual.updateMatrixWorld(true);
      expect(model.heldAnchor!.getWorldPosition(new THREE.Vector3()).distanceTo(new THREE.Vector3(side===2?-.7:.7,1.75,0))).toBeLessThan(.025);
      expect(mid.position.distanceTo(inner.position),'cascade stages share extension equally').toBeLessThan(.0001);
    }
    model.update({...idle,climb:1});visual.updateMatrixWorld(true);
    const deployed=model.climbAnchor!.getWorldPosition(new THREE.Vector3());
    model.update({...idle,climb:.25});visual.updateMatrixWorld(true);
    expect(model.climbAnchor!.getWorldPosition(new THREE.Vector3()).distanceTo(deployed),'cage contact follows arm-driven pull-in').toBeGreaterThan(.2);
  }
  if(id==='quixilver-604-2025') {
    expect(config.options?.algaeGround).toBe(true);
    expect(config.intake.ground).toBe(false);
    model.update({...idle,intaking:true,enabled:true});visual.updateMatrixWorld(true);
    const pickup=model.algaeAnchor!.getWorldPosition(new THREE.Vector3());
    expect(pickup.x).toBeGreaterThan(config.frameLength/2);
    expect(pickup.y).toBeLessThan(.5);
    expect(new THREE.Box3().setFromObject(root,true).min.y).toBeGreaterThan(-.04);
    model.update(idle);
  }
  const initial=model.heldAnchor!.getWorldPosition(new THREE.Vector3());
  const fixed=root.getObjectByName('frame')!.matrixWorld.clone();
  const poses=[{height:.45,forward:.3,level:1},{height:1.75,forward:.7,level:4},{height:2.03,forward:.45,level:3,algae:true},{height:.45,forward:.3,level:1,handoff:.5}];
  for(const pose of poses){
    for(let n=0;n<30;n++)model.update({...idle,dt:.03,enabled:true,intaking:true,climb:n/29,place:pose});
    visual.updateMatrixWorld(true);expect(root.getObjectByName('frame')!.matrixWorld.equals(fixed)).toBe(true);
    if(id==='zuma-581'){
      expect(Math.abs(rigidHead!.quaternion.dot(headBind!)),'581 has no independent wrist rotation').toBeCloseTo(1,6);
      const direction=new THREE.Vector3(...model.coralAxis!).applyQuaternion(model.heldAnchor!.getWorldQuaternion(new THREE.Quaternion()));
      const arm=root.getObjectByName('cad-arm-pivot')!;
      const armDirection=new THREE.Vector3(0,1.3651-1.828,-.3895-.00035).normalize().applyQuaternion(arm.getWorldQuaternion(new THREE.Quaternion()));
      expect(direction.dot(armDirection),'CORAL crosses the arm rather than tracking the roller shafts').toBeCloseTo(0,6);
    }
    root.traverse(o=>expect(o.matrixWorld.elements.every(Number.isFinite)).toBe(true));
    const bound=new THREE.Box3().setFromObject(root,true);
    expect(bound.min.y,'CAD should clear the carpet').toBeGreaterThan(-.04);
    expect(bound.max.y).toBeLessThan(3);
    expect(model.heldAnchor!.getWorldPosition(new THREE.Vector3()).toArray().every(Number.isFinite)).toBe(true);
  }
  model.update({...idle,place:{height:1.75,forward:.7,level:4}});visual.updateMatrixWorld(true);
  expect(model.heldAnchor!.getWorldPosition(new THREE.Vector3()).distanceTo(initial)).toBeGreaterThan(.1);
},30000);

it('1778 CAD folds its floor intake upward and meets the hanging coral claw', () => {
  const config=cloneConfig(SEASONS.find(s=>s.year===2025)!.teamRobots!.find(r=>r.id==='subzero-1778')!.config);
  const visual=new THREE.Group(),turret=new THREE.Group();visual.add(turret);
  const material=new THREE.MeshStandardMaterial();
  const model=cadRobotModelBuilder('subzero-1778')!({config,visual,turret,alliance:'blue',fp:{length:config.frameLength,width:config.frameWidth},groundSide:-1,stationSide:-1,mats:{dark:material,alu:material,bumper:material}});
  setCadAnimationEnabled(true);
  const tip=()=>{visual.updateMatrixWorld(true);return model.intakeAnchor!.getWorldPosition(new THREE.Vector3());};
  model.update({...idle,enabled:true,intaking:true,place:{height:.45,forward:.3,level:1}});
  const start=tip();
  for(const progress of [.001,.1,.25,.5,.65,.9,.999]) {
    model.update({...idle,enabled:true,place:{height:.45,forward:.3,level:1,handoff:progress}});
    visual.updateMatrixWorld(true);
    expect(new THREE.Box3().setFromObject(visual,true).min.y).toBeGreaterThan(-.04);
  }
  const end=tip(),gripper=model.heldAnchor!.getWorldPosition(new THREE.Vector3());
  expect(end.y-start.y).toBeGreaterThan(.3);
  expect(end.distanceTo(gripper)).toBeLessThan(.12);
});

it('Orbit keeps its suction head rigid and pass-through intake down on both scoring sides',()=>{
  const config=cloneConfig(SEASONS.find(s=>s.year===2025)!.teamRobots!.find(r=>r.id==='whisper-1690')!.config);
  expect(config.placement!.scoreSide).toBe('sides');
  const visual=new THREE.Group(),turret=new THREE.Group();visual.add(turret);
  const material=new THREE.MeshStandardMaterial();
  const model=cadRobotModelBuilder('whisper-1690')!({config,visual,turret,alliance:'blue',fp:{length:config.frameLength,width:config.frameWidth},groundSide:-1,stationSide:-1,mats:{dark:material,alu:material,bumper:material}});
  setCadAnimationEnabled(true);
  const head=visual.getObjectByName('cad-effector-pivot')!,intake=visual.getObjectByName('cad-intake-pivot')!;
  const bind=head.quaternion.clone();
  expect(model.coralAxis).toEqual([0,0,1]);
  for(const side of [-1,1]){
    model.update({...idle,place:{height:1.75,forward:.4,level:4,side}});visual.updateMatrixWorld(true);
    const at=model.heldAnchor!.getWorldPosition(new THREE.Vector3());
    expect(at.z).toBeCloseTo(-side*.4,4);expect(at.y).toBeCloseTo(1.75,4);
    expect(head.quaternion.angleTo(bind)).toBeLessThan(1e-6);
  }
  for(const handoff of [.001,.25,.5,.75,.999]){
    model.update({...idle,place:{height:.45,forward:.3,level:1,handoff}});
    expect(intake.rotation.x).toBe(0);expect(intake.rotation.z).toBe(0);
    expect(head.quaternion.angleTo(bind)).toBeLessThan(1e-6);
  }
});

it('Spectre floor pickup folds its wrist beneath rails that clear the front bumper',()=>{
  const config=cloneConfig(SEASONS.find(s=>s.year===2025)!.teamRobots!.find(r=>r.id==='spectre-2910')!.config);
  expect(config.intake.groundYaw).toBe(0);expect(config.options!.dualPieceStorage).toBe(true);
  const visual=new THREE.Group(),turret=new THREE.Group();visual.add(turret);
  const material=new THREE.MeshStandardMaterial();
  const model=cadRobotModelBuilder('spectre-2910')!({config,visual,turret,alliance:'blue',fp:{length:config.frameLength,width:config.frameWidth},groundSide:1,stationSide:1,mats:{dark:material,alu:material,bumper:material}});
  setCadAnimationEnabled(true);
  model.update({...idle,enabled:true,intaking:true,place:{height:.45,forward:.3,level:1}});visual.updateMatrixWorld(true);
  const shoulder=visual.getObjectByName('cad-arm-pivot')!.getWorldPosition(new THREE.Vector3());
  const head=visual.getObjectByName('cad-effector-pivot')!.getWorldPosition(new THREE.Vector3());
  const edge=config.frameLength/2;
  const railY=shoulder.y+(head.y-shoulder.y)*(edge-shoulder.x)/(head.x-shoulder.x);
  expect(railY).toBeGreaterThan(config.bumperTop+.01);
  expect(model.heldAnchor!.getWorldPosition(new THREE.Vector3()).y).toBeCloseTo(.11,3);
});
