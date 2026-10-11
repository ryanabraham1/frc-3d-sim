import { expect, it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { SEASONS } from '../src/seasons';
import { HeadlessSim } from '../src/engine/testing/headless';
import { cloneConfig } from '../src/engine/robot/config';
import * as C from '../src/seasons/2026-rebuilt/constants';
import { side, dir } from '../src/seasons/2026-rebuilt/field';
import { HUB_SENSOR_FLOOR_Z } from '../src/seasons/2026-rebuilt/hubStructure';

for (const alliance of ['blue', 'red'] as const) it(`${alliance} hub returns the scored ball through the low opening without changing the return speed`, async () => {
  await RAPIER.init();
  const season = SEASONS.find(s => s.id === '2026-rebuilt')!;
  const sim = new HeadlessSim(season, RAPIER, {robot: cloneConfig(season.robotDefaults), alliance, pose:{x:2,y:2,yaw:0}, log:true});
  try {
    const idx = sim.pool.indices('reserve')[0], hub = side(alliance, C.HUB_CENTER.x, C.HUB_CENTER.y);
    const total = sim.pool.count;
    sim.pool.placeField(idx, hub.x, hub.y, HUB_SENSOR_FLOOR_Z + sim.pool.radius + .01);
    sim.step();
    expect(sim.pool.state[idx]).toBe('reserve');
    for (let i = 0; i < 300 && sim.pool.state[idx] !== 'field'; i++) sim.step();
    expect(sim.pool.state[idx]).toBe('field');
    const p = sim.frame.toField(sim.pool.bodies[idx].translation());
    expect(p.z).toBeLessThan(C.HUB_EXIT_HEIGHT + .005);
    expect(p.z - sim.pool.radius).toBeGreaterThan(0);
    expect(p.z + sim.pool.radius).toBeLessThan(C.HUB_EXIT_HEIGHT + .0889);
    expect((p.x - hub.x) * dir(alliance)).toBeGreaterThan(C.HUB_SIZE / 2);
    const v = sim.pool.bodies[idx].linvel();
    expect(Math.abs(v.y)).toBeLessThan(.2);
    expect(Math.hypot(v.x, v.z)).toBeLessThan(3.25);
    expect(sim.pool.count).toBe(total);
  } finally { sim.dispose(); }
});
