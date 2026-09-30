/**
 * 2026 OUTPOST supply rules [M 5.9.2, 6.8]: the CHUTE starts with 24 FUEL and is refilled ONLY by FUEL pushed
 * through the floor opening into the CORRAL. FUEL that leaves the FIELD any other way goes back onto the FIELD
 * near where it left — it never appears at an OUTPOST.
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { HeadlessSim } from '../src/engine/testing/headless';
import { cloneConfig } from '../src/engine/robot/config';
import { rebuilt2026 as season } from '../src/seasons/2026-rebuilt';
import type { RebuiltRules } from '../src/seasons/2026-rebuilt/rules';
import { side } from '../src/seasons/2026-rebuilt/field';
import * as C from '../src/seasons/2026-rebuilt/constants';

const sims: HeadlessSim[] = [];
beforeAll(async () => {
  await RAPIER.init();
});
afterEach(() => {
  for (const s of sims.splice(0)) s.dispose();
});

function match() {
  // Robot parked out of the way near the blue HUB.
  const sim = new HeadlessSim(season, RAPIER, { robot: cloneConfig(season.robotDefaults), alliance: 'blue', pose: { x: 3.2, y: 5.5, yaw: 0 } });
  sims.push(sim);
  sim.rules.stage();
  sim.rules.onPeriodChange(sim.ctx.clock.start());
  for (const ch of sim.ctx.clock.advance(25)) sim.rules.onPeriodChange(ch); // into TELEOP
  return { sim, rules: sim.rules as RebuiltRules };
}
const run = (sim: HeadlessSim, seconds: number) => {
  for (let n = 0; n < Math.round(seconds / sim.physics.dt); n++) {
    for (const ch of sim.ctx.clock.advance(sim.physics.dt)) sim.rules.onPeriodChange(ch);
    sim.step();
  }
};

describe('2026 OUTPOST supply', () => {
  for (const a of ['blue', 'red'] as const) {
    it(`${a}: an open CHUTE releases its 24 staged FUEL, then nothing more`, () => {
      const { sim, rules } = match();
      expect(rules.chuteCount(a)).toBe(C.FUEL_PER_CHUTE);
      const onField = sim.pool.countIn('field');
      rules.humanPlayerAction(a);
      run(sim, 20);
      expect(rules.chuteCount(a)).toBe(0);
      // Leave the door open and keep playing: the OUTPOST must stay empty.
      rules.chuteOpen[a] = true;
      run(sim, 15);
      expect(rules.chuteCount(a)).toBe(0);
      expect(sim.pool.countIn('field')).toBeLessThanOrEqual(onField + C.FUEL_PER_CHUTE);
    });
  }

  it('FUEL launched over the ALLIANCE WALL or a guardrail is put back on the FIELD near the exit, not in a CHUTE', () => {
    const { sim, rules } = match();
    const before = { red: rules.chuteCount('red'), blue: rules.chuteCount('blue') };
    const shots: [number, number][] = [];
    const reserve = sim.pool.indices('field'); // reuse staged FUEL
    // Over the blue alliance wall (away from the OUTPOST), and over both side guardrails.
    const exits: { from: [number, number, number]; vel: [number, number, number] }[] = [
      { from: [0.6, 4.0, 1.4], vel: [-5, 0, 2] },
      { from: [8.0, 0.6, 1.2], vel: [0, -4, 3] },
      { from: [9.0, 7.5, 1.2], vel: [0, 4, 3] },
    ];
    exits.forEach((e, k) => {
      const i = reserve[k];
      shots.push([i, k]);
      const w = sim.frame.toWorld(...e.from, new THREE.Vector3());
      sim.pool.placeWorld(i, w, sim.frame.velToWorld(...e.vel, new THREE.Vector3()));
    });
    run(sim, 3);
    expect({ red: rules.chuteCount('red'), blue: rules.chuteCount('blue') }).toEqual(before);
    for (const [i, k] of shots) {
      expect(sim.pool.state[i], `shot ${k}`).toBe('field');
      const f = sim.frame.toField(sim.pool.position(i));
      expect(f.x).toBeGreaterThan(0);
      expect(f.x).toBeLessThan(C.FIELD_LENGTH);
      expect(f.y).toBeGreaterThan(0);
      expect(f.y).toBeLessThan(C.FIELD_WIDTH);
      expect(Math.hypot(f.x - exits[k].from[0], f.y - exits[k].from[1]), `shot ${k} returned near its exit`).toBeLessThan(2.5);
    }
  });

  it('FUEL pushed through the CORRAL opening refills that alliance’s CHUTE', () => {
    const { sim, rules } = match();
    const before = rules.chuteCount('blue');
    const i = sim.pool.indices('field')[0]; // reuse a staged FUEL
    // Pushed over the 1.88 in lip, rolling through the blue CORRAL opening.
    const p = side('blue', -0.02, C.OUTPOST_CENTER_Y + 0.2);
    sim.pool.placeField(i, p.x, p.y, C.CORRAL_OPENING_Z + sim.pool.radius + 0.005);
    sim.pool.bodies[i].setLinvel(sim.frame.velToWorld(-2.5, 0, 0, new THREE.Vector3()), true);
    run(sim, 2);
    expect(rules.chuteCount('blue')).toBe(before + 1);
  });
});
