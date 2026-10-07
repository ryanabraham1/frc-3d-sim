import * as THREE from 'three';
import type { ModelKit, RobotModel } from './models';
import { actuator, cadAnchor, cadJoint, cadPoint } from './crescendoCadJoints';

/** Snoopy: complete turret-mounted A-frame and shooter-mounted chain hooks.
 * Public code expresses AMP=.27, climb=.31, pull-in=.001 in rotations.
 * Source yaw is 145 degrees; pitch and NOTE outlet are measured along the paired flywheel bank centers.
 */
export function buildSnoopyCad(root: THREE.Group, k: ModelKit, animated: () => boolean): RobotModel {
  const sourceYaw = THREE.MathUtils.degToRad(145);
  // Centerline between the two pairs of 4-inch flywheel shafts, not across a
  // top/bottom pair. The exported outlet slopes DOWN toward the outer wheel bank.
  const sourcePitch = Math.atan2(.49795-.61755, Math.hypot(.15185-.09260,.10590-.06455));
  const turret = cadJoint(root,['turret','pivot-frame','shooter'],[0,.15,0],'cad-turret-pivot',root,sourceYaw);
  const shooter = cadJoint(root,['shooter'],[.125005,.479425,.087175],'cad-shooter-pivot',turret,sourceYaw);
  // The transverse shaft is parallel to the normalized turret's Z axis.
  shooter.rotation.y = 0;
  const intake = cadAnchor(root,root,[.445,.065,0],'cad-intake-mouth');
  const held = cadAnchor(root,shooter,[-.09260,.61755,-.06455],'cad-held-note',sourcePitch,sourceYaw);
  const shot = cadAnchor(root,shooter,[-.17905,.44305,-.12488],'cad-shot-mouth');
  let pitch = 0, yaw = sourceYaw;
  return {
    replaces:['chassis','launcher','hopper','intakeRollers','climber','funnel'],
    intakeAnchor:intake,heldAnchor:held,lightAt:[0,.25,.3],
    flow:{intake:()=>[cadPoint(k,intake),new THREE.Vector3(-.15,.16,0),cadPoint(k,held)],stow:()=>cadPoint(k,held),feed:()=>[cadPoint(k,held),cadPoint(k,shot)]},
    update(s) {
      const active = animated(), amp = s.amp ?? s.passing;
      const goal = s.climb > .5 ? .31*Math.PI*2 : s.climb > 0 ? (s.firing > 0 ? .14 : .001)*Math.PI*2
        : amp ? .27*Math.PI*2 : s.aiming || s.firing > 0 ? s.hood : 0;
      pitch = active ? actuator(pitch,goal-sourcePitch,3.5,s.dt) : 0;
      const yawGoal = s.climb > 0 ? Math.PI : s.aiming || s.firing > 0 ? k.turret.rotation.y : 0;
      const yawError = Math.atan2(Math.sin(yawGoal-yaw),Math.cos(yawGoal-yaw));
      yaw = active ? actuator(yaw,yaw+yawError,5,s.dt) : sourceYaw;
      yaw = Math.atan2(Math.sin(yaw),Math.cos(yaw));
      shooter.rotation.z = pitch; turret.rotation.y = yaw;
    },
  };
}
