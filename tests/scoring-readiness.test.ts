import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { collectScoringReadiness, scoringActuator, scoringEase } from '../src/engine/robot/scoringReadiness';
import { HeadlessSim } from '../src/engine/testing/headless';
import { IDLE_COMMAND } from '../src/engine/robot/robot';
import { SEASONS } from '../src/seasons';
import { cloneConfig } from '../src/engine/robot/config';
import { Rng } from '../src/engine/random';
const sims: HeadlessSim[]=[];
beforeAll(async()=>{await RAPIER.init();});
afterEach(()=>{for(const sim of sims.splice(0))sim.dispose();});
it('requires every scoring joint to reach its goal and invalidates readiness on a new goal',()=>{
 let angle=0,height=0;
 const step=()=>collectScoringReadiness(()=>{angle=scoringEase(angle,1,.01);height=scoringActuator(height,1,1,.01);});
 expect(step()).toBe(false);
 for(let n=0;n<110;n++)step();
 expect(step()).toBe(true);
 expect(collectScoringReadiness(()=>{angle=scoringEase(angle,-1,.01);})).toBe(false);
 // A nested model cannot overwrite a pending outer actuator.
 expect(collectScoringReadiness(()=>{scoringActuator(0,1,1,.01);collectScoringReadiness(()=>{});})).toBe(false);
});
for(const season of SEASONS.filter(s=>s.year!==2025 && s.year!==2026)) {
 describe(`${season.year} scoring readiness`,()=>{
  it.each([0, 2])('waits for turret yaw and pitch at %s m/s, then fires; changing target holds fire again',(speed)=>{
   const config=cloneConfig(season.robotDefaults);config.model=undefined;config.launcher.turret=true;config.aimAssist='full';
   config.launcher.spread=0;config.launcher.speedError=0;
   const sim=new HeadlessSim(season,RAPIER,{robot:config,alliance:'blue',pose:{x:2,y:2,yaw:0}});sims.push(sim);
   sim.robot.held.push(-1,-1);sim.robot.lastCommand={...IDLE_COMMAND,shoot:true};
   const target={point:sim.frame.toWorld(2,5,2)};
   const r=sim.robot,rng=new Rng(7);
   r.body.setLinvel({x:speed,y:0,z:speed*.5},true);
   expect(r.launch(target,rng)).toBeNull();expect(r.fireCooldown).toBe(0);expect(r.turretYaw).toBe(0);
   let shot=null;
   for(let n=0;n<180&&!shot;n++) {r.aimTurretAt(target,sim.physics.dt);r.advanceScoringMechanisms(sim.physics.dt);shot=r.launch(target,rng);}
   expect(shot).not.toBeNull();
   r.fireCooldown=0;
   const previousYaw=r.turretYaw;
   expect(r.launch({point:sim.frame.toWorld(5,2,2)},rng)).toBeNull();
   expect(r.turretYaw).toBe(previousYaw);expect(r.fireCooldown).toBe(0);
  });
 });
}

describe('2026 shooting while tracking',()=>{
 it.each([0, 6])('fires from the current turret and hood pose at %s m/s',(speed)=>{
  const season=SEASONS.find(s=>s.year===2026)!;
  const config=cloneConfig(season.robotDefaults);config.model=undefined;config.launcher.turret=true;config.aimAssist='full';
  config.launcher.spread=0;config.launcher.speedError=0;
  const sim=new HeadlessSim(season,RAPIER,{robot:config,alliance:'blue',pose:{x:2,y:2,yaw:0}});sims.push(sim);
  const r=sim.robot;r.shootWhileTracking=true;r.held.push(-1);r.lastCommand={...IDLE_COMMAND,shoot:true};
  r.body.setLinvel({x:speed,y:0,z:speed*.5},true);
  r.turretYaw=0;
  (r as unknown as { shooterPitch:number }).shooterPitch=.2;
  // Even an unsettled model must not prevent a FUEL shot.
  Object.defineProperty(r,'scoringMechanismReady',{get:()=>false});
  const shot=r.launch({point:sim.frame.toWorld(2,5,2)},new Rng(7));
  expect(shot).not.toBeNull();expect(r.fireCooldown).toBeGreaterThan(0);
  const vx=shot!.vel.x-speed, vz=shot!.vel.z-speed*.5;
  expect(Math.atan2(-vz,vx)).toBeCloseTo(0,6);
  expect(Math.atan2(shot!.vel.y,Math.hypot(vx,vz))).toBeCloseTo(.2,6);
 });
});
