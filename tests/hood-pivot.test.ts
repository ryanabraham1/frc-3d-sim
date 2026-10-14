import { afterEach, beforeAll, expect, it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { SEASONS } from '../src/seasons';
import { cloneConfig } from '../src/engine/robot/config';
import { HeadlessSim } from '../src/engine/testing/headless';
import { IDLE_COMMAND } from '../src/engine/robot/robot';
import { loadCad2026 } from './helpers/cad2026';
import { setCadModelsEnabled } from '../src/engine/robot/cadModels';
import * as C from '../src/seasons/2026-rebuilt/constants';

const season = SEASONS.find(s => s.id === '2026-rebuilt')!;
const sims: HeadlessSim[] = [];
beforeAll(async () => { await RAPIER.init(); await loadCad2026(); });
afterEach(() => { for (const s of sims.splice(0)) s.dispose(); setCadModelsEnabled(true); });

it.each([254, 581, 971, 1323, 1678, 1690, 1778, 1987, 2910, 4414, 5940, 6800, 7769, 9470])
('team %i keeps its hood hinge fixed throughout shooting and stowing', team => {
  const config = cloneConfig(season.teamRobots!.find(t => t.team === team)!.config);
  const s = new HeadlessSim(season, RAPIER, { robot: config, alliance: 'blue', pose: { x: C.HUB_CENTER.x - 3, y: C.HUB_CENTER.y, yaw: 0 } });
  sims.push(s);
  s.robot.held.length = 0;
  const pivots = new Set<THREE.Object3D>();
  s.robot.visual.traverse(o => { if (o.userData.hood) pivots.add(o.userData.hoodRotor ?? o); });
  expect(pivots.size).toBeGreaterThan(0);
  const before = [...pivots].map(p => ({ p, position: p.position.clone(), rotation: p.quaternion.clone() }));
  let rotated = false;
  for (const shoot of [false, true, false]) {
    s.robot.lastCommand = { ...IDLE_COMMAND, shoot };
    s.robot.enabled = true;
    for (let frame = 0; frame < 90; frame++) {
      s.robot.syncVisual(1 / 60);
      for (const { p, position, rotation } of before) {
        expect(p.position.distanceTo(position)).toBeLessThan(1e-9);
        rotated ||= p.quaternion.angleTo(rotation) > .01;
      }
    }
  }
  expect(rotated).toBe(true);
});

it.each([1323,4414])('team %i raises only its hood above the parked 604 head',team=>{
 const s=new HeadlessSim(season,RAPIER,{robot:cloneConfig(season.teamRobots!.find(t=>t.team===team)!.config),alliance:'blue',pose:{x:1,y:1,yaw:0}});sims.push(s);
 s.robot.held.length=0;s.robot.enabled=true;s.robot.lastCommand=IDLE_COMMAND;
 for(let i=0;i<90;i++)s.robot.syncVisual(1/60);
 const rest=s.robot.hoodTop;
 s.robot.lastCommand={...IDLE_COMMAND,shoot:true};(s.robot as unknown as {shooterPitch:number}).shooterPitch=1.28;
 for(let i=0;i<90;i++)s.robot.syncVisual(1/60);
 expect(s.robot.hoodTop).toBeGreaterThan(rest+.02);
});
