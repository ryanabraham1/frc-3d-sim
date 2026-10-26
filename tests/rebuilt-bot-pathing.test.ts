import { beforeAll, expect, it } from 'vitest';
import { loadRapier, type RapierModule } from '../src/engine/physics/world';
import { HeadlessSim } from '../src/engine/testing/headless';
import { CycleBot } from '../src/engine/ai/cycleBot';
import { TeamBrain, radioFor } from '../src/engine/ai/team';
import { IDLE_COMMAND } from '../src/engine/robot/robot';
import { SEASONS } from '../src/seasons';
import { routeThroughBands } from '../src/engine/ai/steering';
import { BANDS } from '../src/seasons/2026-rebuilt/autopilot';
import * as C from '../src/seasons/2026-rebuilt/constants';

const season = SEASONS.find(s => s.id === '2026-rebuilt')!;
let R: RapierModule;
beforeAll(async () => { R = await loadRapier(); });

it('routes around its own driver before reaching the bumper', () => {
  const config = season.botRobotConfig!('hard');
  const sim = new HeadlessSim(season, R, { robot: config, alliance: 'blue', pose: { x: 3.5, y: 4.5, yaw: 0 },
    extraRobots: [{ config, alliance: 'blue', station: 1, id: 1, pose: { x: 1.5, y: 4.5, yaw: 0 } }] });
  try {
    const mate = sim.ctx.robots[1];
    const bot = new CycleBot(sim.ctx, mate, { yieldToDriver: true, score: () => ({ ...IDLE_COMMAND }), supply: () => ({ x: 1, y: 1, yaw: 0 }), accepts: () => true });
    sim.robot.lastCommand = { ...IDLE_COMMAND, shoot: true };
    const command = bot.driveTo({ x: 6, y: 4.5 });
    expect(Math.abs(command.vy)).toBeGreaterThan(0.5);
    // An explicit rescue can still approach the driver rather than orbiting forever.
    const rescue = bot.driveTo({ x: 6, y: 4.5 }, undefined, sim.robot);
    expect(Math.abs(rescue.vy)).toBeLessThan(0.01);
  } finally { sim.dispose(); }
});

it('does not send a teammate to shove a stationary shooting or feeding driver', () => {
  const config = season.botRobotConfig!('hard');
  const sim = new HeadlessSim(season, R, { robot: config, alliance: 'blue', pose: { x: 2.5, y: 4.5, yaw: 0 },
    extraRobots: [{ config, alliance: 'blue', station: 1, id: 1, pose: { x: 2.5, y: 6.8, yaw: 0 } }] });
  try {
    sim.ctx.settings.aiAlly = { skill: 'einstein' };
    const team = TeamBrain.for(sim.ctx, 'blue');
    const driver = sim.robot, mate = sim.ctx.robots[1];
    Object.defineProperty(driver, 'traction', { get: () => 0.2 });
    driver.enabled = true;
    driver.lastCommand = { ...IDLE_COMMAND, shoot: true };
    sim.ctx.clock.start();
    for (let i = 0; i < 60; i++) {
      sim.ctx.clock.advance(0.1);
      if (i === 30) driver.lastCommand = { ...IDLE_COMMAND, pass: true };
      team.tick();
      expect(team.rescueFor(mate)).toBeNull();
    }
    expect(radioFor(sim.ctx).messages.some(m => m.text.includes('need a push'))).toBe(false);
    driver.lastCommand = { ...IDLE_COMMAND, vx: 1.5 };
    sim.ctx.clock.advance(0.1);
    team.tick();
    expect(team.rescueFor(mate)?.target).toBe(driver);
  } finally { sim.dispose(); }
});


it('a parked teammate steps out of the lane its driver is about to drive through', () => {
  const config = season.botRobotConfig!('hard');
  const sim = new HeadlessSim(season, R, { robot: config, alliance: 'blue', pose: { x: 2, y: 4.5, yaw: 0 },
    extraRobots: [{ config, alliance: 'blue', station: 1, id: 1, pose: { x: 3.7, y: 4.6, yaw: 0 } }] });
  try {
    const mate = sim.ctx.robots[1];
    // Parked (shooting from a stance): its own command doesn't move at all.
    const bot = new CycleBot(sim.ctx, mate, { yieldToDriver: true, tactics: () => ({ ...IDLE_COMMAND }), score: () => ({ ...IDLE_COMMAND }), supply: () => ({ x: 1, y: 1, yaw: 0 }), accepts: () => true });
    Object.defineProperty(sim.robot, 'fieldVelocity', { get: () => ({ vx: 2.5, vy: 0, omega: 0 }) });
    const command = bot.update(sim.physics.dt);
    // Sidestep to the side it's already on (above the driver's path), not into it.
    expect(command.vy).toBeGreaterThan(0.5);
  } finally { sim.dispose(); }
});

it('takes the TRENCH when the robot fits under it, the BUMP when it does not', () => {
  // Without the BUMP penalty the BUMP lane is the shorter way here.
  const from = { x: 2.5, y: 1.5 }, to = { x: 7.5, y: 2.0 };
  const trench = routeThroughBands(from, to, BANDS, 0.45, C.TRENCH_SAFE_HEIGHT - 0.05, true);
  expect(trench.y).toBeLessThan(C.TRENCH_OPENING_CENTER_Y * 2);
  const bump = routeThroughBands(from, to, BANDS, 0.45, C.TRENCH_CLEARANCE + 0.2, true);
  expect(bump.y).toBeGreaterThan(C.TRENCH_OPENING_CENTER_Y * 2);
});

it('1678 extends its telescoping hopper once the trench-safe load is nearly full, and drops it when emptied', () => {
  const config = season.teamRobots!.find(r => r.config.model === 'limestone-1678')!.config;
  const sim = new HeadlessSim(season, R, { robot: season.botRobotConfig!('hard'), alliance: 'red', pose: { x: 14, y: 4, yaw: Math.PI },
    extraRobots: [{ config, alliance: 'blue', station: 1, id: 1, pose: { x: 2.5, y: 6.5, yaw: 0 } }] });
  try {
    sim.ctx.settings.aiAlly = { skill: 'einstein' };
    sim.rules.stage();
    sim.rules.onPeriodChange(sim.ctx.clock.start());
    for (const change of sim.ctx.clock.advance(30)) sim.rules.onPeriodChange(change);
    const bot = sim.ctx.robots[1], start = config.hopperExpansion!.startCount;
    expect(bot.manualHopper).toBe(true);
    const pilot = season.createBotPilot!(sim.ctx, sim.rules, bot);
    for (const i of bot.held.splice(0)) sim.pool.reserve(i);
    expect(pilot.update(sim.physics.dt).block).toBe(false);
    for (const i of sim.pool.indices('reserve').slice(0, start - 1)) { sim.pool.hold(i, bot.id); bot.held.push(i); }
    expect(pilot.update(sim.physics.dt).block).toBe(true);
  } finally { sim.dispose(); }
});
