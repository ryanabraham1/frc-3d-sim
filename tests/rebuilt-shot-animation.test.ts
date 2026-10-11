import { afterEach, beforeAll, expect, it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { SEASONS } from '../src/seasons';
import { cloneConfig } from '../src/engine/robot/config';
import { HeadlessSim } from '../src/engine/testing/headless';
import { IDLE_COMMAND } from '../src/engine/robot/robot';
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
  let first = NaN;
  for (let f = 0; f < 200 && Number.isNaN(first); f++) {
    r.syncVisual(1 / 60);
    const surface = pile.userData.fuelSurface();
    if (surface.count > 0) first = surface.positions[1];
  }
  // An empty hopper: the ball arrives at floor level, not one ball higher with a drop onto the floor.
  expect(first - (bin.y0 + 0.075)).toBeLessThan(0.04);
});
