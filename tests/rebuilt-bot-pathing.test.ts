import { beforeAll, expect, it } from 'vitest';
import { loadRapier, type RapierModule } from '../src/engine/physics/world';
import { HeadlessSim } from '../src/engine/testing/headless';
import { CycleBot } from '../src/engine/ai/cycleBot';
import { TeamBrain, radioFor } from '../src/engine/ai/team';
import { IDLE_COMMAND } from '../src/engine/robot/robot';
import { SEASONS } from '../src/seasons';

const season = SEASONS.find(s => s.id === '2026-rebuilt')!;
let R: RapierModule;
beforeAll(async () => { R = await loadRapier(); });

it('routes around its own driver before reaching the bumper', () => {
  const config = season.botRobotConfig!('hard');
  const sim = new HeadlessSim(season, R, { robot: config, alliance: 'blue', pose: { x: 3.5, y: 4.5, yaw: 0 },
    extraRobots: [{ config, alliance: 'blue', station: 1, id: 1, pose: { x: 1.5, y: 4.5, yaw: 0 } }] });
  try {
    const mate = sim.ctx.robots[1];
    const bot = new CycleBot(sim.ctx, mate, { score: () => ({ ...IDLE_COMMAND }), supply: () => ({ x: 1, y: 1, yaw: 0 }), accepts: () => true });
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

