import { scoringActuator } from './scoringReadiness';
import * as THREE from 'three';
import type { ModelKit, RobotModel } from './models';
import { cadAnchor, cadJoint, cadPoint } from './crescendoCadJoints';

/** Official Presto AdvantageScope CAD plus the supplied intake. Arm goals and
 * 400 mm climber travel come from RobotCode2024Public. Backpack stroke is fitted.
 */
export function buildPrestoCad(root: THREE.Group, k: ModelKit, animated: () => boolean): RobotModel {
  const arm = cadJoint(root,['arm','feeder','shooter','backpack','backpack-slide','climber'],[-.238,.29845,0],'cad-shooter-pivot');
  const climber = root.getObjectByName('climber')!;
  const slide = root.getObjectByName('backpack-slide')!;
  const climbRest = climber.position.clone(), slideRest = slide.position.clone();
  const intake = cadAnchor(root,root,[-.413,.063,0],'cad-intake-mouth');
  const held = cadAnchor(root,arm,[-.008,.29845,0],'cad-held-note');
  const shot = cadAnchor(root,arm,[.407,.29845,0],'cad-shot-mouth');
  let angle = 0, extension = 0, backpack = 0;
  return {
    replaces:['chassis','launcher','hopper','intakeRollers','climber','funnel'],
    intakeAnchor:intake,heldAnchor:held,lightAt:[-.2,.3,.27],
    flow:{intake:()=>[cadPoint(k,intake),new THREE.Vector3(-.22,.15,0),cadPoint(k,held)],stow:()=>cadPoint(k,held),feed:()=>[cadPoint(k,held),cadPoint(k,shot)]},
    update(s) {
      const active = animated(), amp = s.amp ?? s.passing;
      // Align raises arm/hooks; hanging retracts the carriage along the arm.
      const climbing = s.climb > 0;
      const target = !active ? 0 : climbing ? THREE.MathUtils.degToRad(s.climb > .5 ? 105 : 88)
        : amp ? THREE.MathUtils.degToRad(110) : s.aiming || s.firing > 0 ? THREE.MathUtils.clamp(s.hood,THREE.MathUtils.degToRad(5.8),THREE.MathUtils.degToRad(110)) : THREE.MathUtils.degToRad(5.8);
      angle = active ? scoringActuator(angle,target,Math.PI*2,s.dt) : 0;
      extension = active ? scoringActuator(extension,s.climb > .5 ? .4 : 0,.65,s.dt) : 0;
      backpack = active ? scoringActuator(backpack,climbing && s.climb <= .5 && (s.aiming || s.firing > 0) ? .18 : 0,.45,s.dt) : 0;
      arm.rotation.z = angle;
      // The carriage runs in the arm's X direction, not world vertical.
      climber.position.copy(climbRest); climber.position.x += extension;
      slide.position.copy(slideRest); slide.position.x += Math.cos(Math.PI/9)*backpack; slide.position.y += Math.sin(Math.PI/9)*backpack;
    },
  };
}
