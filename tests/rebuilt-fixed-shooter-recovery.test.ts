import { beforeAll, expect, it } from 'vitest';
import { loadRapier, type RapierModule } from '../src/engine/physics/world';
import { HeadlessSim } from '../src/engine/testing/headless';
import { SEASONS } from '../src/seasons';
import type { RebuiltRules } from '../src/seasons/2026-rebuilt/rules';
import * as C from '../src/seasons/2026-rebuilt/constants';
let R: RapierModule;
beforeAll(async () => { R = await loadRapier(); });
it('turns a planted fixed shooter back toward the HUB after displacement', () => {
  const season = SEASONS.find(s => s.id === '2026-rebuilt')!;
  const config = season.teamRobots!.find(r => r.config.model === 'reblitz-2910')!.config;
  const sim = new HeadlessSim(season, R, { robot: config, alliance: 'blue', station: 2,
    pose: { x: C.HUB_CENTER.x - 2.9, y: C.HUB_CENTER.y, yaw: 1.2 } });
  try {
    sim.ctx.settings.aiAlly = { skill: 'einstein' };
    sim.rules.stage();
    sim.rules.onPeriodChange(sim.ctx.clock.start());
    for (const change of sim.ctx.clock.advance(33.5)) sim.rules.onPeriodChange(change);
    (sim.rules as RebuiltRules).firstInactive = 'red';
    const pilot = season.createBotPilot!(sim.ctx, sim.rules, sim.robot);
    const command = pilot.update(sim.physics.dt);
    expect(Math.hypot(command.vx, command.vy)).toBeLessThan(0.1);
    expect(Math.abs(command.omega)).toBeGreaterThan(0.5);
  } finally { sim.dispose(); }
});
