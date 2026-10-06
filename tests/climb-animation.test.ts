import { beforeAll,expect,it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { SEASONS } from '../src/seasons';
import { cloneConfig } from '../src/engine/robot/config';
import { registerRobotModel } from '../src/engine/robot/models';
import { HeadlessSim } from '../src/engine/testing/headless';
beforeAll(async()=>{await RAPIER.init();});
it('stows before endgame, deploys to grab, and pulls progressively during the lift',()=>{
  let deployment=0;
  registerRobotModel('climb-animation-probe',()=>({replaces:[],update(s){deployment=s.climb;}}));
  const season=SEASONS.find(s=>s.year===2025)!,config=cloneConfig(season.teamRobots!.find(t=>t.id==='zuma-581')!.config);
  config.model='climb-animation-probe';config.climber.secondsToClimb=2;
  const sim=new HeadlessSim(season,RAPIER,{robot:config,alliance:'blue',pose:{x:2,y:2,yaw:0}}),r=sim.robot;
  try {
    r.enabled=true;r.syncVisual(0);expect(deployment).toBe(0);
    r.climbReady=true;r.syncVisual(0);expect(deployment).toBe(1);
    r.startClimb(r.pose,.3,2,0);r.syncVisual(0);expect(deployment).toBe(1);
    r.tick(.61);expect(r.climbPhase).toBe('rise');
    r.tick(1);r.syncVisual(0);expect(deployment).toBeCloseTo(.625);
    r.tick(1.01);r.syncVisual(0);expect(r.climbPhase).toBe('hanging');expect(deployment).toBe(.25);
  } finally {sim.dispose();}
});
