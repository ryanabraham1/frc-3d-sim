import { expect, it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { SEASONS } from '../src/seasons';
import { HeadlessSim } from '../src/engine/testing/headless';
import type { HubImpact } from '../src/engine/audio/gameplayAudio';
import { HUB_CENTER, HUB_RIM_HEIGHT } from '../src/seasons/2026-rebuilt/constants';
import { cloneConfig } from '../src/engine/robot/config';

it('emits bounded physical hub impacts for a falling ball, and stays quiet for carpet and reserve balls', async () => {
  await RAPIER.init();
  const season = SEASONS.find(s => s.id === '2026-rebuilt')!;
  const sim = new HeadlessSim(season, RAPIER, { robot: cloneConfig(season.robotDefaults), alliance: 'blue', pose: { x: 2, y: 2, yaw: 0 } });
  const hits: HubImpact[] = [];
  sim.ctx.hubImpact = hit => hits.push(hit);
  try {
    // Isolate a single ball: existing staged balls cannot accidentally satisfy the assertion.
    for (let i = 0; i < sim.pool.count; i++) sim.pool.reserve(i);
    sim.pool.placeField(0, HUB_CENTER.x - 0.2, HUB_CENTER.y + 0.25, HUB_RIM_HEIGHT + 0.7);
    for (let i = 0; i < 180; i++) sim.step();
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.length).toBeLessThan(20);
    expect(hits.every(hit => hit.speed > 0.8 && hit.y > 0.3)).toBe(true);
    const count = hits.length;
    sim.pool.reserve(0);
    sim.pool.placeField(1, 2, 2, 2);
    for (let i = 0; i < 180; i++) sim.step();
    expect(hits).toHaveLength(count);
  } finally { sim.dispose(); }
});
