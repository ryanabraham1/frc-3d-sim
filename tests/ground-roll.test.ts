/**
 * Rolling resistance on carpet (GamePieceSpec.rollingResistance): a rolling FUEL loses a near-constant Crr·g of speed,
 * so a harder hit rolls disproportionately farther (≈ v²) and the ball stops crisply instead of creeping for seconds.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { SEASONS } from '../src/seasons/index';
import { HeadlessSim } from '../src/engine/testing/headless';

beforeAll(async () => {
  await RAPIER.init();
});

/** Roll piece `i` across open neutral-zone carpet at `v0` (already rolling, no slip); distance and stop times. */
function rollOut(sim: HeadlessSim, i: number, v0: number) {
  const start = sim.frame.toWorld(5.8, 1.2, sim.pool.restHeight(i) + 0.002, new THREE.Vector3());
  const dir = sim.frame.toWorld(6.8, 1.2, 0, new THREE.Vector3()).sub(sim.frame.toWorld(5.8, 1.2, 0, new THREE.Vector3())).normalize();
  sim.pool.placeWorld(i, start, dir.clone().multiplyScalar(v0));
  const w = new THREE.Vector3(0, 1, 0).cross(dir).multiplyScalar(v0 / sim.pool.radiusAt(i));
  sim.pool.bodies[i].setAngvel({ x: w.x, y: w.y, z: w.z }, true);
  let slow = -1, stopped = -1, d = 0;
  for (let s = 0; s < 90 * 6 && stopped < 0; s++) {
    sim.pool.updateDamping();
    sim.physics.step();
    const p = sim.pool.position(i), v = sim.pool.velocity(i), sp = Math.hypot(v.x, v.z);
    d = Math.hypot(p.x - start.x, p.z - start.z);
    if (slow < 0 && sp < 0.1) slow = s / 90;
    if (stopped < 0 && sp < 0.02) stopped = s / 90;
  }
  sim.pool.reserve(i);
  return { d, slow, stopped };
}

describe('FUEL rolling on carpet', () => {
  it('rolls ≈ v² farther when hit harder and stops crisply', () => {
    const season = SEASONS.find((s) => s.id === '2026-rebuilt')!;
    expect(season.gamePiece.rollingResistance).toBeGreaterThan(0);
    const sim = new HeadlessSim(season, RAPIER, { robot: season.robotDefaults, alliance: 'blue', pose: { x: 1, y: 1, yaw: 0 } });
    try {
      const i = sim.pool.indices('reserve')[0];
      const nudge = rollOut(sim, i, 2), kick = rollOut(sim, i, 4);
      expect(nudge.d).toBeGreaterThan(0.8);
      expect(nudge.d).toBeLessThan(1.8);
      // Exponential damping gives distance ∝ v (ratio 2); constant rolling resistance gives ≈ v² (ratio near 4).
      expect(kick.d / nudge.d).toBeGreaterThan(2.6);
      for (const r of [nudge, kick]) {
        expect(r.stopped).toBeGreaterThan(0);
        expect(r.stopped).toBeLessThan(3);
        expect(r.stopped - r.slow).toBeLessThan(0.3); // no long creep at a crawl
      }
    } finally {
      sim.dispose();
    }
  });

  it('a ball with no rolling resistance keeps rolling (the loss is the model, not the contact solver)', () => {
    const base = SEASONS.find((s) => s.id === '2026-rebuilt')!;
    const season = { ...base, gamePiece: { ...base.gamePiece, rollingResistance: 0, groundDamping: 0, angularDamping: 0 } };
    const sim = new HeadlessSim(season, RAPIER, { robot: base.robotDefaults, alliance: 'blue', pose: { x: 1, y: 1, yaw: 0 } });
    try {
      const r = rollOut(sim, sim.pool.indices('reserve')[0], 1);
      expect(r.stopped).toBeLessThan(0);
      expect(r.d).toBeGreaterThan(5.5);
    } finally {
      sim.dispose();
    }
  });
});
