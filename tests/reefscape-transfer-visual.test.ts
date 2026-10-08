import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { SEASONS } from '../src/seasons';
import { cloneConfig, footprint, groundSideSign, stationSideSign } from '../src/engine/robot/config';
import { mat, robotModelBuilder, type RobotAnimState } from '../src/engine/robot/models';
import { coralTransferPose } from '../src/seasons/2025-reefscape/transferVisual';

const state: RobotAnimState = {dt:1/60,time:0,enabled:true,intaking:false,firing:0,passing:false,aiming:false,hood:1,fill:0,climb:0,blocker:0,place:null,vx:0,vz:0,omega:0};
const season = SEASONS.find(s => s.id === '2025-reefscape')!;
function fixture(id: string) {
  const config = cloneConfig(season.teamRobots!.find(t => t.id === id)!.config);
  const visual = new THREE.Group(), turret = new THREE.Group(); visual.add(turret);
  const k = {config,visual,turret,alliance:'blue' as const,fp:footprint(config),groundSide:groundSideSign(config),stationSide:stationSideSign(config),mats:{dark:mat(0),alu:mat(0xaaaaaa),bumper:mat(0x0000aa)}};
  return {visual, model:robotModelBuilder(id)!(k)};
}

describe('reference-based REEFSCAPE piece poses', () => {
  for (const t of season.teamRobots!) it(`${t.id}: has explicit coral and algae seating`, () => {
    const {model} = fixture(t.id);
    expect(model.coralAxis).toBeDefined();
    expect(new THREE.Vector3(...model.coralAxis!).length()).toBeCloseTo(1);
    expect(model.algaeAnchor).toBeDefined();
    expect(model.algaeAnchor).not.toBe(model.heldAnchor);
  });

  it('1778 lifts the captured coral with its intake before the claw takes it', () => {
    const {model,visual} = fixture('subzero-1778');
    const tip = () => {visual.updateMatrixWorld(true);return visual.worldToLocal(model.intakeAnchor!.getWorldPosition(new THREE.Vector3()));};
    for(let n=0;n<120;n++)model.update({...state,intaking:true,place:{height:.45,forward:.3,level:1}});
    const carpet = tip();
    const samples: THREE.Vector3[] = [];
    for(const progress of [.001,.25,.5,.65,.999]) {
      for(let n=0;n<120;n++)model.update({...state,place:{height:.45,forward:.3,level:1,handoff:progress}});
      const intake = tip(), end = visual.worldToLocal(model.heldAnchor!.getWorldPosition(new THREE.Vector3()));
      const position = new THREE.Vector3(), q = new THREE.Quaternion();
      coralTransferPose(visual,model.intakeAnchor,end,q,progress,undefined,model.handoffStyle,position,q);
      if(progress<=.65)expect(position.distanceTo(intake)).toBeLessThan(1e-8);
      if(progress===.999)expect(position.distanceTo(end)).toBeLessThan(.001);
      samples.push(intake);
    }
    expect(samples[3].y-carpet.y).toBeGreaterThan(.2);
    expect(samples[0].distanceTo(carpet)).toBeLessThan(.005);
  });

  it('a moving, yawed intake carries the tube orientation as well as its center', () => {
    const visual = new THREE.Group(), intake = new THREE.Object3D();visual.add(intake);
    visual.rotation.y=1.1;intake.rotation.x=.8;intake.position.set(-.3,.5,.1);visual.updateMatrixWorld(true);
    const position = new THREE.Vector3(), q = new THREE.Quaternion();
    coralTransferPose(visual,intake,new THREE.Vector3(.1,.8,0),new THREE.Quaternion(),.4,undefined,'fold',position,q);
    expect(position.distanceTo(intake.position)).toBeLessThan(1e-8);
    const axis = new THREE.Vector3(0,1,0).applyQuaternion(q);
    expect(axis.distanceTo(new THREE.Vector3(0,0,1).applyQuaternion(intake.quaternion))).toBeLessThan(1e-8);
  });

  it('2910 and 971 direct pickup do not invent a floor-to-arm transfer', () => {
    const end = new THREE.Vector3(.5,.1,0), endQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,0,1),.7);
    for(const progress of [.1,.5,.9]) {
      const position = new THREE.Vector3(), q = new THREE.Quaternion();
      coralTransferPose(new THREE.Group(),undefined,end,endQ,progress,[new THREE.Vector3(-.5,0,0)],'direct',position,q);
      expect(position.equals(end)).toBe(true);expect(q.angleTo(endQ)).toBeLessThan(1e-8);
    }
  });
});
