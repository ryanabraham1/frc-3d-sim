import { beforeAll, expect, it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { HeadlessSim } from '../src/engine/testing/headless';
import { IDLE_COMMAND } from '../src/engine/robot/robot';
import { crescendo2024 as season } from '../src/seasons/2024-crescendo';
import { stageObstacles } from '../src/seasons/2024-crescendo/obstacles';
import { aroundCircles } from '../src/engine/ai/cycleBot';
import * as C from '../src/seasons/2024-crescendo/constants';
beforeAll(async()=>{await RAPIER.init();});
for (const alliance of ['blue', 'red'] as const)
for (const p of season.teamRobots!.filter(p=>p.config.height<C.STAGE_CLEARANCE)) {
 it(`${alliance} ${p.id} drives under the stage`,()=>{
 const center=C.stageCenter(alliance);
 const sim=new HeadlessSim(season,RAPIER,{robot:p.config,alliance,pose:{x:center.x,y:center.y-2,yaw:Math.PI/2}});
 try {
 const goal = { x: center.x, y: center.y + 2 };
 expect(aroundCircles(sim.robot.pose, goal, stageObstacles(sim.robot))).toEqual(goal);
 const leg = C.stagePoint(alliance, ...C.LEG_LOCAL[0]);
 expect(aroundCircles({x:leg.x-2,y:leg.y}, {x:leg.x+2,y:leg.y}, stageObstacles(sim.robot))).not.toEqual({x:leg.x+2,y:leg.y});
 for(let n=0;n<90;n++)sim.step({...IDLE_COMMAND,vy:sim.robot.config.maxSpeed});
 expect(sim.robot.pose.y, JSON.stringify(sim.robot.pose)).toBeGreaterThan(center.y+1);
 }finally{sim.dispose();}
 });
}

it('keeps tall robots outside the stage core', () => {
 const center = C.stageCenter('blue');
 const config = {...season.robotDefaults, height: C.STAGE_CLEARANCE + 0.1};
 const sim = new HeadlessSim(season, RAPIER, {robot:config, alliance:'blue', pose:{x:center.x,y:center.y-2,yaw:Math.PI/2}});
 try {
 const goal = {x:center.x,y:center.y+2};
 expect(aroundCircles(sim.robot.pose,goal,stageObstacles(sim.robot))).not.toEqual(goal);
 for(let n=0;n<180;n++) sim.step({...IDLE_COMMAND,vy:1.5});
 expect(sim.robot.pose.y).toBeLessThan(center.y);
 } finally {sim.dispose();}
});
