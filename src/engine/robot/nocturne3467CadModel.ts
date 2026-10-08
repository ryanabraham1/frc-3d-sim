import { scoringActuator } from './scoringReadiness';
import * as THREE from 'three';
import type { ModelKit, RobotModel } from './models';
import { cadAnchor, cadJoint, cadPoint } from './crescendoCadJoints';

/** 3467 Windham Windup "Nocturne" (public Onshape "Nocturne - 2024").
 *
 * Checklist (CLAUDE.md "verify before you build"):
 * - Archetype: single-pivot arm on a front tower carrying the whole shooter head ("Current": VersaRoller feed +
 *   two 4 in urethane flywheel shafts) with chain hooks ("betahooks") on the arm, so the arm aims, scores the AMP
 *   and climbs. No TRAP mechanism (team's 2026 build blog: "despite not having a mechanism to score in the trap").
 *   Source: part tree + public Skip-5.14-Nocturne code (Constants: arm setpoints in degrees from the stowed hard
 *   stop, which is 19 deg below horizontal: kARM_HORIZONTAL_OFFSET 180.4 - kARM_STARTING_OFFSET 161.4).
 *   The Onshape assembly API refused this document (403), so the pivot is the arm's MAXSpline shaft centre.
 * - Intake end: back (-X). Fixed full-width under-bumper VersaRoller intake ("Nocturne intake"); the stowed head
 *   sits over it.
 * - Scoring end: front (+X). The head exits forward between the flywheels: -26 deg in the CAD pose, where the
 *   arm is 78 deg from its stop, so the exit is 52 deg minus the arm angle (SUBWOOFER 1 -> 51 deg, PODIUM 23,
 *   WING 30, AMP 93, CLIMB 88, HARMONY 122).
 * - Colours: black/dark-grey structure and black "NOCTURNE" head, red bumpers (TBA 2024 photo
 *   refs/3467-2024/sheet.jpg); the CAD's grey parts are kept.
 * - Capacity 1 NOTE (rule). Arm cruise 4 rad/s [code]. The hanging arm angle (30 deg) is [EST].
 */
const EXPORT_ARM = 78;

export function buildNocturneCad(root: THREE.Group, k: ModelKit, animated: () => boolean): RobotModel {
  const arm = cadJoint(root,['arm','shooter'],[.165,.5145,0],'cad-shooter-pivot');
  const intake = cadAnchor(root,root,[-.4,.07,0],'cad-intake-mouth');
  const exit = THREE.MathUtils.degToRad(-26);
  const held = cadAnchor(root,arm,[.002,.903,0],'cad-held-note',exit);
  const shot = cadAnchor(root,arm,[.17,.84,0],'cad-shot-mouth',exit);
  cadAnchor(root,arm,[-.03,.85,0],'cad-climb-hook');
  let angle = EXPORT_ARM;
  return {
    replaces:['chassis','launcher','hopper','intakeRollers','climber','funnel'],
    intakeAnchor:intake,heldAnchor:held,lightAt:[0,.3,.3],
    flow:{intake:()=>[cadPoint(k,intake),new THREE.Vector3(-.36,.2,0),cadPoint(k,held)],stow:()=>cadPoint(k,held),feed:()=>[cadPoint(k,held),cadPoint(k,shot)]},
    update(s) {
      const active = animated(), climbing = s.climb > 0, aim = s.aiming || s.firing > 0;
      // Arm setpoints in degrees from the stowed stop (Skip-5.14-Nocturne Constants).
      const target = climbing ? (s.climb > .5 ? 88 : 30) : s.amp ? 93 : aim || s.passing
        ? THREE.MathUtils.clamp(52-THREE.MathUtils.radToDeg(s.hood),0,60) : s.intaking ? 1 : 0;
      angle = active ? scoringActuator(angle,target,THREE.MathUtils.radToDeg(4),s.dt) : EXPORT_ARM;
      arm.rotation.z = THREE.MathUtils.degToRad(EXPORT_ARM-angle);
    },
  };
}
