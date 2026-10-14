import { expect, it } from 'vitest';
import { FuelPile } from '../src/engine/robot/fuelPile';

const still = { dt: 1 / 60, time: 0, enabled: false, intaking: false, firing: 0, passing: false, aiming: false, hood: 0, fill: 0, climb: 0, blocker: 0, place: null, vx: 0, vz: 0, omega: 0 };

it('a load too big for its bin (net-roofed hopper at binder capacity) still comes to rest instead of jittering forever', () => {
  const r = 0.075, bin = { x: 0, y0: 0.09, length: 0.5, width: 0.5, height: 0.5, ceiling: (() => 0.5) as (x: number, z: number) => number };
  // 3 x 3 x 5 balls at 1.3 radii spacing: far denser than real FUEL can pack under this roof.
  const seeds: { x: number; y: number; z: number; s: number }[] = [];
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 7; k++) seeds.push({ x: (i - 1) * 0.18, y: bin.y0 + r + k * 0.1, z: (j - 1) * 0.18, s: 1 });
  const pile = new FuelPile(bin, seeds, r);
  pile.setCount(seeds.length);
  for (let i = 0; i < 60 * 4; i++) pile.step({ ...still, time: i / 60 });
  let moved = 0;
  for (let i = 0; i < 60; i++) if (pile.step({ ...still, time: i / 60 })) moved++;
  expect(moved).toBe(0);
  const settled = Array.from(pile.positions);
  for (let i = 0; i < 60; i++) pile.step(still);
  expect(Array.from(pile.positions)).toEqual(settled);
  // New work still wakes it.
  pile.setCount(seeds.length - 1);
  expect(pile.step(still)).toBe(true);
});
