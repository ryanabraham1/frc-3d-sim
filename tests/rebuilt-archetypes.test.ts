import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import type { Alliance, FieldPose } from '../src/engine/coords';
import { HeadlessSim } from '../src/engine/testing/headless';
import { IDLE_COMMAND, type RobotCommand } from '../src/engine/robot/robot';
import { cloneConfig, footprint, type RobotConfig } from '../src/engine/robot/config';
import { rebuilt2026 as season } from '../src/seasons/2026-rebuilt';
import { normalizeRebuiltConfig, rebuiltRobotOptions, rebuiltRobotPresets } from '../src/seasons/2026-rebuilt/config';
import { side, sideYaw } from '../src/seasons/2026-rebuilt/field';
import type { RebuiltRules } from '../src/seasons/2026-rebuilt/rules';
import * as C from '../src/seasons/2026-rebuilt/constants';

const sims: HeadlessSim[] = [];
beforeAll(async () => { await RAPIER.init(); });
afterEach(() => { for (const s of sims.splice(0)) s.dispose(); });
const preset = (id: string): RobotConfig => cloneConfig(rebuiltRobotPresets().find((p) => p.id === id)!.config);
function make(a: Alliance, pose: FieldPose, robot: RobotConfig) {
  const sim = new HeadlessSim(season, RAPIER, { robot, alliance: a, pose });
  sims.push(sim);
  return sim;
}
function run(sim: HeadlessSim, seconds: number, cmd: RobotCommand | (() => RobotCommand) = IDLE_COMMAND) {
  for (let n = 0; n < Math.round(seconds / sim.physics.dt); n++) {
    for (const ch of sim.ctx.clock.advance(sim.physics.dt)) sim.rules.onPeriodChange(ch);
    sim.step(typeof cmd === 'function' ? cmd() : cmd);
  }
}
const empty = (sim: HeadlessSim) => { for (const i of sim.robot.held.splice(0)) sim.pool.reserve(i); };

describe('2026 REBUILT robot archetypes', () => {
  it('offers realistic archetypes; only the turret archetype has a turret', () => {
    const presets = rebuiltRobotPresets();
    expect(presets.map((p) => p.id)).toEqual(['turret', 'fixed', 'big-hopper', 'outpost']);
    expect(presets.filter((p) => p.config.launcher.turret).map((p) => p.id)).toEqual(['turret']);
    const big = preset('big-hopper');
    expect(big.height).toBeGreaterThan(C.TRENCH_CLEARANCE);
    expect(preset('fixed').height).toBeLessThan(C.TRENCH_CLEARANCE);
    const c = cloneConfig(season.robotDefaults);
    const opt = (id: string) => rebuiltRobotOptions.find((o) => o.id === id)!;
    opt('intake').set(c, 'outpost');
    expect([c.intake.ground, c.intake.station]).toEqual([false, true]);
    opt('aim').set(c, 'align');
    expect([c.launcher.turret, c.autoAlign]).toEqual([false, true]);
    opt('hopper').set(c, '15');
    expect([c.hopperCapacity, c.preload]).toEqual([15, 8]);
    // Legacy saved configs gain the intake flags.
    const legacy = cloneConfig(season.robotDefaults);
    delete legacy.intake.ground; delete legacy.intake.station; delete legacy.autoAlign;
    const up = normalizeRebuiltConfig(legacy);
    expect([up.intake.ground, up.intake.station, up.autoAlign]).toEqual([true, true, false]);
  });

  it('an OUTPOST-only robot cannot pick FUEL up off the carpet; a ground intake can', () => {
    for (const [id, expected] of [['outpost', 0], ['fixed', 1]] as const) {
      const cfg = preset(id);
      const sim = make('blue', { x: 3, y: 2, yaw: 0 }, cfg);
      empty(sim);
      const fp = footprint(sim.robot.config);
      sim.pool.placeField(0, 3 - fp.length / 2 - 0.08, 2); // the ground intake is on the back
      run(sim, 0.6, { ...IDLE_COMMAND, intake: true, vx: -0.4 });
      expect(sim.robot.held.length, id).toBe(expected);
    }
  });

  for (const a of ['blue', 'red'] as const) {
    it(`${a}: an OUTPOST-fed robot loads FUEL the human player releases from the CHUTE`, () => {
      const cfg = preset('outpost');
      const fp = footprint(normalizeRebuiltConfig(cfg));
      const p = side(a, fp.length / 2 + 0.02, C.OUTPOST_CENTER_Y);
      const sim = make(a, { x: p.x, y: p.y, yaw: sideYaw(a, Math.PI) }, cfg);
      sim.rules.stage();
      empty(sim);
      sim.rules.onPeriodChange(sim.ctx.clock.start());
      for (const ch of sim.ctx.clock.advance(30)) sim.rules.onPeriodChange(ch);
      sim.rules.humanPlayerAction(a); // H: open the CHUTE door
      expect((sim.rules as RebuiltRules).chuteOpen[a]).toBe(true);
      run(sim, 4, { ...IDLE_COMMAND, intake: true });
      expect(sim.robot.held.length).toBeGreaterThanOrEqual(8);
    });
  }

  it('chassis auto-align rotates a fixed shooter onto the HUB and scores; a driver-aimed one facing away misses', () => {
    const hub = side('blue', C.HUB_CENTER.x, C.HUB_CENTER.y);
    const pose = { x: 2.4, y: 2.6, yaw: Math.PI / 2 };
    const results: number[] = [];
    for (const aim of ['align', 'driver']) {
      const cfg = preset('fixed');
      rebuiltRobotOptions.find((o) => o.id === 'aim')!.set(cfg, aim);
      const sim = make('blue', pose, cfg);
      sim.rules.stage();
      expect(sim.robot.held).toHaveLength(8);
      sim.rules.onPeriodChange(sim.ctx.clock.start());
      let yawAtShot = NaN;
      run(sim, 3, () => {
        if (Number.isNaN(yawAtShot) && sim.robot.held.length < 8) yawAtShot = sim.robot.pose.yaw;
        return { ...IDLE_COMMAND, shoot: true };
      });
      results.push(season.testing!.goalCount(sim.ctx, 'blue'));
      if (aim === 'align') expect(Math.abs(Math.atan2(hub.y - sim.robot.pose.y, hub.x - sim.robot.pose.x) - yawAtShot)).toBeLessThan(0.08);
    }
    expect(results[0]).toBeGreaterThanOrEqual(6);
    expect(results[1]).toBe(0);
  });

  it('a hopper that catches OUTPOST FUEL does not re-catch its own shots (AUTO preload scores)', () => {
    const sim = make('blue', season.startPose('blue', 2), cloneConfig(season.robotDefaults));
    sim.rules.stage();
    sim.rules.onPeriodChange(sim.ctx.clock.start());
    const auto = season.createAutoPilot(sim.ctx, sim.rules, sim.robot, 'shoot-only');
    run(sim, 20, () => (sim.ctx.clock.mode === 'auto' ? auto.update(sim.physics.dt) : IDLE_COMMAND));
    expect(season.testing!.goalCount(sim.ctx, 'blue')).toBe(8);
  });
});
