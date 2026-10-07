import { scoringActuator } from './scoringReadiness';
import * as THREE from 'three';
import type { ModelKit, RobotModel } from './models';
import { cadAnchor, cadJoint, cadPoint } from './crescendoCadJoints';

/** Roti: continuous two-stage elevator and pitching pod. Published BETA goals:
 * idle/intake 15 mm, AMP 430.4 mm / -24 degree outlet, preclimb 620 mm,
 * pulled in 0 mm, TRAP 580 mm. Exported carriage is 310.72 mm above zero.
 */
export function buildRotiCad(root: THREE.Group, k: ModelKit, animated: () => boolean): RobotModel {
  const stage = root.getObjectByName('elevator-stage')!, carriage = root.getObjectByName('carriage')!;
  root.updateMatrixWorld(true); stage.attach(carriage);
  const shooter = cadJoint(root,['shooter'],[.0889,.705518,0],'cad-shooter-pivot',carriage);
  const intake = cadAnchor(root,root,[-.455,.10,0],'cad-intake-mouth');
  const held = cadAnchor(root,shooter,[-.04,.94,0],'cad-held-note',-.508);
  const shot = cadAnchor(root,shooter,[.14,.855,0],'cad-shot-mouth');
  const reverseFeed = cadAnchor(root,shooter,[-.205,1.11,0],'cad-reverse-feed-mouth');
  const stageY=stage.position.y,carriageY=carriage.position.y;
  let lift=0,pitch=0,reverse=false;
  return {
    replaces:['chassis','launcher','hopper','intakeRollers','climber','funnel'],
    intakeAnchor:intake,heldAnchor:held,lightAt:[0,.35,.3],
    flow:{intake:()=>[cadPoint(k,intake),new THREE.Vector3(-.15,.16,0),cadPoint(k,held)],stow:()=>cadPoint(k,held),feed:()=>[cadPoint(k,held),cadPoint(k,reverse?reverseFeed:shot)]},
    update(s) {
      const active=animated(),amp=s.amp??s.passing;
      reverse=amp || s.climb>0;
      const liftTarget=s.climb>.5?.62:s.climb>0?(s.aiming||s.firing>0?.58:0):amp?.4304:.015;
      const pitchTarget=s.climb>.5?THREE.MathUtils.degToRad(40):s.climb>0?(s.aiming||s.firing>0?0:THREE.MathUtils.degToRad(-29))
        :amp?THREE.MathUtils.degToRad(-24):s.aiming||s.firing>0?THREE.MathUtils.clamp(s.hood,.14,1.25):THREE.MathUtils.degToRad(27);
      lift=active?scoringActuator(lift,liftTarget,.7,s.dt):0;
      pitch=active?scoringActuator(pitch,pitchTarget+.508,3,s.dt):0;
      stage.position.y=stageY+lift/2;
      carriage.position.y=carriageY+lift/2-(active?.31072:0);
      shooter.rotation.z=pitch;
    },
  };
}
