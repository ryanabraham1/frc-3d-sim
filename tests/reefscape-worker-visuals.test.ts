import { readFileSync } from 'node:fs';
import { beforeAll, expect, it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { MatchWorld } from '../src/engine/core/matchWorld';
import { cloneConfig } from '../src/engine/robot/config';
import { CAD_2025_MODEL_IDS, decodeCadModel, setCadModelsEnabled } from '../src/engine/robot/cadModels';
import { RobotMirror } from '../src/engine/sim/robotMirror';
import { syncWorldVisuals } from '../src/engine/sim/worldVisuals';
import { reefscape2025 as season } from '../src/seasons/2025-reefscape';
import * as C from '../src/seasons/2025-reefscape/constants';
import { defaultSettings } from '../src/app/menu';

beforeAll(async () => {
  await RAPIER.init();
  for (const id of CAD_2025_MODEL_IDS) {
    const b = readFileSync(`public/models/robots/2025/${id}.glb`);
    await decodeCadModel(id, b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
  }
}, 60000);

for (const cad of [true, false]) it(`${cad ? 'CAD' : 'procedural'} worker frames preserve possession and gripper seating for the entire 2025 roster`, () => {
  setCadModelsEnabled(cad);
  const make = () => new MatchWorld(RAPIER, season, {
    seed: 4, seasonId: season.id, autoHumanPlayer: false, peers: [],
    robots: season.teamRobots!.map((team, id) => ({ id, config: cloneConfig(team.config), alliance: 'blue' as const, station: 2, start: { x: 2, y: 4, yaw: 0 }, slot: 'blue2' as const, autoRoutine: '', manualAuto: true, peerId: '', name: team.name })),
  }, { scene: new THREE.Scene(), playerId: 0, realHopper: () => false, pieceFlow: false, optimize: false, aiSettings: defaultSettings(season) }, { toast() {}, cue() {}, humanPlayerIsAuto: () => false });
  const sim = make(), view = make();
  try {
    const from = sim.robots.map(r => new RobotMirror(r)), to = view.robots.map(r => new RobotMirror(r));
    const pieces = (world: MatchWorld, id: number) => (world.rules as unknown as { heldVisuals: Map<number, { coral: THREE.Mesh; algae: THREE.Mesh }> }).heldVisuals.get(id)!;
    expect(from.map(m => m.shape)).toEqual(to.map(m => m.shape));
    for (const r of sim.robots) expect(pieces(sim, r.id).algae.visible).toBe(false);
    for (const [coral, algae] of [[false, false], [true, false], [false, true], [true, true], [false, false]]) {
      for (let i = 0; i < sim.pool.count; i++) sim.pool.reserve(i);
      for (const r of sim.robots) {
        r.held.length = 0;
        if (coral) { sim.pool.hold(r.id, r.id); r.held.push(r.id); }
        if (algae) { sim.pool.hold(C.CORAL_COUNT + r.id, r.id); r.held.push(C.CORAL_COUNT + r.id); }
      }
      // The page attaches its seasonal meshes to the same tools before applying the worker frame.
      for (let i = 0; i < sim.pool.count; i++) view.pool.applyReplicaState(i, sim.pool.state[i], sim.pool.owner[i], sim.pool.tag[i]);
      for (const r of view.robots) r.applyNet(sim.robots[r.id].netState());
      view.rules.updateVisuals(1 / 60, 0);
      syncWorldVisuals(sim, 1 / 60, 0, false);
      for (let i = 0; i < from.length; i++) {
        const f = from[i].capture(true);
        // A page pickup can be a frame behind or ahead of the worker's transfer, including a different parent.
        view.robots[i].visual.add(pieces(view, i).coral);
        to[i].applyDiscrete(f); to[i].applyNodes(f.nodes, f.nodes, 1);
        const actual = pieces(view, i), expected = pieces(sim, i), r = view.robots[i];
        expect(actual.coral.visible, `${r.config.model} coral`).toBe(coral);
        expect(actual.algae.visible, `${r.config.model} algae`).toBe(algae);
        if (r.modelAlgaeAnchor) {
          expect(actual.algae.parent).toBe(r.modelAlgaeAnchor);
          expect(actual.algae.getWorldPosition(new THREE.Vector3()).distanceTo(r.modelAlgaeAnchor.getWorldPosition(new THREE.Vector3()))).toBeLessThan(1e-6);
        }
        expect(actual.coral.getWorldPosition(new THREE.Vector3()).distanceTo(expected.coral.getWorldPosition(new THREE.Vector3()))).toBeLessThan(1e-5);
        expect(Array.from(actual.algae.geometry.getAttribute('position').array)).toEqual(Array.from(expected.algae.geometry.getAttribute('position').array));
      }
    }
  } finally { sim.free(); view.free(); setCadModelsEnabled(true); }
}, 120000);

it('a worker view preserves the rendered CORAL pose while newer possession state is already received', () => {
  const world = new MatchWorld(RAPIER, season, {
    seed: 4, seasonId: season.id, autoHumanPlayer: false, peers: [],
    robots: [{ id: 0, config: cloneConfig(season.teamRobots![0].config), alliance: 'blue', station: 2, start: { x: 2, y: 4, yaw: 0 }, slot: 'blue2', autoRoutine: '', manualAuto: true, peerId: '', name: 'Test' }],
  }, { scene: new THREE.Scene(), playerId: 0, realHopper: () => false, pieceFlow: false, optimize: false, aiSettings: defaultSettings(season) }, { toast() {}, cue() {}, humanPlayerIsAuto: () => false });
  try {
    const held = (world.rules as unknown as { heldVisuals: Map<number, { coral: THREE.Mesh }> }).heldVisuals.get(0)!.coral;
    world.robots[0].visual.add(held);
    held.position.set(.4, 1.8, 0);
    held.visible = true;
    world.rules.updateVisuals(1 / 60, 0, true);
    expect(held.parent).toBe(world.robots[0].visual);
    expect(held.position.toArray()).toEqual([.4, 1.8, 0]);
    expect(held.visible).toBe(true);
  } finally { world.free(); }
});
