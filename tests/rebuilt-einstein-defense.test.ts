import { beforeAll, expect, it } from 'vitest';
import { loadRapier, type RapierModule } from '../src/engine/physics/world';
import { HeadlessSim } from '../src/engine/testing/headless';
import { SEASONS } from '../src/seasons';
import type { RebuiltRules } from '../src/seasons/2026-rebuilt/rules';
import * as C from '../src/seasons/2026-rebuilt/constants';
let R: RapierModule;
beforeAll(async () => { R = await loadRapier(); });

it.each(['player', 'bot'] as const)('assigns a loaded hunter past an empty teammate only for a human target (%s)', controller => {
  const season = SEASONS.find(s => s.id === '2026-rebuilt')!;
  const config = season.botRobotConfig!('hard');
  const sim = new HeadlessSim(season, R, { robot: config, alliance: 'blue', station: 2, pose: { x: 2.7, y: C.HUB_CENTER.y, yaw: 0 },
    extraRobots: [
      { config, alliance: 'red', id: 1, station: 2, pose: { x: C.FIELD_LENGTH - 1.9, y: C.HUB_CENTER.y, yaw: Math.PI } },
      { config, alliance: 'red', id: 2, station: 1, pose: { x: 4, y: C.HUB_CENTER.y, yaw: Math.PI } },
    ] });
  try {
    sim.ctx.settings.aiOpponent = { skill: 'einstein' };
    sim.robot.controller = controller;
    sim.rules.stage();
    sim.rules.onPeriodChange(sim.ctx.clock.start());
    for (const change of sim.ctx.clock.advance(33.5)) sim.rules.onPeriodChange(change);
    (sim.rules as RebuiltRules).firstInactive = 'red';
    const hunter = sim.ctx.robots[1], empty = sim.ctx.robots[2];
    for (const r of [hunter, empty]) for (const i of r.held.splice(0)) sim.pool.reserve(i);
    for (const i of sim.pool.indices('reserve').slice(0, hunter.config.hopperCapacity)) { sim.pool.hold(i, hunter.id); hunter.held.push(i); }
    const pilot = season.createBotPilot!(sim.ctx, sim.rules, hunter);
    const command = pilot.update(sim.physics.dt);
    // A hunter heads into a barrier lane toward the human; with no human, the scorer stages straight home.
    if (controller === 'player') expect(Math.abs(command.vy)).toBeGreaterThan(0.5);
    else expect(Math.abs(command.vy)).toBeLessThan(0.1);
  } finally { sim.dispose(); }
});
