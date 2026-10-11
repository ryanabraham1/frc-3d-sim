import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { beforeAll, expect, it } from 'vitest';
import { SEASONS } from '../src/seasons';
import { HeadlessSim } from '../src/engine/testing/headless';
import { cloneConfig } from '../src/engine/robot/config';
import * as C from '../src/seasons/2026-rebuilt/constants';
import { side, dir, type RebuiltFieldRefs } from '../src/seasons/2026-rebuilt/field';

beforeAll(() => RAPIER.init());

const inch = (n: number) => n * 0.0254;

for (const alliance of ['blue', 'red'] as const) it(`${alliance} hub's rear net bulges under an overshot, catches it, and springs back flat`, () => {
  const season = SEASONS.find(s => s.id === '2026-rebuilt')!;
  const sim = new HeadlessSim(season, RAPIER, { robot: cloneConfig(season.robotDefaults), alliance, pose: { x: 1, y: 1, yaw: 0 } });
  try {
    const refs = (sim.rules as unknown as { refs: RebuiltFieldRefs }).refs;
    const [rear] = refs.hubs[alliance].nets;
    const hub = side(alliance, C.HUB_CENTER.x, C.HUB_CENTER.y), d = dir(alliance);
    const idx = sim.pool.indices('reserve')[0];
    // A ball flying level over the funnel, straight at the rear net, 0.3 m above the rim.
    const z = C.HUB_RIM_HEIGHT + 0.3;
    const start = sim.frame.toWorld(hub.x - d * 0.2, hub.y, z);
    const vel = sim.frame.velToWorld(d * 9, 0, 0, new THREE.Vector3());
    sim.pool.placeWorld(idx, start, vel);
    let deepest = 0, minX = Infinity;
    const rearPlane = hub.x + d * (C.HUB_SIZE / 2 + inch(1));
    for (let i = 0; i < 90; i++) {
      sim.step();
      deepest = Math.max(deepest, rear.bulge);
      const f = sim.frame.toField(sim.pool.bodies[idx].translation());
      minX = Math.min(minX, (rearPlane - f.x) * d);
    }
    // It pushed the net back several centimetres, never went through it, and lost its speed instead of rebounding hard.
    expect(deepest).toBeGreaterThan(0.04);
    expect(minX).toBeGreaterThan(-0.3 - 0.1);
    const v = sim.pool.bodies[idx].linvel();
    expect(Math.hypot(v.x, v.z)).toBeLessThan(4);
    expect(rear.netState()).not.toBeNull();
    // Left alone, the net settles flat again.
    sim.pool.reserve(idx);
    for (let i = 0; i < 4 / sim.physics.dt; i++) sim.step();
    expect(rear.bulge).toBeLessThan(0.002);
    expect(rear.netState()).toBeNull();
  } finally { sim.dispose(); }
});
