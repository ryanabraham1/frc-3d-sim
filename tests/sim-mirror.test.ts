import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { beforeAll, expect, it } from 'vitest';
import { getSeason } from '../src/seasons';
import { defaultSettings } from '../src/app/menu';
import { localSetup } from '../src/engine/core/game';
import { MatchWorld, type WorldOptions } from '../src/engine/core/matchWorld';
import { MatchSim, botSettings } from '../src/engine/core/matchSim';
import { IDLE_COMMAND } from '../src/engine/robot/robot';
import { NODE_STRIDE, RobotMirror } from '../src/engine/sim/robotMirror';

beforeAll(() => RAPIER.init());

// The simulation worker and the page build the same world; the page's robots are posed from the worker's frames.
it('a replica world mirrors every robot model node of the simulated one', () => {
  const season = getSeason('2026-rebuilt');
  const settings = { ...defaultSettings(season), seed: 4 };
  const setup = localSetup(settings, season);
  const hooks = { toast() {}, cue() {}, humanPlayerIsAuto: () => true };
  const opts = (): WorldOptions => ({ scene: new THREE.Scene(), playerId: 0, realHopper: () => false, pieceFlow: true, optimize: true, aiSettings: botSettings(setup, settings) });
  const sim = new MatchWorld(RAPIER, season, setup, opts(), hooks);
  const view = new MatchWorld(RAPIER, season, setup, opts(), hooks);
  try {
    const authority = new MatchSim(sim, season, settings, { periodChange() {}, results() {} });
    const from = sim.robots.map((r) => new RobotMirror(r));
    const to = view.robots.map((r) => new RobotMirror(r, () => new THREE.Object3D()));
    expect(to.map((m) => m.shape)).toEqual(from.map((m) => m.shape));
    authority.state = 'running';
    sim.rules.onPeriodChange(sim.clock.start());
    for (let i = 0; i < 4 / authority.dt; i++) authority.step(authority.dt, { command: () => IDLE_COMMAND, humanPlayer: [] });
    for (let i = 0; i < from.length; i++) {
      sim.robots[i].syncVisual(1 / 60);
      const f = from[i].capture(true);
      to[i].applyDiscrete(f);
      to[i].applyNodes(f.nodes, f.nodes, 1);
      to[i].applyTokens(f.tokens, f.tokens, 1);
      // The AI robots drove off their start spots; the replica's chassis and every moving part followed.
      expect(view.robots[i].visual.position.distanceTo(sim.robots[i].visual.position)).toBeLessThan(1e-5);
      for (let n = 0; n < from[i].nodes.length; n++) {
        const a = from[i].nodes[n], b = to[i].nodes[n];
        expect(b.position.distanceTo(a.position)).toBeLessThan(1e-5);
        expect(Math.abs(b.quaternion.angleTo(a.quaternion))).toBeLessThan(2e-3); // float32 frames
        expect(b.visible).toBe(a.visible);
      }
      expect(f.nodes.length).toBe(from[i].nodes.length * NODE_STRIDE);
    }
    expect(sim.robots.some((r, i) => r.visual.position.distanceTo(new THREE.Vector3().fromArray(from[i].capture().nodes, 0)) < 1e-5)).toBe(true);
    // Blending halfway between two frames lands halfway.
    const m = to[1], a = m.capture().nodes, b = a.slice();
    b[0] += 0.4;
    m.applyNodes(a, b, 0.5);
    expect(m.nodes[0].position.x).toBeCloseTo(a[0] + 0.2, 5);
  } finally { sim.free(); view.free(); }
});
