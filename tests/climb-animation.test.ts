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

it('581 approaches a cage with its CAD climber facing the cage',()=>{
  const season=SEASONS.find(s=>s.year===2025)!,config=cloneConfig(season.teamRobots!.find(t=>t.id==='zuma-581')!.config);
  const sim=new HeadlessSim(season,RAPIER,{robot:config,alliance:'blue',pose:{x:7,y:4,yaw:0}});
  try{
    sim.rules.stage();sim.rules.onPeriodChange(sim.ctx.clock.start());
    while(sim.ctx.clock.mode!=='teleop')for(const change of sim.ctx.clock.advance(.1))sim.rules.onPeriodChange(change);
    const rules=sim.rules as unknown as {climbApproach(r:typeof sim.robot):{x:number;y:number;yaw:number}|null;requestClimb(r:typeof sim.robot,n:number):void};
    const approach=rules.climbApproach(sim.robot)!;
    expect(approach.yaw).toBeCloseTo(Math.PI/2);
    sim.robot.resetTo({...approach,yaw:0});rules.requestClimb(sim.robot,2);expect(sim.robot.climbPhase).toBe('none');
    sim.robot.resetTo(approach);rules.requestClimb(sim.robot,2);expect(sim.robot.climbPhase).toBe('align');
  }finally{sim.dispose();}
});
