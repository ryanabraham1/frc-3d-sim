import { afterEach, beforeAll, expect, it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { SEASONS } from '../src/seasons';
import { cloneConfig } from '../src/engine/robot/config';
import { HeadlessSim } from '../src/engine/testing/headless';
import { IDLE_COMMAND } from '../src/engine/robot/robot';
import { side } from '../src/seasons/2026-rebuilt/field';
import * as C from '../src/seasons/2026-rebuilt/constants';

const season = SEASONS.find(s => s.year === 2026)!;
const sims: HeadlessSim[] = [];
beforeAll(async () => { await RAPIER.init(); });
afterEach(() => { for (const sim of sims.splice(0)) sim.dispose(); });

for (const alliance of ['blue', 'red'] as const) {
  for (const direction of [-1, 1]) {
    it(`9483 drives sideways under ${alliance} tower supports in direction ${direction}`, () => {
      const config = cloneConfig(season.teamRobots!.find(t => t.team === 9483)!.config);
      const start = side(alliance, 0.61, C.TOWER_CENTER_Y - direction * 1.35);
      const sim = new HeadlessSim(season, RAPIER, { robot: config, alliance, pose: { ...start, yaw: 0 } });
      sims.push(sim);
      sim.load(config.hopperCapacity);
      const sign = alliance === 'blue' ? 1 : -1;
      sim.run(2, { ...IDLE_COMMAND, vy: direction * sign * 1.5 });
      expect(direction * sign * (sim.robot.pose.y - start.y)).toBeGreaterThan(2.5);
      expect(sim.robot.uprightness).toBeGreaterThan(0.95);
    });
  }
}
