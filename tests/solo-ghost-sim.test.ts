/** Ghost recording through the real match loop, and the ghost's model staying out of the physics. */
import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { beforeAll, expect, it } from 'vitest';
import { defaultSettings } from '../src/app/menu';
import { FieldFrame } from '../src/engine/coords';
import { localSetup } from '../src/engine/core/game';
import { MatchSim, botSettings } from '../src/engine/core/matchSim';
import { MatchWorld } from '../src/engine/core/matchWorld';
import { boardRobots } from '../src/engine/ghost/board';
import { GHOST_HZ, POSE_STRIDE, type GhostRun } from '../src/engine/ghost/format';
import { ghostModel } from '../src/engine/ghost/ghostLayer';
import { cloneConfig } from '../src/engine/robot/config';
import { IDLE_COMMAND } from '../src/engine/robot/robot';
import { getSeason } from '../src/seasons';

beforeAll(() => RAPIER.init());

/** REBUILT with every period cut to a sliver, driven forward for the whole match. */
function play(boost: boolean): { run: GhostRun | null; seconds: number; x0: number; x1: number; world: MatchWorld } {
  const full = getSeason('2026-rebuilt');
  const season = { ...full, timeline: full.timeline.map((p) => ({ ...p, duration: p.duration / 40 })) };
  const settings = { ...defaultSettings(season), seed: 3, aiOpponents: false, robot: cloneConfig(boardRobots(full)[0].config) };
  const setup = localSetup(settings, season);
  const world = new MatchWorld(RAPIER, season, setup, { scene: new THREE.Scene(), playerId: setup.robots[0].id, realHopper: () => false, pieceFlow: false, optimize: false, aiSettings: botSettings(setup, settings) }, { toast() {}, cue() {}, humanPlayerIsAuto: () => true });
  let run: GhostRun | null = null;
  let finished = false;
  const sim = new MatchSim(world, season, settings, { periodChange() {}, results() { finished = true; }, ghost: (r) => { run = r; } }, { ghost: true });
  if (boost) sim.setBoost(world.player, true);
  sim.setBoost(world.player, false);
  const x0 = world.player!.body.translation().x;
  while (!finished) sim.step(sim.dt, { command: () => ({ ...IDLE_COMMAND, vx: 1.5 }), humanPlayer: [] });
  return { run, seconds: world.clock.elapsed, x0, x1: world.player!.body.translation().x, world };
}

it('records the driver on the match clock and hands the run over before the results', () => {
  const { run, seconds, x0, x1, world } = play(false);
  expect(run).not.toBeNull();
  const r = run! as GhostRun;
  const n = r.poses.length / POSE_STRIDE;
  expect(n).toBeGreaterThan(seconds * GHOST_HZ - 3);
  expect(n).toBeLessThan(seconds * GHOST_HZ + 3);
  expect(r.alliance).toBe(world.player!.alliance);
  // The recording follows the world-frame body, from the start of the match to its end.
  expect(Math.abs(r.poses[0] - x0)).toBeLessThan(0.5);
  expect(Math.abs(r.poses[(n - 1) * POSE_STRIDE] - x1)).toBeLessThan(0.5);
  expect(r.score).toBe(world.score.total(world.player!.alliance));
  world.free();
});

it('a match that used the practice boost is not a run', () => {
  const { run, world } = play(true);
  expect(run).toBeNull();
  world.free();
});

it('a ghost model has no body in the match and takes the ghost material everywhere', () => {
  const season = getSeason('2026-rebuilt');
  const material = new THREE.MeshBasicMaterial();
  const model = ghostModel(RAPIER, season, new FieldFrame(season.fieldLength, season.fieldWidth), boardRobots(season)[0].config, 'blue', material);
  expect(model.parent).toBeNull();
  let meshes = 0;
  model.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    meshes++;
    expect(o.material).toBe(material);
    expect(o.castShadow).toBe(false);
  });
  expect(meshes).toBeGreaterThan(3);
});
