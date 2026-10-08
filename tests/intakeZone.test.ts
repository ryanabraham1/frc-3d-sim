import { beforeAll, expect, it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { HeadlessSim } from '../src/engine/testing/headless';
import { cloneConfig } from '../src/engine/robot/config';
import { intakeZoneContains } from '../src/engine/robot/robot';
import { Rng } from '../src/engine/random';
import { SEASONS } from '../src/seasons/index';

beforeAll(async () => {
  await RAPIER.init();
});

// Game.step tests every field piece against a frozen IntakeZone; it must agree with the per-piece methods.
it('IntakeZone matches intakeContains / stationContains for ground, station and both', () => {
  const rng = new Rng(7);
  let hits = 0;
  for (const season of SEASONS) {
    for (const variant of [
      { ground: true, station: false },
      { ground: false, station: true },
      { ground: true, station: true, back: true },
      { ground: true, station: true, groundFront: true },
    ]) {
      const cfg = cloneConfig(season.robotDefaults);
      cfg.intake = { ...cfg.intake, enabled: true, ground: variant.ground, station: variant.station, stationSide: variant.back ? 'back' : 'front', groundSide: variant.groundFront ? 'front' : 'back' };
      const sim = new HeadlessSim(season, RAPIER, { robot: cfg, alliance: 'blue', pose: { x: 5, y: 4, yaw: rng.range(-3, 3) } });
      const r = sim.robot;
      const z = r.intakeZone()!;
      const t = r.body.translation();
      for (let k = 0; k < 4000; k++) {
        const p = { x: t.x + rng.range(-1.2, 1.2), y: rng.range(0, 2), z: t.z + rng.range(-1.2, 1.2) };
        const want = (p.y <= 0.4 && r.intakeContains(p, 0.075)) || r.stationContains(p, 0.075);
        expect(intakeZoneContains(z, p, 0.075, 0.4)).toBe(want);
        if (want) hits++;
      }
      sim.dispose();
    }
  }
  expect(hits).toBeGreaterThan(100);
});

// The scoring mechanism (launcher / elevator) faces front, so every season's floor intake is on the BACK by default.
it('every season puts the floor intake on the back, opposite the scoring face', () => {
  for (const season of SEASONS) {
    expect(season.robotDefaults.intake.groundSide, season.id).toBe('back');
    for (const preset of season.robotPresets ?? []) {
      expect(preset.config.intake.groundSide, `${season.id}/${preset.id}`).toBe('back');
    }
  }
});

it('a back-mounted ground intake takes pieces behind the robot and ignores ones in front', () => {
  const season = SEASONS[0];
  const cfg = cloneConfig(season.robotDefaults);
  cfg.intake = { ...cfg.intake, enabled: true, ground: true, station: false, groundSide: 'back' };
  const sim = new HeadlessSim(season, RAPIER, { robot: cfg, alliance: 'blue', pose: { x: 5, y: 4, yaw: 0 } });
  const r = sim.robot;
  const t = r.body.translation();
  const half = r.footprint.length / 2;
  const at = (f: number) => ({ x: t.x + f, y: 0.05, z: t.z });
  expect(r.intakeContains(at(-(half + 0.05)), 0.075)).toBe(true);
  expect(r.intakeContains(at(half + 0.05), 0.075)).toBe(false);
  expect(r.intakeYawOffset).toBeCloseTo(Math.PI);
  sim.dispose();
});

it('protects balls at a short robot shooter while allowing balls outside its chassis', () => {
  const season = SEASONS.find(s => s.id === '2026-rebuilt')!;
  const cfg = cloneConfig(season.robotDefaults);
  cfg.height = 0.55;
  const sim = new HeadlessSim(season, RAPIER, { robot: cfg, alliance: 'blue', pose: { x: 5, y: 4, yaw: Math.PI / 2 } });
  const r = sim.robot, t = r.body.translation();
  expect(r.shieldsPiece({ x: t.x, y: t.y + cfg.height, z: t.z }, 0.075)).toBe(true);
  expect(r.shieldsPiece({ x: t.x, y: t.y + cfg.height + 0.2, z: t.z }, 0.075)).toBe(false);
  expect(r.shieldsPiece({ x: t.x + r.footprint.width, y: t.y + cfg.height, z: t.z }, 0.075)).toBe(false);
  sim.dispose();
});

it('prefers a higher shot arc while still reaching the target on descent', () => {
  const season = SEASONS.find(s => s.id === '2026-rebuilt')!;
  const sim = new HeadlessSim(season, RAPIER, { robot: cloneConfig(season.robotDefaults), alliance: 'blue', pose: { x: 5, y: 4, yaw: 0 } });
  const from = new THREE.Vector3(0, 0.6, 0);
  const target = { point: new THREE.Vector3(4, 1.8, 0) };
  const low = sim.robot.solveShot(from, target)!;
  const high = sim.robot.solveShot(from, { ...target, preferredAngle: Math.PI / 3 })!;
  expect(high.clear).toBe(true);
  expect(high.angle).toBeGreaterThan(low.angle);
  const arrival = sim.robot.simulateFlight(from.y, high.angle, high.speed, [4])[0]!;
  expect(arrival.y).toBeCloseTo(target.point.y, 1);
  expect(arrival.vy).toBeLessThan(0);
  sim.dispose();
});
