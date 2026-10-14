import { beforeAll, expect, it } from 'vitest';
import { loadRapier, type RapierModule } from '../src/engine/physics/world';
import { HeadlessSim } from '../src/engine/testing/headless';
import { capturePilot, restorePilot } from '../src/engine/net/recovery';
import { SEASONS } from '../src/seasons';
import { side } from '../src/seasons/2026-rebuilt/field';

const season = SEASONS.find(s => s.id === '2026-rebuilt')!;
let R: RapierModule;
beforeAll(async () => { R = await loadRapier(); });

it.each(['blue', 'red'] as const)('AUTO switches to unloading immediately when the return budget runs out (%s)', alliance => {
  const config = season.botRobotConfig!('hard');
  const sim = new HeadlessSim(season, R, { robot: config, alliance, station: 2,
    pose: { ...side(alliance, 6.5, 1.3), yaw: alliance === 'blue' ? 0 : Math.PI } });
  try {
    sim.rules.onPeriodChange(sim.ctx.clock.start());
    const pilot = season.createAutoPilot(sim.ctx, sim.rules, sim.robot, 'shoot-collect');
    pilot.update(sim.physics.dt); // Empty preload → collection.
    sim.load(15);
    sim.ctx.clock.advance(17);
    const command = pilot.update(sim.physics.dt);
    expect(command.intake).toBe(false);
    expect(command.shoot).toBe(false); // Still outside our scoring zone.
    expect(Math.hypot(command.vx, command.vy)).toBeGreaterThan(0);
    expect(JSON.parse(capturePilot(pilot).phase)).toBe('return');
    // New route progress / blocked-target state survives the same checkpoint format used by host recovery.
    const state = capturePilot(pilot);
    const restored = season.createAutoPilot(sim.ctx, sim.rules, sim.robot, 'shoot-collect');
    restorePilot(restored, JSON.parse(JSON.stringify(state)));
    expect(capturePilot(restored)).toEqual(state);
  } finally { sim.dispose(); }
});
