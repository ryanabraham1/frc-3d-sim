import { beforeAll, expect, it, vi } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { HeadlessSim } from '../src/engine/testing/headless';
import { IDLE_COMMAND } from '../src/engine/robot/robot';
import { getSeason } from '../src/seasons';
import * as C from '../src/seasons/2026-rebuilt/constants';

beforeAll(async () => { await RAPIER.init(); });
for (const team of [4414, 1690, 2910]) {
  for (const direction of [-1, 1]) {
    it(`${team} crosses the real bump in direction ${direction}, pitches and settles without recovery`, () => {
      const season=getSeason('2026-rebuilt');
      const robot=season.teamRobots!.find(t=>t.team===team)!.config;
      const y=C.HUB_CENTER.y-C.HUB_SIZE/2-C.BUMP_WIDTH/2;
      const start=C.HUB_CENTER.x-direction*1.8;
      const sim=new HeadlessSim(season,RAPIER,{robot,alliance:'blue',pose:{x:start,y,yaw:direction===1?0:Math.PI}});
      // Clear loose field FUEL so this checks the ramp, not randomly high-centering on balls.
      for(let i=0;i<sim.pool.count;i++)sim.pool.reserve(i);
      for(let i=0;i<90;i++)sim.step();
      let height=0, tilt=0, recovery=0;
      const tread=vi.spyOn(sim.robot.body,'applyImpulseAtPoint');
      for(let i=0;i<240;i++) {
        sim.step({...IDLE_COMMAND,vx:direction*2});
        height=Math.max(height,sim.robot.body.translation().y);
        tilt=Math.max(tilt,1-sim.robot.uprightness);
        recovery=Math.max(recovery,sim.robot.rightingIn);
      }
      expect(tread.mock.calls.some(([impulse])=>impulse.y>.01)).toBe(true);
      tread.mockRestore();
      expect(direction*(sim.robot.pose.x-C.HUB_CENTER.x)).toBeGreaterThan(1);
      expect(height).toBeGreaterThan(.09);
      expect(height).toBeLessThan(.45);
      expect(tilt).toBeGreaterThan(.005);
      expect(tilt).toBeLessThan(.35);
      expect(recovery).toBe(0);
      for(let i=0;i<150;i++)sim.step();
      expect(sim.robot.uprightness).toBeGreaterThan(.995);
      expect(Math.abs(sim.robot.body.translation().y)).toBeLessThan(.02);
      expect(sim.robot.speed).toBeLessThan(.05);
    });
  }
}
