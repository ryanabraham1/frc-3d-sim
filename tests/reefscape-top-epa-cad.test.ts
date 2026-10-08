import { readFileSync } from 'node:fs';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { HeadlessSim } from '../src/engine/testing/headless';
import { IDLE_COMMAND } from '../src/engine/robot/robot';
import { cloneConfig, type RobotConfig } from '../src/engine/robot/config';
import { cadRobotModelBuilder, decodeCadModel, setCadAnimationEnabled } from '../src/engine/robot/cadModels';
import type { RobotAnimState, RobotModel } from '../src/engine/robot/models';
import { reefscape2025 as season } from '../src/seasons/2025-reefscape';
import { normalizeReefscapeConfig } from '../src/seasons/2025-reefscape/config';
import * as C from '../src/seasons/2025-reefscape/constants';

/** The five 2025 Spectrum-collection imports after the original set: 5940, 422, 1706, 3005, 190 (EPA order). */
const IDS = ['taiyaki-5940', 'wisp-422', 'singularity-1706', 'relay-3005', 'redundancy-190'] as const;
const FLOOR_CORAL = new Set(['taiyaki-5940', 'wisp-422']);
const FRONT_FLOOR_ALGAE = new Set(['singularity-1706', 'redundancy-190']);
const idle: RobotAnimState = { dt: 0, time: 0, enabled: false, intaking: false, firing: 0, passing: false, aiming: false, hood: .9, fill: 0, climb: 0, blocker: 0, place: null, vx: 0, vz: 0, omega: 0 };
const team = (id: string): RobotConfig => cloneConfig(season.teamRobots!.find(t => t.id === id)!.config);
const sims: HeadlessSim[] = [];

beforeAll(async () => {
  await RAPIER.init();
  for (const id of IDS) { const b = readFileSync(`public/models/robots/2025/${id}.glb`); await decodeCadModel(id, b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); }
}, 120000);
afterEach(() => { for (const sim of sims.splice(0)) sim.dispose(); });

function cad(id: string): { model: RobotModel; visual: THREE.Group; root: THREE.Object3D; config: RobotConfig } {
  const config = team(id), visual = new THREE.Group(), turret = new THREE.Group(); visual.add(turret);
  const material = new THREE.MeshStandardMaterial();
  const model = cadRobotModelBuilder(id)!({ config, visual, turret, alliance: 'blue', fp: { length: config.frameLength, width: config.frameWidth }, groundSide: -1, stationSide: -1, mats: { dark: material, alu: material, bumper: material } });
  setCadAnimationEnabled(true);
  return { model, visual, root: visual.getObjectByName(`cad-${id}`)!, config };
}
const at = (visual: THREE.Object3D, o: THREE.Object3D) => { visual.updateMatrixWorld(true); return visual.worldToLocal(o.getWorldPosition(new THREE.Vector3())); };
function settle(model: RobotModel, s: Partial<RobotAnimState>, frames = 150) { for (let n = 0; n < frames; n++) model.update({ ...idle, dt: .03, enabled: true, ...s }); }

describe('2025 top-EPA CAD rigs', () => {
  for (const id of IDS) {
    it(`${id}: elevator raises the held CORAL, the ALGAE seat and climber move on their own joints`, () => {
      const { model, visual, root } = cad(id);
      expect(Math.hypot(...model.coralAxis!)).toBeCloseTo(1, 2);
      for (const name of ['frame', 'carriage', 'elevator-stage', 'effector', 'climber']) expect(root.getObjectByName(name), name).toBeTruthy();
      settle(model, {});
      const low = at(visual, model.heldAnchor!), algaeLow = at(visual, model.algaeAnchor!);
      settle(model, { place: { height: 1.75, forward: .7, level: 4 } });
      const high = at(visual, model.heldAnchor!);
      expect(high.y - low.y, 'L4 lifts the CORAL').toBeGreaterThan(.9);
      expect(Math.abs(high.y - 1.75), 'CORAL reaches L4 height').toBeLessThan(.25);
      expect(high.x, 'CORAL stays at the front').toBeGreaterThan(0);
      settle(model, { place: { height: 1.2, forward: .6, level: 3, algae: true } });
      const algae = at(visual, model.algaeAnchor!);
      expect(algae.distanceTo(algaeLow), 'ALGAE seat follows the mechanism').toBeGreaterThan(.4);
      expect(Math.abs(algae.y - 1.2), 'ALGAE reaches the REEF pickup height').toBeLessThan(.3);
      settle(model, { climb: 1 }); const out = at(visual, model.climbAnchor!);
      settle(model, { climb: .25 }); const pulled = at(visual, model.climbAnchor!);
      expect(out.distanceTo(pulled), 'cage contact swings between deploy and pull-in').toBeGreaterThan(.1);
      for (const s of [{}, { intaking: true }, { climb: 1 }, { place: { height: 2.1, forward: .5, level: 3, algae: true } }]) {
        settle(model, s, 60); visual.updateMatrixWorld(true);
        const b = new THREE.Box3().setFromObject(root, true);
        expect(b.min.y, 'CAD clears the carpet').toBeGreaterThan(-.04);
        root.traverse(o => expect(o.matrixWorld.elements.every(Number.isFinite)).toBe(true));
      }
    }, 30000);
  }

  it('floor intakes move: 5940 folds its rear intake down, 422 swings its star-wheel arm out, 1706/190 run their ALGAE rollers out front', () => {
    for (const id of IDS) {
      if (id === 'relay-3005') continue;
      const { model, root } = cad(id);
      const pivot = root.getObjectByName('cad-intake-pivot')!;
      settle(model, {});
      const stowedBox = new THREE.Box3().setFromObject(pivot, true);
      settle(model, { intaking: true, place: { height: .45, forward: .3, level: 1 } });
      const deployedBox = new THREE.Box3().setFromObject(pivot, true);
      if (FRONT_FLOOR_ALGAE.has(id)) expect(deployedBox.max.x - stowedBox.max.x, id).toBeGreaterThan(.2);
      else expect(stowedBox.min.x - deployedBox.min.x, id).toBeGreaterThan(.15); // rear intakes reach out the back
    }
  });

  it('5940 keeps its floor intake down through the conveyor handoff; 422 flips CORAL up to the funnel', () => {
    const taiyaki = cad('taiyaki-5940'), intake5940 = taiyaki.root.getObjectByName('cad-intake-pivot')!;
    settle(taiyaki.model, { intaking: true });
    const down = intake5940.rotation.z;
    settle(taiyaki.model, { place: { height: .45, forward: .3, level: 1, handoff: .5 } }, 30);
    expect(intake5940.rotation.z).toBeCloseTo(down, 3);
    const wisp = cad('wisp-422');
    settle(wisp.model, { intaking: true });
    const floor = at(wisp.visual, wisp.model.intakeAnchor!);
    settle(wisp.model, { place: { height: .45, forward: .3, level: 1, handoff: .999 } }, 2);
    const flipped = at(wisp.visual, wisp.model.intakeAnchor!);
    expect(flipped.y - floor.y).toBeGreaterThan(.3);
  });
});

describe('2025 top-EPA rosters', () => {
  const make = (config: RobotConfig) => { const sim = new HeadlessSim(season, RAPIER, { robot: config, alliance: 'blue', pose: { x: 2, y: 2, yaw: 0 }, station: 2 }); sims.push(sim); return sim; };
  const run = (sim: HeadlessSim, seconds: number) => { for (let n = 0; n < Math.round(seconds / sim.physics.dt); n++) sim.step({ ...IDLE_COMMAND, intake: true }); };
  const teleop = (sim: HeadlessSim) => { sim.rules.onPeriodChange(sim.ctx.clock.start()); for (const c of sim.ctx.clock.advance(18)) sim.rules.onPeriodChange(c); };
  const empty = (sim: HeadlessSim) => { for (const i of sim.robot.held.splice(0)) sim.pool.reserve(i); };

  for (const id of IDS) {
    it(`${id}: collects floor pieces only at its real mouth`, () => {
      const config = team(id), behind = 2 - (config.frameLength / 2 + config.bumperThickness + .17), ahead = 2 + (config.frameLength / 2 + config.bumperThickness + .17);
      let sim = make(team(id)); teleop(sim); empty(sim);
      sim.pool.placeField(0, behind, 2, C.CORAL_RADIUS); run(sim, .4);
      expect(sim.robot.held.includes(0), 'rear floor CORAL').toBe(FLOOR_CORAL.has(id));
      sim = make(team(id)); teleop(sim); empty(sim);
      sim.pool.placeField(0, ahead, 2, C.CORAL_RADIUS); run(sim, .4);
      expect(sim.robot.held.includes(0), 'front floor CORAL (scoring end)').toBe(false);
      sim = make(team(id)); teleop(sim); empty(sim);
      sim.pool.placeField(126, ahead + .1, 2, C.ALGAE_RADIUS); run(sim, .4);
      expect(sim.robot.held.includes(126), 'front floor ALGAE').toBe(FRONT_FLOOR_ALGAE.has(id));
    });
  }

  it('saved copies of the new team robots reload unchanged, with their cage grip and intake faces', () => {
    for (const id of IDS) {
      const config = team(id), saved = JSON.parse(JSON.stringify(config)) as RobotConfig;
      expect(normalizeReefscapeConfig(saved)).toEqual(config);
      expect(config.model).toBe(id);
      expect(config.climber.gripOffset, id).toBeDefined();
      expect(config.intake.groundSide).toBe('back');
      if (FRONT_FLOOR_ALGAE.has(id)) { expect(config.intake.groundYaw).toBe(0); expect(config.options?.algaeGround).toBe(true); }
      expect(config.intake.ground).toBe(FLOOR_CORAL.has(id));
      expect(config.intake.station).toBe(id !== 'taiyaki-5940');
      expect(config.hopperCapacity).toBe(id === 'wisp-422' ? 1 : 2);
      // A saved copy that predates the cage-grip calibration picks it up again.
      delete (saved.climber as { gripOffset?: unknown }).gripOffset;
      expect(normalizeReefscapeConfig(saved).climber.gripOffset).toEqual(config.climber.gripOffset);
    }
  });
});
