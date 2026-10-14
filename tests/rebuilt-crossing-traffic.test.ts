import { beforeAll, expect, it } from 'vitest';
import { BANDS } from '../src/seasons/2026-rebuilt/autopilot';
import { routeRebuiltTraffic } from '../src/seasons/2026-rebuilt/traffic';
import * as C from '../src/seasons/2026-rebuilt/constants';
import { SEASONS } from '../src/seasons';
import { loadRapier, type RapierModule } from '../src/engine/physics/world';
import { HeadlessSim } from '../src/engine/testing/headless';
import { dist } from '../src/engine/ai/steering';

const band = BANDS[0], half = 0.48;
const lower = (band.gaps[1].yMin + band.gaps[1].yMax) / 2;
const upper = (band.gaps[2].yMin + band.gaps[2].yMax) / 2;
const from = { x: band.xMin - 1.4, y: lower }, goal = { x: band.xMax + 2, y: lower };
const blocker = { x: band.xMin - 0.25, y: lower, halfWidth: 0.5, speed: 0 };

it('takes the other bump immediately when a teammate occupies the preferred entrance', () => {
  const route = routeRebuiltTraffic(from, goal, BANDS, half, C.TRENCH_CLEARANCE + 0.05, [blocker]);
  expect(route.y).toBeCloseTo(upper);
  expect(route.x).toBeLessThan(band.xMin);
});

it('backs out of a blocked bump before changing lanes across the HUB', () => {
  const start = { x: band.xMin + 0.1, y: lower };
  const route = routeRebuiltTraffic(start, goal, BANDS, half, 0.8, [{ ...blocker, x: band.xMax - 0.1 }]);
  expect(route.x).toBeLessThan(band.xMin);
  expect(route.y).toBe(lower);
});

it('waits clear of both entrances when every compatible lane is occupied', () => {
  const route = routeRebuiltTraffic(from, goal, BANDS, half, 0.8, [blocker, { ...blocker, y: upper }]);
  expect(route.x).toBeLessThan(band.xMin - half);
});

it('does not reroute around a robot already behind it', () => {
  const route = routeRebuiltTraffic(from, goal, BANDS, half, 0.8, [{ ...blocker, x: from.x - 0.5 }]);
  expect(route.y).toBeCloseTo(lower);
});

let R: RapierModule;
beforeAll(async () => { R = await loadRapier(); });
it('4414 AUTO crosses an alternate lane rather than wasting 15 seconds on a stationary 9999', () => {
  const season = SEASONS.find(s => s.id === '2026-rebuilt')!;
  const config = season.teamRobots!.find(r => r.config.model === 'ripcurrent-4414')!.config;
  const sim = new HeadlessSim(season, R, { robot: config, alliance: 'blue', station: 1,
    pose: { ...from, yaw: 0 }, extraRobots: [{ config: season.robotDefaults, alliance: 'blue', id: 1, station: 2, pose: { x: blocker.x, y: blocker.y, yaw: 0 } }] });
  try {
    sim.ctx.settings.aiAlly = { skill: 'einstein' };
    sim.robot.controller = 'bot';
    sim.robot.shootWhileTracking = true;
    sim.ctx.robots[1].controller = 'player';
    sim.ctx.robots[1].body.setBodyType(R.RigidBodyType.Fixed, true);
    sim.rules.stage();
    sim.rules.onPeriodChange(sim.ctx.clock.start());
    const pilot = season.createAutoPilot(sim.ctx, sim.rules, sim.robot, 'shoot-collect');
    let crossedAt = Infinity, stoppedAtBlocker = 0;
    for (let step = 0; step < 20 / sim.physics.dt; step++) {
      for (const change of sim.ctx.clock.advance(sim.physics.dt)) sim.rules.onPeriodChange(change);
      const command = pilot.update(sim.physics.dt);
      sim.step(command);
      if (sim.robot.pose.x > band.xMax + 0.2) crossedAt = Math.min(crossedAt, sim.ctx.clock.elapsed);
      if (command.intake && Math.hypot(command.vx, command.vy) > 0.5 && dist(sim.robot.pose, blocker) < 1.5 && sim.robot.speed < 0.3) stoppedAtBlocker += sim.physics.dt;
    }
    expect(crossedAt).toBeLessThan(12);
    expect(stoppedAtBlocker).toBeLessThan(4);
    expect(sim.ctx.score.fouls.some(f => f.rule === 'G403')).toBe(false);
  } finally { sim.dispose(); }
});
