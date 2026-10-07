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

it('a chassis-aimed shooter keeps firing off target once a burst is under way, so a shove makes it miss', async () => {
  const { rebuiltRobotOptions } = await import('../src/seasons/2026-rebuilt/config');
  const { Rng } = await import('../src/engine/random');
  const THREE = await import('three');
  const c = cloneConfig(season.robotDefaults);
  rebuiltRobotOptions.find((o) => o.id === 'aim')!.set(c, 'align');
  const sim = new HeadlessSim(season, RAPIER, { robot: c, alliance: 'blue', pose: { x: C.HUB_CENTER.x - 3, y: C.HUB_CENTER.y, yaw: 0 } });
  sims.push(sim);
  const r = sim.robot;
  sim.load(6);
  const rng = new Rng(3);
  const target = { point: new THREE.Vector3(C.HUB_CENTER.x, 1.8, -C.HUB_CENTER.y) };
  r.alignError = 0.4; // way off target before the first shot: holds fire
  expect(r.launch(target, rng)).toBeNull();
  r.lastCommand = { ...IDLE_COMMAND, shoot:true };
  for (let n=0;n<180;n++) { r.aimTurretAt(target,sim.physics.dt); r.advanceScoringMechanisms(sim.physics.dt); }
  r.alignError = 0.01; // chassis and mechanism locked on: fires
  expect(r.launch(target, rng)).not.toBeNull();
  r.fireCooldown = 0;
  r.alignError = 0.4; // knocked off mid-burst: keeps firing (and the ball flies where the chassis points)
  expect(r.launch(target, rng)).not.toBeNull();
  r.fireCooldown = 0;
  r.tick(1); // burst lapsed: has to re-acquire the target
  r.fireCooldown = 0;
  expect(r.launch(target, rng)).toBeNull();
});
