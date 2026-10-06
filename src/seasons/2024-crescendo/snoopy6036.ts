import * as THREE from 'three';
import { bar, box, drivebase, hook, mat, pivot, roller, sidePlates, tubeMat, underBumperIntake, flowAt, type ModelKit, type RobotModel } from '@engine/robot/models';

/** Lightweight fallback following Snoopy's binder: turret A-frame, long pitching
 * roller shooter, polycarbonate hooks and trap blower. Full native CAD is preferred.
 */
export function buildSnoopy6036(k: ModelKit): RobotModel {
  const base = drivebase(k), intake = underBumperIntake(k,{n:7});
  const silver=tubeMat(0xc8ced3),black=mat(0x202226);
  const yaw=pivot(k.visual,0,.15);
  roller(yaw,.09,.025,silver,0,0).rotation.x=Math.PI/2;
  for(const z of [-.23,.23]){
    bar(yaw,[-.06,0,z],[0,.157,z],.035,silver);
    bar(yaw,[.1,0,z],[0,.157,z],.035,silver);
  }
  const arm=pivot(yaw,0,.157);
  sidePlates(arm,[[-.12,-.065],[.43,-.065],[.43,.065],[-.12,.065]],.21,silver);
  for(const x of [.02,.11,.20,.29])roller(arm,.022,.4,silver,x,0);
  const wheels: THREE.Object3D[]=[];
  for(const x of [.32,.43])for(const y of [-.067,.067])wheels.push(roller(arm,.051,.38,black,x,y));
  for(const z of [-.22,.22])hook(arm,.36,.10,z,.1,silver,-1,.01);
  box(arm,.10,.07,.10,black,.14,-.10,0);
  const held=pivot(arm,.18,0),shot=pivot(arm,.46,0);
  return {replaces:['chassis','launcher','hopper','intakeRollers','climber','funnel'],heldAnchor:held,
    flow:{stow:()=>flowAt(k,held,0,0,0),feed:()=>[flowAt(k,held,0,0,0),flowAt(k,shot,0,0,0)]},
    update(s){base.update(s);intake.update(s);yaw.rotation.y=s.climb>0?Math.PI:s.intaking?0:k.turret.rotation.y;
      arm.rotation.z=s.climb>.5?.31*Math.PI*2:s.climb>0?.001*Math.PI*2:(s.amp??s.passing)?.27*Math.PI*2:s.aiming||s.firing>0?s.hood:0;
      for(const w of wheels)w.rotation.z-=s.enabled?40*s.dt:0;
    }};
}
