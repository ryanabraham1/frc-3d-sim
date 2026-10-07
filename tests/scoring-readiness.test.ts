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
for(const season of SEASONS.filter(s=>s.year!==2025)) {
 describe(`${season.year} scoring readiness`,()=>{
  it('waits for turret yaw and pitch, then fires; changing target holds fire again',()=>{
   const config=cloneConfig(season.robotDefaults);config.model=undefined;config.launcher.turret=true;config.aimAssist='full';
   config.launcher.spread=0;config.launcher.speedError=0;
   const sim=new HeadlessSim(season,RAPIER,{robot:config,alliance:'blue',pose:{x:2,y:2,yaw:0}});sims.push(sim);
   sim.robot.held.push(-1,-1);sim.robot.lastCommand={...IDLE_COMMAND,shoot:true};
   const target={point:sim.frame.toWorld(2,5,2)};
   const r=sim.robot,rng=new Rng(7);
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
