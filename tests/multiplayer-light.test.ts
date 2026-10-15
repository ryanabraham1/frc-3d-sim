import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { beforeAll, expect, it } from 'vitest';
import { getSeason } from '../src/seasons';
import { defaultSettings } from '../src/app/menu';
import { localSetup } from '../src/engine/core/game';
import { MatchWorld } from '../src/engine/core/matchWorld';
import { MatchSim } from '../src/engine/core/matchSim';
import { IDLE_COMMAND } from '../src/engine/robot/robot';
import { FuelPile } from '../src/engine/robot/fuelPile';

beforeAll(() => RAPIER.init());

it('six loaded multiplayer robots use no hopper bodies, keep field physics and can shoot with intake on', () => {
  const season = getSeason('2026-rebuilt');
  const settings = { ...defaultSettings(season), aiOpponents: true };
  const setup = localSetup(settings, season);
  const scene = new THREE.Scene();
  const world = new MatchWorld(RAPIER, season, setup, {
    scene, playerId: 0, realHopper: () => true, lightweight: true,
    pieceFlow: true, optimize: false, aiSettings: settings,
  }, { toast() {}, cue() {}, humanPlayerIsAuto: () => false });
  try {
    expect(world.robots).toHaveLength(6);
    expect(world.physics.dt).toBe(1 / 90);
    const sim = new MatchSim(world, season, settings, { periodChange() {}, results() {} });
    sim.state = 'running';
    world.rules.onPeriodChange(world.clock.start());
    const piles: FuelPile[] = [];
    for (const robot of world.robots) {
      expect(robot.bay).toBeNull();
      expect(robot.mech).toBeNull();
      for (let n = robot.held.length; n < 15; n++) {
        const id = world.pool.state.findIndex(state => state === 'reserve');
        expect(id).toBeGreaterThanOrEqual(0);
        world.pool.hold(id, robot.id);
        robot.held.push(id);
      }
      robot.visual.traverse(o => { if (o.userData.fuelPile) piles.push(o.userData.fuelPile); });
      robot.syncVisual(1 / 60);
    }
    expect(piles.length).toBeGreaterThan(0);
    expect(piles.every(p => p.lite)).toBe(true);
    const before = world.robots.reduce((n, r) => n + r.held.length, 0);
    for (let n = 0; n < 180; n++) {
      sim.step(sim.dt, { command: () => ({ ...IDLE_COMMAND, shoot: true, intake: true }), humanPlayer: [] });
      if (n % 2 === 0) world.robots.forEach(r => r.syncVisual(1 / 45));
    }
    expect(world.robots.reduce((n, r) => n + r.held.length, 0)).toBeLessThan(before);
    expect(world.robots.every(r => r.squeeze === 0)).toBe(true);
    expect(piles.every(p => p.clearance === undefined && p.moving.length === 0)).toBe(true);
    // Concurrent solo piles retain their own full visual solver budget.
    const solo = new FuelPile({ x: 0, y0: 0, length: 1, width: 1, height: 1 }, [], .075);
    expect(solo.lite).toBe(false);
  } finally { world.free(); }
});
