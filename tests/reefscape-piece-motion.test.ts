import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import type { TeamRobot } from '../src/engine/core/season';
import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { HeadlessSim } from '../src/engine/testing/headless';
import { IDLE_COMMAND } from '../src/engine/robot/robot';
import { cloneConfig } from '../src/engine/robot/config';
import { nearestTurn, scoringSlew } from '../src/engine/robot/scoringReadiness';
import { CAD_2025_MODEL_IDS, decodeCadModel, setCadModelsEnabled } from '../src/engine/robot/cadModels';
import { reefscape2025 as season } from '../src/seasons/2025-reefscape';
import { EJECT_SECONDS, type ReefscapeRules } from '../src/seasons/2025-reefscape/rules';
import * as C from '../src/seasons/2025-reefscape/constants';

/**
 * Held CORAL moves continuously through every 2025 robot: drawn in from the carpet at pickup, and driven out of the
 * end effector to the exact pose the physics releases it from when scoring (no teleports), for the imported CAD
 * models users see and the procedural fallbacks.
 */
const sims: HeadlessSim[] = [];
beforeAll(async () => {
  await RAPIER.init();
  for (const id of CAD_2025_MODEL_IDS) { const b = readFileSync(`public/models/robots/2025/${id}.glb`); await decodeCadModel(id, b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); }
}, 120000);
afterEach(() => { for (const s of sims.splice(0)) s.dispose(); setCadModelsEnabled(true); });

function make(team: TeamRobot, pose: { x: number; y: number; yaw: number }) {
  const sim = new HeadlessSim(season, RAPIER, { robot: cloneConfig(team.config), alliance: 'blue', pose, station: 2 });
  sims.push(sim);
  sim.rules.onPeriodChange(sim.ctx.clock.start());
  for (const c of sim.ctx.clock.advance(18)) sim.rules.onPeriodChange(c);
  for (const i of sim.robot.held.splice(0)) sim.pool.reserve(i);
  return sim;
}
function frame(sim: HeadlessSim, cmd = IDLE_COMMAND, t = 0) {
  for (const c of sim.ctx.clock.advance(sim.physics.dt)) sim.rules.onPeriodChange(c);
  sim.step(cmd);
  sim.rules.updateVisuals(sim.physics.dt, t);
  sim.robot.visual.updateMatrixWorld(true);
}
const heldMesh = (sim: HeadlessSim) => (sim.rules as unknown as { heldVisuals: Map<number, { coral: THREE.Mesh }> }).heldVisuals.get(sim.robot.id)!.coral;

describe('2025 CORAL scoring eject', () => {
  for (const geometry of ['cad', 'procedural'] as const) it(`${geometry}: every robot drives its CORAL out to the release pose before letting go`, () => {
    setCadModelsEnabled(geometry === 'cad');
    for (const team of season.teamRobots!) for (const level of [2, 4]) {
      const sim = make(team, season.testing!.scoringSpots('blue')[0]);
      sim.pool.hold(0, sim.robot.id); sim.robot.held.push(0);
      const m = (sim.rules as ReefscapeRules).mechanisms.get(sim.robot.id)!;
      let last = new THREE.Vector3(), ejecting = 0;
      for (let n = 0; n < 400 && sim.robot.held.includes(0); n++) {
        frame(sim, { ...IDLE_COMMAND, shoot: true, scoringLevel: level }, n * sim.physics.dt);
        if (!sim.robot.held.includes(0)) break;
        if ((m.eject ?? 0) > 0) ejecting++;
        last = heldMesh(sim).getWorldPosition(new THREE.Vector3());
      }
      expect(sim.robot.held.includes(0), `${team.id} L${level} released`).toBe(false);
      expect(ejecting * sim.physics.dt, `${team.id} L${level} eject time`).toBeCloseTo(EJECT_SECONDS, 1);
      const p = sim.pool.position(0);
      // One physics step of free flight after the last drawn frame.
      expect(last.distanceTo(new THREE.Vector3(p.x, p.y, p.z)), `${team.id} L${level}`).toBeLessThan(0.04);
    }
  }, 120000);
});

describe('2025 CORAL pickup', () => {
  it('a floor CORAL is drawn in from where it lay instead of appearing inside the robot', () => {
    for (const team of season.teamRobots!.filter((t) => t.config.intake.ground !== false)) {
      const sim = make(team, { x: 2.6, y: 4, yaw: 0 });
      for (let n = 0; n < 90; n++) frame(sim, { ...IDLE_COMMAND, intake: true });
      const P = sim.robot.pose;
      let spot: { x: number; y: number } | null = null;
      for (let r = 0.2; r < 1.2 && !spot; r += 0.02) for (let a = 0; a < Math.PI * 2 && !spot; a += Math.PI / 36) {
        const x = P.x + Math.cos(a) * r, y = P.y + Math.sin(a) * r;
        if (sim.robot.groundMouthContains(sim.frame.toWorld(x, y, C.CORAL_RADIUS), C.CORAL_RADIUS)) spot = { x, y };
      }
      expect(spot, team.id).not.toBeNull();
      sim.pool.placeField(0, spot!.x, spot!.y, C.CORAL_RADIUS);
      let lay = new THREE.Vector3(), first: THREE.Vector3 | null = null;
      for (let n = 0; n < 60 && !first; n++) {
        if (!sim.robot.held.includes(0)) { const p = sim.pool.position(0); lay = new THREE.Vector3(p.x, p.y, p.z); }
        frame(sim, { ...IDLE_COMMAND, intake: true });
        if (sim.robot.held.includes(0)) first = heldMesh(sim).getWorldPosition(new THREE.Vector3());
      }
      expect(first, `${team.id} picked up`).not.toBeNull();
      expect(first!.distanceTo(lay), team.id).toBeLessThan(0.03);
    }
  }, 120000);

  it("341 Miss Daisy's arm swings the short way from the handoff to its stowed pose, not up over the front", () => {
    setCadModelsEnabled(false);
    const team = season.teamRobots!.find((t) => t.id === 'miss-daisy-341')!;
    const sim = make(team, { x: 2.6, y: 4, yaw: 0 });
    sim.pool.hold(0, sim.robot.id); sim.robot.held.push(0);
    const m = (sim.rules as ReefscapeRules).mechanisms.get(sim.robot.id)!;
    m.handoff = 1e-6;
    let top = 0;
    for (let n = 0; n < 180; n++) {
      frame(sim);
      if (m.handoff === 0) top = Math.max(top, sim.robot.visual.worldToLocal(sim.robot.modelHeldAnchor!.getWorldPosition(new THREE.Vector3())).y);
    }
    expect(top).toBeLessThan(0.45);
  });
});

describe('arm motion helpers', () => {
  it('scoringSlew caps the speed of a large move and still settles on the target', () => {
    let x = 0;
    x = scoringSlew(x, 3, 6, 1 / 90);
    expect(x).toBeCloseTo(6 / 90, 6);
    for (let n = 0; n < 200; n++) x = scoringSlew(x, 3, 6, 1 / 90);
    expect(x).toBeCloseTo(3, 3);
  });
  it('nearestTurn picks the equivalent angle closest to the current one', () => {
    expect(nearestTurn(Math.PI + 0.9, -Math.PI / 2)).toBeCloseTo(-Math.PI + 0.9, 6);
    expect(nearestTurn(0.5, 0.4)).toBeCloseTo(0.5, 6);
  });
});
