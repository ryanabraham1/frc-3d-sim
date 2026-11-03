/**
 * Quadratic air drag on airborne game pieces (GamePieceSpec.dragCoefficient): a real FUEL shot in Rapier slows the way
 * ½ρ·Cd·A·v² says, and the robot's shot solver predicts the same flight.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { SEASONS } from '../src/seasons/index';
import { HeadlessSim } from '../src/engine/testing/headless';
import { applyQuadraticDrag, quadraticDrag, throwVelocity } from '../src/engine/gamepiece/pool';

beforeAll(async () => {
  await RAPIER.init();
});

describe('air drag', () => {
  it('drag factor follows the FUEL spec (≈ 5 m/s² at 15 m/s)', () => {
    const k = quadraticDrag(SEASONS[0].gamePiece);
    expect(k * 15 * 15).toBeGreaterThan(4);
    expect(k * 15 * 15).toBeLessThan(7);
    expect(quadraticDrag({ ...SEASONS[0].gamePiece, dragCoefficient: undefined })).toBe(0);
  });

  it('never reverses a velocity, however large the step', () => {
    const v = { x: 40, y: -30, z: 10 };
    applyQuadraticDrag(v, 5, 1);
    expect(v.x).toBeGreaterThan(0);
    expect(v.y).toBeLessThan(0);
    expect(Math.hypot(v.x, v.y, v.z)).toBeLessThan(1 / 5 + 1e-9);
  });

  it('a FUEL shot in Rapier slows like the drag model and lands where the solver predicts', () => {
    const season = SEASONS[0];
    const sim = new HeadlessSim(season, RAPIER, { robot: season.robotDefaults, alliance: 'blue', pose: { x: 2, y: 2, yaw: 0 } });
    try {
      const i = sim.pool.indices('reserve')[0] ?? sim.pool.indices('field')[0];
      // High over the open field, flying down the field's length: nothing to hit for the whole flight.
      const start = sim.frame.toWorld(3, 6, 5, new THREE.Vector3());
      const dir = sim.frame.toWorld(4, 6, 5, new THREE.Vector3()).sub(start).normalize();
      const vh = 15, vy = 3;
      sim.pool.placeWorld(i, start, new THREE.Vector3(dir.x * vh, vy, dir.z * vh));
      const steps = 60; // 0.67 s, ≈ 9 m
      for (let s = 0; s < steps; s++) {
        sim.pool.updateDamping();
        sim.physics.step();
      }
      const p = sim.pool.position(i), v = sim.pool.velocity(i);
      const flown = Math.hypot(p.x - start.x, p.z - start.z);
      const horiz = Math.hypot(v.x, v.z);
      // Vacuum would keep 15 m/s (minus the small linear term); real drag takes ≈ 2.5 m/s off over this flight.

      expect(horiz).toBeLessThan(13.5);
      expect(horiz).toBeGreaterThan(11);
      const predicted = sim.robot.simulateFlight(start.y, Math.atan2(vy, vh), Math.hypot(vh, vy), [flown])[0]!;
      expect(predicted).not.toBeNull();
      // The solver's step order leaves ≈ 3 cm over 9 m with or without drag; drag itself adds no error.
      expect(Math.abs(predicted.y - p.y)).toBeLessThan(0.04);
    } finally {
      sim.dispose();
    }
  });

  it('a drag-aware throw lands on target where the vacuum throw falls short', () => {
    const season = SEASONS.find((x) => x.id === '2025-reefscape')!;
    const sim = new HeadlessSim(season, RAPIER, { robot: season.robotDefaults, alliance: 'blue', pose: { x: 2, y: 2, yaw: 0 } });
    try {
      const algae = season.gamePiece.variants![0];
      const i = algae.start;
      const spec = sim.pool.specAt(i);
      expect(quadraticDrag(spec)).toBeGreaterThan(0.05); // big light ball: much draggier than FUEL
      const from = sim.frame.toWorld(4, 3, 4, new THREE.Vector3());
      const to = sim.frame.toWorld(10, 3, 5, new THREE.Vector3());
      const flight = 1.35, steps = Math.round(flight / sim.physics.dt);
      const fly = (vel: THREE.Vector3) => {
        sim.pool.placeWorld(i, from, vel);
        for (let s = 0; s < steps; s++) { sim.pool.updateDamping(); sim.physics.step(); }
        const p = sim.pool.position(i);
        return Math.hypot(p.x - to.x, p.y - to.y, p.z - to.z);
      };
      const vacuum = new THREE.Vector3((to.x - from.x) / flight, (to.y - from.y + 4.905 * flight * flight) / flight, (to.z - from.z) / flight);
      expect(fly(vacuum)).toBeGreaterThan(0.4);
      expect(fly(throwVelocity(from, to, flight, spec, sim.physics.dt))).toBeLessThan(0.08); // Rapier's step order leaves a few cm
    } finally {
      sim.dispose();
    }
  });
});
