import { scoringActuator } from './scoringReadiness';
import * as THREE from 'three';
import type { ModelKit, RobotModel } from './models';
import { actuator, cadAnchor, cadJoint, cadPoint } from './crescendoCadJoints';

/** 1678 Citrus Circuits "Nik" (2024 CAD assembly "Epsilon", the practice/second robot).
 *
 * Checklist (CLAUDE.md "verify before you build"):
 * - Archetype: pivoting shooter (whole E-1000 pivots on a revolute to the AMP tower base) + tilted single-stage
 *   AMP/TRAP elevator over the intake end + gas-spring climber arms pulled down by a rope winch.
 *   Source: Onshape mates (Revolute 1 E-1000 <-> P-0913, Slider 1 in E-0900 AMP, Revolute 3/13 + gas spring
 *   sliders in E-1100 Climber) and 1678's public C2024-Public code (Hood, Elevator, IntakeDeploy, Climber).
 * - Intake end: back (-X). Over-the-bumper deploying intake, hinge at the E-0800 Revolute 1; code deploy 15 deg
 *   (Epsilon), stow = home 128.1 deg [code Constants], CAD exported deployed. TBA match photos show the green
 *   intake wheels on the end under the tilted AMP tower.
 * - Scoring end: front (+X) for the SPEAKER; the AMP/TRAP rollers ride the elevator over the back.
 * - Colours: bare/silver aluminium structure, black polycarbonate/plates, green intake compliant wheels, orange
 *   shooter wheels (TBA 2024 photos, refs/1678-2024). The CAD's colours are mostly appearance-correct.
 * - Capacity 1 NOTE (game rule). Hood 15..62 deg at 200 deg/s, elevator 0..0.46 m (amp 0.303, trap 0.42) at
 *   1 m/s [code Constants]. Climber arm stow angle and the AMP elevator export extension (0.42 m) are [EST]
 *   from rail/sprocket clearances in the CAD.
 */
const AMP_AXIS = new THREE.Vector3(-.342,.94,0).normalize();
const ARM_PIVOT = new THREE.Vector2(-.0687,.4461);
const STRUT_BASE = new THREE.Vector2(-.0377,.1507);
const STRUT_TOP = new THREE.Vector2(-.0229,.4747);
const EXPORT_LIFT = .42;

export function buildNikCad(root: THREE.Group, k: ModelKit, animated: () => boolean): RobotModel {
  const shooter = cadJoint(root,['shooter'],[.0248,.189,0],'cad-shooter-pivot');
  const intakeJoint = cadJoint(root,['intake'],[-.2969,.16,0],'cad-intake-pivot');
  const arms = cadJoint(root,['climber'],[ARM_PIVOT.x,ARM_PIVOT.y,0],'cad-climber-pivot');
  const strut = cadJoint(root,['climber-strut','climber-rod'],[STRUT_BASE.x,STRUT_BASE.y,0],'cad-climber-strut');
  const rod = root.getObjectByName('climber-rod');
  const rodRest = rod?.position.clone() ?? new THREE.Vector3();
  const amp = root.getObjectByName('amp')!;
  const ampRest = amp.position.clone();
  const intake = cadAnchor(root,intakeJoint,[-.6,.095,0],'cad-intake-mouth');
  const held = cadAnchor(root,shooter,[.1,.255,0],'cad-held-note',THREE.MathUtils.degToRad(15));
  const shot = cadAnchor(root,shooter,[.4,.335,0],'cad-shot-mouth',THREE.MathUtils.degToRad(15));
  cadAnchor(root,arms,[.17,.83,0],'cad-climb-hook');
  const restStrut = STRUT_TOP.clone().sub(STRUT_BASE);
  const strutRestAngle = Math.atan2(restStrut.y,restStrut.x), strutRestLength = restStrut.length();
  let pitch = 0, deploy = 0, lift = 0, arm = 0;
  return {
    replaces:['chassis','launcher','hopper','intakeRollers','climber','funnel'],
    intakeAnchor:intake,heldAnchor:held,lightAt:[-.1,.35,.25],
    flow:{intake:()=>[cadPoint(k,intake),new THREE.Vector3(-.3,.17,0),cadPoint(k,held)],stow:()=>cadPoint(k,held),feed:()=>[cadPoint(k,held),cadPoint(k,shot)]},
    update(s) {
      const active = animated(), amping = s.amp ?? false, climbing = s.climb > 0;
      const aim = s.aiming || s.firing > 0;
      // Passing keeps the speaker hood law; only the AMP request raises the elevator.
      const hood = aim || s.passing ? THREE.MathUtils.clamp(s.hood,THREE.MathUtils.degToRad(15),THREE.MathUtils.degToRad(62)) : THREE.MathUtils.degToRad(15);
      pitch = active ? scoringActuator(pitch,hood-THREE.MathUtils.degToRad(15),THREE.MathUtils.degToRad(200),s.dt) : 0;
      // Intake: stowed at 128.1 deg (home), deployed at 15 deg = the CAD export pose.
      deploy = active ? actuator(deploy,s.intaking ? 0 : -THREE.MathUtils.degToRad(113.1),7,s.dt) : 0;
      // Elevator: 0 = retracted, 0.303 m AMP, 0.42 m TRAP/climb; the CAD is exported at 0.42.
      const height = active ? (climbing ? .42 : amping ? .303 : 0) : EXPORT_LIFT;
      lift = active ? scoringActuator(lift,height,1,s.dt) : EXPORT_LIFT;
      // Gas springs push the arms up once released; the rope winch folds them back down to hang.
      arm = active ? actuator(arm,climbing ? (s.climb > .5 ? 0 : -.75) : -.95,2.5,s.dt) : 0;
      shooter.rotation.z = pitch; intakeJoint.rotation.z = deploy; arms.rotation.z = arm;
      amp.position.copy(ampRest).addScaledVector(AMP_AXIS,lift-EXPORT_LIFT);
      const top = STRUT_TOP.clone().sub(ARM_PIVOT).rotateAround(new THREE.Vector2(),arm).add(ARM_PIVOT).sub(STRUT_BASE);
      strut.rotation.z = Math.atan2(top.y,top.x)-strutRestAngle;
      if (rod) rod.position.copy(rodRest).addScaledVector(new THREE.Vector3(Math.cos(strutRestAngle),Math.sin(strutRestAngle),0),top.length()-strutRestLength);
    },
  };
}
