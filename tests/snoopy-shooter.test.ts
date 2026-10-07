import { afterEach, beforeAll, expect, it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { HeadlessSim } from '../src/engine/testing/headless';
import { IDLE_COMMAND } from '../src/engine/robot/robot';
import { crescendo2024 as season } from '../src/seasons/2024-crescendo';
import { cloneConfig } from '../src/engine/robot/config';
const sims: HeadlessSim[] = [];
beforeAll(async () => { await RAPIER.init(); });
afterEach(() => { for (const sim of sims.splice(0)) sim.dispose(); });
function make() {
  const config = cloneConfig(season.teamRobots!.find(p => p.id === 'snoopy-6036')!.config);
  const pose = { ...season.testing!.scoringSpots('blue')[5], yaw: 0 };
  const sim = new HeadlessSim(season, RAPIER, { robot: config, alliance: 'blue', pose });
  sims.push(sim); sim.load(1); return sim;
}
it('holds the note while yaw and pitch move, then releases after alignment even with intake held', () => {
  const sim = make();
  const target = sim.rules.aimTarget(sim.robot)!;
  sim.robot.lastCommand = { ...IDLE_COMMAND, shoot: true, intake: true };
  sim.robot.aimTurretAt(target, sim.physics.dt);
  const firstYaw = sim.robot.turretYaw;
  expect(Math.abs(firstYaw)).toBeLessThanOrEqual(5 * sim.physics.dt + .0001);
  expect(sim.robot.launch(target, sim.rng)).toBeNull();
  expect(sim.robot.fireCooldown).toBe(0);
  let shot = null;
  let elapsed = sim.physics.dt;
  while (!shot && elapsed < 2) {
    sim.robot.aimTurretAt(target, sim.physics.dt);
    shot = sim.robot.launch(target, sim.rng);
    elapsed += sim.physics.dt;
  }
  expect(shot).not.toBeNull();
  expect(elapsed).toBeGreaterThan(.1);
  const bearing = Math.atan2(-(target.point.z-shot!.pos.z),target.point.x-shot!.pos.x);
  expect(Math.abs(Math.atan2(Math.sin(bearing-sim.robot.turretYaw), Math.cos(bearing-sim.robot.turretYaw)))).toBeLessThan(.05);
});
it('waits for pitch even when the turret already points at the target', () => {
  const sim = make(), target = sim.rules.aimTarget(sim.robot)!;
  sim.robot.turretYaw = Math.atan2(-(target.point.z-sim.robot.body.translation().z),target.point.x-sim.robot.body.translation().x);
  sim.robot.lastCommand = { ...IDLE_COMMAND, shoot:true };
  sim.robot.aimTurretAt(target,sim.physics.dt);
  expect(sim.robot.launch(target,sim.rng)).toBeNull();
  expect(sim.robot.fireCooldown).toBe(0);
});
