import { beforeAll, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { SEASONS } from '../src/seasons';
import { cloneConfig, footprint, groundSideSign, stationSideSign, launcherExitOffsets } from '../src/engine/robot/config';
import { flowAt, fourBarIntake, mat, pivot, robotModelBuilder, roller, type ModelKit, type RobotAnimState } from '../src/engine/robot/models';
import { HeadlessSim } from '../src/engine/testing/headless';
import { IDLE_COMMAND } from '../src/engine/robot/robot';
import { handoffPoint } from '../src/engine/robot/handoff';
import { Rng } from '../src/engine/random';

const state = (extra: Partial<RobotAnimState> = {}): RobotAnimState => ({ dt: 1/60, time: 0, enabled: true, intaking: false, firing: 0, passing: false, aiming: false, hood: 1, fill: .5, climb: 0, blocker: 0, place: null, vx: 0, vz: 0, omega: 0, ...extra });
function kit(year: number, id: string): ModelKit {
  const c = cloneConfig(SEASONS.find(s => s.year === year)!.teamRobots!.find(t => t.id === id)!.config);
  const visual = new THREE.Group(), turret = new THREE.Group(); visual.add(turret);
  return { config: c, visual, turret, alliance: 'blue', fp: footprint(c), groundSide: groundSideSign(c), stationSide: stationSideSign(c), mats: { dark: mat(0x111111), alu: mat(0xbbbbbb), bumper: mat(0x1111aa) } };
}
function settle(model: { update(s: RobotAnimState): void }, s: RobotAnimState) {
  for (let i=0; i<240; i++) { s.time += s.dt; model.update(s); }
}
const local = (k: ModelKit, o: THREE.Object3D) => { k.visual.updateMatrixWorld(true); return k.visual.worldToLocal(o.getWorldPosition(new THREE.Vector3())); };

beforeAll(async () => { await RAPIER.init(); });
describe('CAD mechanism paths', () => {
  it('roller throat points ignore tread spin but follow parent pitch and yaw', () => {
    const k = kit(2026,'roman-6329'), head = pivot(k.visual,.2,.4,.1);
    const r = roller(head,.05,.2,k.mats.dark,.02,.03);
    const before = flowAt(k,r,.06,.07,.01);
    r.rotation.z = 2.3;
    expect(flowAt(k,r,.06,.07,.01).distanceTo(before)).toBeLessThan(1e-8);
    head.rotation.z = .65; head.rotation.y = 1.2;
    const want = local(k,head).add(new THREE.Vector3(.08,.1,.01).applyQuaternion(head.quaternion));
    expect(flowAt(k,r,.06,.07,.01).distanceTo(want)).toBeLessThan(1e-8);
  });

  it('ROMAN parallel links stay pinned to a level roller bank at every deployment', () => {
    const k = kit(2026,'roman-6329');
    const intake = fourBarIntake(k,{ reach:k.config.intake.reach, frame:k.mats.alu, rollerMaterial:k.mats.dark });
    const upper = k.visual.getObjectByName('four-bar-link-0')!, lower = k.visual.getObjectByName('four-bar-link-1')!, bank = k.visual.getObjectByName('four-bar-roller-bank')!;
    const len = Math.abs(bank.position.x);
    for (const deploy of [0,.25,.5,.75,1]) {
      intake.update(state(),deploy); k.visual.updateMatrixWorld(true);
      const bankBottom = bank.localToWorld(new THREE.Vector3(0,-.085,0));
      const linkEnd = lower.localToWorld(new THREE.Vector3(k.groundSide*len,0,0));
      expect(bankBottom.distanceTo(linkEnd)).toBeLessThan(1e-8);
      expect(upper.rotation.z).toBeCloseTo(lower.rotation.z);
      expect(bank.getWorldQuaternion(new THREE.Quaternion()).angleTo(new THREE.Quaternion())).toBeLessThan(1e-8);
    }
  });

  it('handoff follows conveyor bends and arrives at the current gripper', () => {
    const path = [new THREE.Vector3(-1,.1,0),new THREE.Vector3(0,.1,0)];
    const end = new THREE.Vector3(0,1.1,0);
    expect(handoffPoint(path,end,0).distanceTo(path[0])).toBe(0);
    expect(handoffPoint(path,end,.5).distanceTo(path[1])).toBeLessThan(1e-8);
    expect(handoffPoint(path,end,1).distanceTo(end)).toBeLessThan(1e-8);
  });

  it('CHUNK keeps its static hood and uses speed to solve shots', () => {
    const k=kit(2026,'chunk-7769'), model=robotModelBuilder('chunk-7769')!(k);
    const hood=k.visual.getObjectByName('static-shooter-hood')!;
    const angle=hood.rotation.z;
    for (const elevation of [.5,1.25]) {
      settle(model,state({ aiming:true,hood:elevation }));
      expect(hood.rotation.z).toBe(angle);
    }
    expect(k.config.launcher.minAngle).toBe(k.config.launcher.maxAngle);
  });

  for (const id of ['doppler-1690','axl-4522','skyfall-1114','typhoon-2910','titan-581','roti-5940','presto-6328']) {
    it(`${id}: pitching shooter follows the solved elevation`, () => {
      const k = kit(2024,id), model = robotModelBuilder(id)!(k);
      for (const hood of [.5,1.2]) {
        settle(model,state({ aiming:true, hood, fill:1 }));
        k.visual.updateMatrixWorld(true);
        const direction = new THREE.Vector3(1,0,0).applyQuaternion(model.heldAnchor!.getWorldQuaternion(new THREE.Quaternion()));
        expect(Math.atan2(direction.y,direction.x)).toBeCloseTo(hood,3);
      }
    });
  }

  for (const id of ['whisper-1690','lightning-2056','sublime-1678','miss-daisy-341','zuma-581']) {
    it(`${id}: floor transfer follows the conveyor into a low gripper`, () => {
      const k = kit(2025,id), model = robotModelBuilder(id)!(k);
      settle(model,state({ place:{ height:.3, forward:.3, level:4, handoff:.5 } }));
      const end = local(k,model.heldAnchor!), path = model.flow!.handoff!();
      expect(path[0].distanceTo(local(k,model.intakeAnchor!))).toBeLessThan(1e-8);
      expect(end.y).toBeGreaterThan(.2); expect(end.y).toBeLessThan(.4);
      expect(end.distanceTo(path.at(-1)!)).toBeLessThan(.2);
      expect(path.every(p => [p.x,p.y,p.z].every(Number.isFinite))).toBe(true);
    });
  }

  for (const id of ['spectre-2910','fiddler-971']) {
    it(`${id}: direct-collection claw reaches the carpet on the capture side`, () => {
      const k = kit(2025,id), model = robotModelBuilder(id)!(k);
      settle(model,state({ intaking:true, place:{ height:.45, forward:.3, level:4 } }));
      const p = local(k,model.intakeAnchor!);
      expect(p.x).toBeGreaterThan(k.fp.length/2);
      expect(p.y).toBeGreaterThan(.05); expect(p.y).toBeLessThan(.18);
    });
  }

  for (const id of ['fiddler-971', 'spectre-2910']) {
    it(`${id}: scoring wins over a still-active intake command`, () => {
      const k=kit(2025,id), model=robotModelBuilder(id)!(k);
      settle(model,state({intaking:true,place:{height:1.8,forward:.65,level:4}}));
      const end=local(k,model.heldAnchor!);
      expect(end.distanceTo(new THREE.Vector3(.65,1.8,0))).toBeLessThan(.08);
      if (id==='fiddler-971') expect(k.visual.getObjectByName('fiddler-moving-stage')!.position.y).toBeGreaterThan(.5);
    });
  }

  it('WildStang swings sideways to reach with either independent holder on both sides', () => {
    const k=kit(2025,'wildstang-111'), model=robotModelBuilder('wildstang-111')!(k);
    expect(k.config.placement!.scoreSide).toBe('sides');
    for (const side of [-1,1]) for (const algae of [false,true]) {
      settle(model,state({place:{height:1.8,forward:.45,level:4,algae,side}}));
      const active=local(k,algae?model.algaeAnchor!:model.heldAnchor!);
      expect(active.distanceTo(new THREE.Vector3(.15,1.8,-side*.45))).toBeLessThan(.04);
      expect(local(k,model.heldAnchor!).distanceTo(local(k,model.algaeAnchor!))).toBeGreaterThan(1);
    }
  });

  it('WildStang arm and compressed held algae clear the elevator throughout the swing', () => {
    const k=kit(2025,'wildstang-111'), model=robotModelBuilder('wildstang-111')!(k);
    const arm=k.visual.getObjectByName('wildstang-shared-arm')!;
    for (let angle=-Math.PI;angle<=Math.PI;angle+=Math.PI/16) {
      arm.rotation.x=angle; k.visual.updateMatrixWorld(true);
      const bounds=new THREE.Box3().setFromObject(arm);
      const mastFront=-.12+.035/2;
      expect(bounds.min.x).toBeGreaterThan(mastFront+.02);
      expect(local(k,model.algaeAnchor!).x-.206*model.algaeGripScale![2]).toBeGreaterThan(mastFront+.02);
    }
  });

  it('WildStang keeps both holders above the carpet while stowed', () => {
    const k=kit(2025,'wildstang-111'), model=robotModelBuilder('wildstang-111')!(k);
    settle(model,state({place:{height:.45,forward:.3,level:4,algae:true}}));
    expect(local(k,model.algaeAnchor!).y).toBeGreaterThan(.206);
    expect(local(k,model.heldAnchor!).y).toBeGreaterThan(.2);
  });

  for (const id of ['mixtape-971','croquembouche-5940']) {
    it(`${id}: feed and physical shots alternate between the same two turret lanes`, () => {
      const k = kit(2026,id), model = robotModelBuilder(id)!(k);
      settle(model,state({ aiming:true }));
      const paths = [model.flow!.feed!(0),model.flow!.feed!(1)];
      expect(paths[0].at(-1)!.z).toBeLessThan(0); expect(paths[1].at(-1)!.z).toBeGreaterThan(0);
      const season = SEASONS.find(s => s.year === 2026)!;
      const sim = new HeadlessSim(season,RAPIER,{ robot:k.config, alliance:'blue', pose:{ x:2,y:2,yaw:0 } });
      try {
        const r=sim.robot; r.projectile={ radius:season.gamePiece.radius, airDamping:.02 };
        sim.rules.stage(); r.enabled=true; r.held.push(-1,-1);
        const rng = new Rng(7), a=r.launch(null,rng)!;
        for (let tick=0; tick<Math.ceil(1/r.config.launcher.rate/sim.physics.dt)+1; tick++) sim.step(IDLE_COMMAND);
        const b=r.launch(null,rng)!;
        expect(a).not.toBeNull(); expect(b).not.toBeNull();
        expect(a.pos.z-r.body.translation().z).toBeLessThan(0);
        expect(b.pos.z-r.body.translation().z).toBeGreaterThan(0);
        expect(a.pos.y).toBeGreaterThan(r.config.height+season.gamePiece.radius);
        expect(launcherExitOffsets(k.config).length).toBe(2);
      } finally { sim.dispose(); }
    });
  }
});
