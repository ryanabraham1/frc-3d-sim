import { expect, it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { SEASONS } from '../src/seasons';
import { HeadlessSim } from '../src/engine/testing/headless';
import { cloneConfig } from '../src/engine/robot/config';
import { IDLE_COMMAND } from '../src/engine/robot/robot';
import { classifyDevice, QualityGovernor } from '../src/engine/core/quality';

it('classifies devices by cores, memory, touch and GPU', () => {
  expect(classifyDevice({ cores: 12, memoryGb: 8, gpu: 'ANGLE (Apple, Apple M2)' })).toBe('high');
  expect(classifyDevice({ cores: 8 })).toBe('high'); // Safari reports no memory
  expect(classifyDevice({ cores: 8, memoryGb: 8, touch: true })).toBe('medium'); // tablets throttle
  expect(classifyDevice({ cores: 4, memoryGb: 4 })).toBe('medium');
  expect(classifyDevice({ cores: 2, memoryGb: 2 })).toBe('low');
  expect(classifyDevice({ cores: 8, memoryGb: 8, gpu: 'Google SwiftShader' })).toBe('low');
  expect(classifyDevice({ cores: 8, memoryGb: 8, gpu: 'ANGLE (Intel, Intel(R) UHD Graphics 620)' })).toBe('medium');
});

it('governor sheds hoppers after sustained sim load, shadows after sustained low fps, with a cooldown', () => {
  const g = new QualityGovernor();
  const out: (string | null)[] = [];
  for (let i = 0; i < 4; i++) out.push(g.update(0.9, 60));
  expect(out).toEqual([null, null, null, 'hopper']);
  expect(g.update(0.9, 60)).toBeNull(); // cooling down
  const h = new QualityGovernor();
  let shed: string | null = null;
  for (let i = 0; i < 14 && !shed; i++) shed = h.update(0.1, 20);
  expect(shed).toBe('shadows');
  const calm = new QualityGovernor();
  for (let i = 0; i < 40; i++) expect(calm.update(0.2, 60)).toBeNull();
});

it('a full hopper can be shed to the particle pile mid-match without losing a ball', async () => {
  await RAPIER.init();
  const season = SEASONS.find((s) => s.year === 2026)!;
  const sim = new HeadlessSim(season, RAPIER, { robot: cloneConfig(season.robotDefaults), alliance: 'blue', pose: { x: 4, y: 4, yaw: 0 } });
  try {
    const r = sim.robot;
    r.enabled = true;
    sim.load(r.config.hopperCapacity);
    for (let k = 0; k < 120; k++) sim.step(IDLE_COMMAND);
    expect(r.bay!.count).toBe(r.held.length);
    const held = r.held.length;
    r.detachPool(sim.pool);
    expect(r.bay).toBeNull();
    expect(sim.pool.bays.has(r.id)).toBe(false);
    for (const i of r.held) expect(sim.pool.bodies[i].isEnabled()).toBe(false);
    for (let k = 0; k < 60; k++) { sim.step(IDLE_COMMAND); r.syncVisual(1 / 45); }
    expect(r.held.length).toBe(held);
    // It still shoots: the pool pops a held piece and launches it.
    const before = r.held.length;
    for (let k = 0; k < 90 && r.held.length === before; k++) sim.step({ ...IDLE_COMMAND, shoot: true });
    expect(r.held.length).toBeLessThan(before);
  } finally { sim.dispose(); }
}, 60000);
