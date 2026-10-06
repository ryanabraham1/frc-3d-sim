import { expect, it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { SEASONS } from '../src/seasons';
import { HeadlessSim } from '../src/engine/testing/headless';
import { cloneConfig } from '../src/engine/robot/config';
import { IDLE_COMMAND } from '../src/engine/robot/robot';

const season = () => SEASONS.find(s => s.year === 2026)!;

it('held FUEL never exceeds what the drawn hopper can hold', async () => {
  await RAPIER.init();
  const s = season();
  for (const t of s.teamRobots!.slice(0, 8)) {
    const sim = new HeadlessSim(s, RAPIER, { robot: cloneConfig(t.config), alliance: 'blue', pose: { x: 2, y: 2, yaw: 0 } });
    try {
      let slots = 0; const parents = new Map<unknown, number>();
      sim.robot.visual.traverse((o: any) => { if (o.userData.fuelSlots) parents.set(o.parent, Math.max(parents.get(o.parent) ?? 0, o.userData.fuelSlots)); });
      for (const n of parents.values()) slots += n;
      if (slots) expect(sim.robot.config.hopperCapacity).toBeLessThanOrEqual(slots);
    } finally { sim.dispose(); }
  }
});

it('a tipped-over robot spills its FUEL and a hard stop throws some out', async () => {
  await RAPIER.init();
  const s = season();
  const make = () => new HeadlessSim(s, RAPIER, { robot: cloneConfig(s.robotDefaults), alliance: 'blue', pose: { x: 4, y: 4, yaw: 0 } });
  const tip = make();
  try {
    tip.load(15); tip.robot.enabled = true;
    const before = tip.robot.held.length;
    expect(before).toBeGreaterThan(5);
    tip.robot.body.setRotation({ x: 0.7071, y: 0, z: 0, w: 0.7071 }, true); // on its side
    for (let i = 0; i < 180; i++) tip.step(IDLE_COMMAND);
    expect(tip.robot.held.length).toBeLessThan(before);
  } finally { tip.dispose(); }
  const hit = make();
  try {
    hit.load(15); hit.robot.enabled = true;
    const before = hit.robot.held.length;
    for (let i = 0; i < 6; i++) { hit.robot.body.setLinvel({ x: 5, y: 0, z: 0 }, true); hit.step(IDLE_COMMAND); }
    hit.robot.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    for (let i = 0; i < 6; i++) hit.step(IDLE_COMMAND);
    expect(hit.robot.held.length).toBeLessThan(before);
  } finally { hit.dispose(); }
});
