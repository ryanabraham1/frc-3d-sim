import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { SEASONS } from '../src/seasons';
import { cloneConfig } from '../src/engine/robot/config';
import { HeadlessSim } from '../src/engine/testing/headless';
import { IDLE_COMMAND } from '../src/engine/robot/robot';
import { CAD_MODEL_IDS, decodeCadModel, setCadModelsEnabled } from '../src/engine/robot/cadModels';
import { hubShotAngle, REBUILT_ACCURACY_RANGE } from '../src/seasons/2026-rebuilt/config';
import * as C from '../src/seasons/2026-rebuilt/constants';

const season = SEASONS.find((s) => s.id === '2026-rebuilt')!;
const sims: HeadlessSim[] = [];
beforeAll(async () => { await RAPIER.init(); });
afterEach(() => { for (const sim of sims.splice(0)) sim.dispose(); });
const deg = (r: number) => (r * 180) / Math.PI;

function sim(team: number, dx: number): HeadlessSim {
  const c = cloneConfig(season.teamRobots!.find((t) => t.team === team)!.config);
  const s = new HeadlessSim(season, RAPIER, { robot: c, alliance: 'blue', pose: { x: C.HUB_CENTER.x - dx, y: C.HUB_CENTER.y, yaw: 0 } });
  sims.push(s);
  return s;
}

/** Launch elevation the robot settles on while the driver holds shoot (nothing loaded, so nothing leaves). */
function settledAngle(team: number, dx: number): number {
  const s = sim(team, dx);
  s.robot.held.length = 0;
  s.run(0.6, { ...IDLE_COMMAND, shoot: true });
  return s.robot.lastShotAngle;
}

it('the shot map lobs close shots and flattens deep ones, keeping 60 deg at the accuracy range', () => {
  expect(deg(hubShotAngle(REBUILT_ACCURACY_RANGE))).toBeCloseTo(60, 6);
  expect(hubShotAngle(1.5)).toBeGreaterThan(hubShotAngle(3));
  expect(hubShotAngle(3)).toBeGreaterThan(hubShotAngle(5));
});

it.each([4414, 254, 581])('team %s sweeps its hood through ~25 deg of travel across the alliance zone', (team) => {
  const near = settledAngle(team, 1.4), mid = settledAngle(team, 3), far = settledAngle(team, 5.5);
  expect(deg(near - far)).toBeGreaterThan(22);
  expect(near).toBeGreaterThan(mid);
  expect(mid).toBeGreaterThan(far + 0.05);
});

it.each([7769, 9128, 6329])('fixed-hood team %s keeps one launch angle at every range', (team) => {
  expect(settledAngle(team, 1.6)).toBeCloseTo(settledAngle(team, 5), 6);
});

it('a dumper stages FUEL in its indexer lanes while shooting, drawn instead of the real hopper bodies', () => {
  const s = sim(254, 3);
  const r = s.robot;
  expect(r.bay).not.toBeNull();
  r.enablePieceFlow(() => new THREE.Mesh(new THREE.SphereGeometry(0.075)), true);
  s.load(30);
  s.run(0.5);
  r.syncVisual(1 / 60);
  expect(r.piecesInTransit).toBe(0);
  let staged = 0, hidden = 0, fired = 0;
  const start = r.held.length;
  for (let n = 0; n < 120; n++) {
    s.step({ ...IDLE_COMMAND, shoot: true });
    r.syncVisual(1 / 90);
    staged = Math.max(staged, r.piecesInTransit);
    hidden = Math.max(hidden, s.pool.drawnElsewhere.size);
    fired = start - r.held.length;
  }
  expect(fired).toBeGreaterThan(5);
  // Three lanes of several pieces each stand in line in front of the shooter.
  expect(staged).toBeGreaterThanOrEqual(6);
  expect(hidden).toBeGreaterThanOrEqual(6);
  // Every hidden body is still held: launched FUEL is always drawn.
  for (const i of s.pool.drawnElsewhere) expect(s.pool.state[i]).toBe('held');
  // Released, the indexer backs its pieces down into the hopper and the real bodies show again.
  for (let n = 0; n < 200; n++) { s.step(IDLE_COMMAND); r.syncVisual(1 / 90); }
  expect(r.piecesInTransit).toBe(0);
  expect(s.pool.drawnElsewhere.size).toBe(0);
});

it.each([254, 4414, 1987])('team %s intakes FUEL onto the pile surface instead of dropping it in from above', (team) => {
  const s = sim(team, 3);
  const r = s.robot;
  r.detachPool(s.pool); // the particle pile other robots and multiplayer replicas draw
  r.enablePieceFlow(() => new THREE.Mesh(new THREE.SphereGeometry(0.075)), true);
  r.enabled = true;
  r.held.length = 0;
  const pile = (r as unknown as { fuelPiles: THREE.InstancedMesh[] }).fuelPiles[0];
  const bin = pile.userData.fuelBin as { y0: number };
  const side = Math.sign(r.intakePath(null)[0].x) || -1;
  for (let i = 0; i < 30; i++) r.syncVisual(1 / 60);
  r.noteCapture(r.visual.localToWorld(new THREE.Vector3(side * (r.config.frameLength / 2 + 0.15), 0.075, 0)));
  r.held.push(-1);
  let first = NaN, floor = bin.y0;
  for (let f = 0; f < 200 && Number.isNaN(first); f++) {
    r.syncVisual(1 / 60);
    const surface = pile.userData.fuelSurface();
    if (surface.count > 0) {
      first = surface.positions[1];
      // Where a ball rests on the drawn parts at that spot (a rotor deck or floor plate above the bin's nominal floor):
      // dropped onto the floor there and lifted clear of the parts, as the pile itself does.
      const clearance = pile.userData.fuelPile.clearance, x = surface.positions[0], z = surface.positions[2];
      const rest = new Float32Array([x, bin.y0 + 0.075, z]);
      floor = Math.max(bin.y0, clearance?.floorAt(x, z) ?? -Infinity);
      rest[1] = floor + 0.075;
      if (clearance) { clearance.push(rest, 0, 0.0735, Infinity); floor = rest[1] - 0.075; }
    }
  }
  // An empty hopper: the ball arrives at floor level, not one ball higher with a drop onto the floor.
  expect(first - (floor + 0.075)).toBeLessThan(0.04);
});

describe('imported CAD hoods', () => {
  beforeAll(async () => {
    // 254 wears 581's shooter (adaptedDumper), so load that donor too.
    for (const id of [...CAD_MODEL_IDS, 'shooter-581-donor']) {
      const b = readFileSync(`public/models/robots/2026/${id}.glb`);
      await decodeCadModel(id, b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
    }
    setCadModelsEnabled(true);
  });
  afterAll(() => setCadModelsEnabled(false));

  /** Rotation of the robot's hood pivot once it has settled on a shot from `dx` metres out. */
  function hoodPose(team: number, dx: number): number {
    const s = sim(team, dx);
    s.robot.held.length = 0;
    for (let i = 0; i < 80; i++) { s.step({ ...IDLE_COMMAND, shoot: true }); s.robot.syncVisual(1 / 90); }
    let pivot: THREE.Object3D | undefined;
    s.robot.visual.traverse((o) => { if (!pivot && /hood.*pivot/.test(o.name)) pivot = o; });
    expect(pivot).toBeDefined();
    return pivot!.rotation.z;
  }

  // The hood visibly follows the whole shot map (~82 deg close to ~56 deg deep), not just its flatter half.
  it.each([2910, 254, 971, 1678, 1987, 6800, 9470])('team %s turns its hood through the whole shot range', (team) => {
    expect(deg(Math.abs(hoodPose(team, 1.2) - hoodPose(team, 5.5)))).toBeGreaterThan(22);
  });
});
