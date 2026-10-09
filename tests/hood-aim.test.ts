import { afterEach, beforeAll, expect, it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { SEASONS } from '../src/seasons';
import { cloneConfig } from '../src/engine/robot/config';
import { HeadlessSim } from '../src/engine/testing/headless';
import { IDLE_COMMAND } from '../src/engine/robot/robot';
import { hoodFor } from '../src/engine/robot/turretShooter';
import * as C from '../src/seasons/2026-rebuilt/constants';

const season = SEASONS.find((s) => s.id === '2026-rebuilt')!;
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

it.each([4414, 1323, 5940, 3476])('team %s keeps releasing fuel while driving and turning after acquiring aim', (team) => {
  const c = cloneConfig(season.teamRobots!.find(t => t.team === team)!.config);
  const sim = new HeadlessSim(season, RAPIER, { robot: c, alliance: 'blue', pose: { x: C.HUB_CENTER.x - 3, y: C.HUB_CENTER.y, yaw: 0 } });
  sim.pool.bays.clear(); sim.robot.bay = null; // the chassis is teleported without stepping the world: test the shooter, not the hopper
  sims.push(sim);
  sim.load(c.hopperCapacity);
  const r = sim.robot;
  r.shootWhileTracking = true; // as in the game (HeadlessSim defaults to settled-aim shots)
  r.enabled = true;
  r.lastCommand = { ...IDLE_COMMAND, shoot: true };
  // Prescribed chassis motion isolates actuator tracking from field collisions and driver auto-align.
  // Warm up at rest, then change both range and lateral velocity, with chassis yaw changing for turrets.
  let stationary = 0, fired = 0, sinceShot = 0, longestGap = 0;
  for (let n = 0; n < 450; n++) {
    const dt = sim.physics.dt;
    if (n >= 270) {
      const t = (n-270)*dt;
      const p = sim.frame.toWorld(C.HUB_CENTER.x-3+.65*t, C.HUB_CENTER.y+.35*t, c.height/2);
      const old = r.body.translation();
      r.body.setTranslation({x:p.x,y:old.y,z:p.z}, true);
      r.body.setLinvel({x:.65,y:0,z:-.35}, true);
      if (c.launcher.turret) r.body.setRotation({x:0,y:Math.sin(t*.6/2),z:0,w:Math.cos(t*.6/2)},true);
    }
    r.tick(dt);
    const target = sim.rules.aimTarget(r)!;
    r.aimTurretAt(target, dt);
    r.advanceScoringMechanisms(dt);
    const shot = r.launch(target, sim.rng);
    if (n >= 90 && n < 270 && shot) stationary++;
    if (n >= 270) {
      sinceShot += dt;
      if (shot) { fired++; longestGap = Math.max(longestGap, sinceShot); sinceShot = 0; }
    }
  }
  expect(stationary).toBeGreaterThan(0);
  // Moving and alternating muzzle positions can require brief actuator repositioning.
  expect(fired).toBeGreaterThanOrEqual(Math.ceil(stationary*.4));
  expect(Math.max(longestGap, sinceShot)).toBeLessThan(1);
});
