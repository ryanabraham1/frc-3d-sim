import { scoringActuator } from './scoringReadiness';
import * as THREE from 'three';
import type { ModelKit, RobotModel } from './models';
import { actuator, cadAnchor, cadJoint, cadPoint } from './crescendoCadJoints';

/** 2910 Typhoon V2. The paired 64T pivot sprockets and fixed feeder bearings
 * share source Y=.19163045,Z=.28691241. The previous hinge was a flywheel axle.
 * Source +Y is the feeder end; flywheel exit is -Y. Normalize its turret by pi
 * so +X is the scoring direction. Preserve the unchanged exported pose when paused.
 * Source wheel pairs put the outlet center at Z=.325; pitch datum is nearly flat.
 */
export function buildTyphoonCad(root: THREE.Group,k: ModelKit,animated:()=>boolean): RobotModel {
  const turret=cadJoint(root,['turret','feeder','shooter'],[.1397,.1524,0],'cad-turret-pivot',root,Math.PI);
  const shooter=cadJoint(root,['shooter'],[.19163045,.28691241,0],'cad-shooter-pivot',turret,Math.PI);
  shooter.rotation.y=0;
  const intake=cadAnchor(root,root,[-.425,.065,0],'cad-intake-mouth');
  const held=cadAnchor(root,shooter,[.04,.325,0],'cad-held-note',0,Math.PI);
  const shot=cadAnchor(root,shooter,[-.17,.325,0],'cad-shot-mouth');
  const climb=cadJoint(root,['climber'],[-.364,.204,0],'cad-climber-pivot');
  let pitch=0,yaw=Math.PI,climbAngle=0;
  return {replaces:['chassis','launcher','hopper','intakeRollers','climber','funnel'],intakeAnchor:intake,heldAnchor:held,lightAt:[0,.3,.25],
    flow:{intake:()=>[cadPoint(k,intake),new THREE.Vector3(-.2,.12,0)],stow:()=>cadPoint(k,held),feed:()=>[cadPoint(k,held),cadPoint(k,shot)]},
    update(s){
      if(!animated()){pitch=0;yaw=Math.PI;climbAngle=0;}else{
        const target=(s.amp??s.passing)?1.45:s.aiming||s.firing>0?THREE.MathUtils.clamp(s.hood,.14,1.25):0;
        pitch=scoringActuator(pitch,target,3.5,s.dt);
        const error=Math.atan2(Math.sin(k.turret.rotation.y-yaw),Math.cos(k.turret.rotation.y-yaw));
        yaw=scoringActuator(yaw,yaw+error,5,s.dt);yaw=Math.atan2(Math.sin(yaw),Math.cos(yaw));
        climbAngle=actuator(climbAngle,s.climb*1.8,3,s.dt);
      }
      shooter.rotation.z=pitch;turret.rotation.y=yaw;climb.rotation.z=climbAngle;
    }};
}
