import { scoringActuator } from './scoringReadiness';
import * as THREE from 'three';
import type { ModelKit, RobotModel } from './models';
import { actuator, cadAnchor, cadJoint, cadPoint } from './crescendoCadJoints';

/** Final FRC-2024 public constants: tilted 16-inch elevator, -50/80 degree
 * intake, 55 degree source launcher pose, reverse-feed AMP (-105) / TRAP (-128).
 */
export function buildDomotronCad(root: THREE.Group, k: ModelKit, animated: () => boolean): RobotModel {
  const carriage = root.getObjectByName('carriage')!;
  const rest = carriage.position.clone();
  const shooter = cadJoint(root,['shooter'],[.181376,.4624,0],'cad-shooter-pivot',carriage);
  const intakeJoint = cadJoint(root,['intake'],[-.3175,.2794,0],'cad-intake-pivot');
  const climber = cadJoint(root,['climber'],[.1748,.4379,0],'cad-climber-pivot');
  const intake = cadAnchor(root,intakeJoint,[-.33683,.58563,0],'cad-intake-mouth');
  const held = cadAnchor(root,shooter,[.025,.31,0],'cad-held-note',THREE.MathUtils.degToRad(55));
  const shot = cadAnchor(root,shooter,[.1835,.554,0],'cad-shot-mouth');
  let lift = 0, pitch = 0, deploy = 0, hook = 0;
  return {
    replaces:['chassis','launcher','hopper','intakeRollers','climber','funnel'],
    intakeAnchor:intake,heldAnchor:held,lightAt:[.1,.3,.3],
    flow:{intake:()=>[cadPoint(k,intake),new THREE.Vector3(-.24,.15,0),cadPoint(k,held)],stow:()=>cadPoint(k,held),feed:()=>[cadPoint(k,held),cadPoint(k,shot)]},
    update(s) {
      const active = animated(), amp = s.amp ?? s.passing, climbing = s.climb > 0;
      const aim = s.aiming || s.firing > 0;
      const degrees = climbing ? (s.climb > .5 ? -45 : -128) : amp ? -105 : s.intaking ? 45 : aim ? THREE.MathUtils.radToDeg(THREE.MathUtils.clamp(s.hood,0,THREE.MathUtils.degToRad(55))) : 55;
      pitch = active ? scoringActuator(pitch,THREE.MathUtils.degToRad(degrees-55),2.8,s.dt) : 0;
      lift = active ? scoringActuator(lift,climbing ? .4064 : amp ? .2032 : .003175,.65,s.dt) : 0;
      deploy = active ? actuator(deploy,THREE.MathUtils.degToRad(s.intaking || climbing ? 140 : 10),3.5,s.dt) : 0;
      hook = active ? actuator(hook,s.climb > .5 ? -1.4 : 0,2.5,s.dt) : 0;
      shooter.rotation.z = pitch; intakeJoint.rotation.z = deploy; climber.rotation.z = hook;
      carriage.position.copy(rest).addScaledVector(new THREE.Vector3(Math.sin(Math.PI/12),Math.cos(Math.PI/12),0),lift);
    },
  };
}
