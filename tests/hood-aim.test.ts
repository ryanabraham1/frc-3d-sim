import { afterEach, beforeAll, expect, it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { SEASONS } from '../src/seasons';
import { cloneConfig } from '../src/engine/robot/config';
import { HeadlessSim } from '../src/engine/testing/headless';
import { IDLE_COMMAND } from '../src/engine/robot/robot';
import { hoodFor } from '../src/engine/robot/turretShooter';
import * as C from '../src/seasons/2026-rebuilt/constants';

const season = SEASONS.find((s) => s.year === 2026)!;
const sims: HeadlessSim[] = [];
beforeAll(async () => { await RAPIER.init(); });
afterEach(() => { for (const sim of sims.splice(0)) sim.dispose(); });

/** Hood angle the robot settles on while the driver holds shoot (no pieces, so nothing launches). */
function aimFrom(dx: number): number {
  const c = cloneConfig(season.teamRobots!.find((t) => t.team === 4414)!.config);
  const sim = new HeadlessSim(season, RAPIER, { robot: c, alliance: 'blue', pose: { x: C.HUB_CENTER.x - dx, y: C.HUB_CENTER.y, yaw: 0 } });
  sims.push(sim);
  sim.robot.held.length = 0;
  sim.run(0.6, { ...IDLE_COMMAND, shoot: true });
  return sim.robot.lastShotAngle;
}

it('the hood tracks range while aiming, before any shot leaves', () => {
  const near = aimFrom(1.4);
  const far = aimFrom(3.6);
  expect(near).toBeGreaterThan(0);
  expect(far).toBeGreaterThan(0);
  // Close shots launch steeper, so the hood opens further.
  expect(near).toBeGreaterThan(far + 0.05);
  expect(hoodFor(near)).toBeGreaterThan(hoodFor(far));
});
