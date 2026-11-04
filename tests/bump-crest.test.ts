/** A FUEL balanced on a BUMP's ridge rolls off a ramp instead of sitting there asleep. */
import { beforeAll, expect, it } from 'vitest';
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { SEASONS } from '../src/seasons/index';
import { HeadlessSim } from '../src/engine/testing/headless';
import * as C from '../src/seasons/2026-rebuilt/constants';

beforeAll(async () => { await RAPIER.init(); });

it('FUEL on the ridge of a BUMP rolls off', () => {
  const season = SEASONS.find((s) => s.id === '2026-rebuilt')!;
  const sim = new HeadlessSim(season, RAPIER, { robot: season.robotDefaults, alliance: 'blue', pose: { x: 1, y: 1, yaw: 0 } });
  try {
    const yc = C.HUB_CENTER.y - (C.HUB_SIZE / 2 + C.BUMP_WIDTH / 2);
    const i = sim.pool.indices('reserve')[0];
    sim.pool.placeWorld(i, sim.frame.toWorld(C.HUB_CENTER.x, yc, C.BUMP_HEIGHT + sim.pool.restHeight(i) + 0.01, new THREE.Vector3()), new THREE.Vector3());
    sim.run(6);
    const p = sim.frame.toField(sim.pool.position(i));
    expect(Math.abs(p.x - C.HUB_CENTER.x)).toBeGreaterThan(0.3);
    expect(p.z).toBeLessThan(0.15);
  } finally {
    sim.dispose();
  }
});
