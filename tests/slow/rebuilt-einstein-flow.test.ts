/** Einstein throughput through the actual browser/worker MatchSim, including moving-shot actuator lag. */
import { expect, it } from 'vitest';
import { writeFileSync } from 'node:fs';
import * as THREE from 'three';
import { defaultSettings } from '../../src/app/menu';
import { loadRapier } from '../../src/engine/physics/world';
import { SEASONS } from '../../src/seasons';
import { localSetup } from '../../src/engine/core/game';
import { MatchWorld } from '../../src/engine/core/matchWorld';
import { MatchSim } from '../../src/engine/core/matchSim';
import { IDLE_COMMAND } from '../../src/engine/robot/robot';

it('Einstein sustains productive AUTO and repeated scoring cycles across three seeds', async () => {
  const R = await loadRapier(), season = SEASONS.find(s => s.id === '2026-rebuilt')!;
  let fuel = 0, autoFuel = 0;
  const metrics: { seed: number; blue: number; red: number; autoBlue: number; autoRed: number; robotPoints: number[]; fouls: number }[] = [];
  for (const seed of [1, 2, 3]) {
    let random = 0x2f6e2b1;
    const previousRandom = Math.random;
    Math.random = () => { random = (Math.imul(random, 1664525) + 1013904223) >>> 0; return random / 4294967296; };
    const archetypes = { 1: 'ripcurrent-4414', 2: 'madtown-2026-1323', 3: 'reblitz-2910' };
    const robot = season.teamRobots!.find(r => r.config.model === archetypes[1])!.config;
    const settings = { ...defaultSettings(season), robot, seed, aiDifficulty: 'einstein' as const,
      aiAlly: { skill: 'einstein' as const, archetypes }, aiOpponent: { skill: 'einstein' as const, archetypes } };
    const setup = localSetup(settings, season);
    Object.assign(setup.robots[0], { bot: true, manualAuto: false, autoRoutine: 'shoot-depot' });
    const world = new MatchWorld(R, season, setup, { scene: new THREE.Scene(), playerId: 0,
      realHopper: () => false, pieceFlow: false, optimize: false, aiSettings: settings },
    { toast() {}, cue() {}, humanPlayerIsAuto: () => true });
    try {
      const sim = new MatchSim(world, season, settings, { periodChange() {}, results() {} });
      while (sim.state !== 'results') sim.step(sim.dt, { command: () => ({ ...IDLE_COMMAND }), humanPlayer: [] });
      metrics.push({ seed,
        blue: (world.score.points.blue.fuelAuto ?? 0) + (world.score.points.blue.fuelTeleop ?? 0),
        red: (world.score.points.red.fuelAuto ?? 0) + (world.score.points.red.fuelTeleop ?? 0),
        autoBlue: world.score.points.blue.fuelAuto ?? 0, autoRed: world.score.points.red.fuelAuto ?? 0,
        robotPoints: world.robots.map(r => Object.values(world.score.robots[r.id]?.points ?? {}).reduce((a, b) => a + b, 0)),
        fouls: world.score.fouls.length });
      if (process.env.REBUILT_BENCH_OUT) writeFileSync(process.env.REBUILT_BENCH_OUT, JSON.stringify(metrics, null, 2));
      for (const alliance of ['blue', 'red'] as const) {
        const categories = world.score.points[alliance];
        fuel += (categories.fuelAuto ?? 0) + (categories.fuelTeleop ?? 0);
        autoFuel += categories.fuelAuto ?? 0;
        expect(world.score.foulPointsFor(alliance)).toBeLessThan(world.score.total(alliance) * 0.15);
      }
      for (const r of world.robots) expect(Object.values(world.score.robots[r.id]?.points ?? {}).reduce((a, b) => a + b, 0)).toBeGreaterThan(50);
      expect(world.score.fouls.some(f => f.rule === 'G403')).toBe(false);
    } finally { world.free(); Math.random = previousRandom; }
  }
  // Old policy: 2,544 fuel / 292 AUTO across these seeds in the production simulator.
  // Require a material improvement without assuming every collision plays out identically.
  expect(fuel).toBeGreaterThan(3000);
  expect(autoFuel).toBeGreaterThan(450);
}, 600_000);
