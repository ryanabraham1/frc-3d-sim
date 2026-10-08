import { expect, it } from 'vitest';
import { FuelPile } from '../src/engine/robot/fuelPile';

const still = { dt: 1 / 60, time: 0, enabled: false, intaking: false, firing: 0, passing: false, aiming: false, hood: 0, fill: 0, climb: 0, blocker: 0, place: null, vx: 0, vz: 0, omega: 0 };

it('an open hopper keeps its load when an intake-side extension retracts under it (no preload dumped on the field)', () => {
  const r = 0.075;
  const bin = { x: -0.2, y0: 0.17, length: 0.66, width: 0.7, height: 0.37 };
  // One floor layer spread over the full, deployed bin, as the preload is laid out.
  const seeds = [-0.45, -0.3, -0.15, 0, 0.08].flatMap(x => [-0.2, 0.2].map(z => ({ x, y: bin.y0 + r, z, s: 1 })));
  const pile = new FuelPile(bin, seeds, r);
  pile.open = true;
  pile.setCount(8);
  // The extension retracts: the bin's intake end moves in 0.2 m, leaving balls beside the new wall.
  Object.assign(bin, { x: -0.1, length: 0.46 });
  let escaped = 0;
  for (let i = 0; i < 120; i++) pile.step({ ...still, time: i / 60 }, () => escaped++);
  expect(escaped).toBe(0);
  expect(pile.size).toBe(8);
  for (let i = 0; i < pile.size; i++) expect(pile.positions[i * 3]).toBeGreaterThanOrEqual(bin.x - bin.length / 2);
});

it('an open hopper still spills a ball that clears the rim and side wall', () => {
  const r = .075, bin = { x: 0, y0: .17, length: .66, width: .7, height: .37 };
  const pile = new FuelPile(bin, [{ x: 0, y: .25, z: 0, s: 1 }], r);
  pile.open = true;
  pile.setCount(1);
  pile.positions.set([.4, bin.y0 + bin.height + .05, 0]);
  let escaped = 0;
  pile.step(still, () => escaped++);
  expect(escaped).toBe(1);
  expect(pile.size).toBe(0);
});
