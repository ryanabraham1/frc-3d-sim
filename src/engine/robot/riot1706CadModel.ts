import { scoringActuator } from './scoringReadiness';
import * as THREE from 'three';
import type { ModelKit, RobotModel } from './models';
import { actuator, cadAnchor, cadJoint, cadPoint } from './crescendoCadJoints';

/** 1706 Ratchet Rockers "Riot" (public Onshape "CR-000-00" full robot).
 *
 * Checklist (CLAUDE.md "verify before you build"):
 * - Archetype: rack-and-pinion pivoting shooter at the front + 16 degree back-leaning two-stage elevator whose
 *   CR800 roller carriage scores AMP/TRAP + two Thrifty 2-stage telescoping climbers. Source: Onshape mates
 *   (Cylindrical 1 indexer <-> shooter pivot, Planar 5/6 rack/pinion, Slider 2 carriage <-> inner stage) and the
 *   part tree (TTB Telescoping Tube configs).
 * - Intake end: both. One under-bumper roller train with squish-wheel rollers at both bumper faces (front roller
 *   at the drivetrain Revolute 1, rear roller at the indexer), so the roster entry takes NOTES on both sides
 *   (`dualSideIntake`).
 * - Scoring end: front (+X) for the SPEAKER; the carriage on the elevator over the back serves AMP/TRAP.
 * - Colours: silver/clear structure, blue polycarbonate and blue/orange shooter wheels, blue "RIOT" bumpers
 *   (TBA 2024 photos, refs/1706-2024).
 * - Capacity 1 NOTE (rule). Shooter export exit angle 8 deg (normal to the exit wheel pair); hood range
 *   8..60 deg, elevator travel (AMP 0.30 m, TRAP 0.55 m along the rails) and 0.45 m climber stroke are [EST]
 *   from the rail and tube overlaps in the CAD.
 */
const ELEVATOR = new THREE.Vector3(-.276,.961,0).normalize();

export function buildRiotCad(root: THREE.Group, k: ModelKit, animated: () => boolean): RobotModel {
  const shooter = cadJoint(root,['shooter'],[-.0941,.2533,0],'cad-shooter-pivot');
  const stage = root.getObjectByName('elevator-stage')!, carriage = root.getObjectByName('carriage')!;
  const hooks = root.getObjectByName('climber')!, mid = root.getObjectByName('climber-mid');
  const rests = [stage,carriage,hooks,mid].map(o => o?.position.clone() ?? new THREE.Vector3());
  const intake = cadAnchor(root,root,[-.3,.07,0],'cad-intake-mouth');
  const held = cadAnchor(root,shooter,[.08,.33,0],'cad-held-note',THREE.MathUtils.degToRad(8));
  const shot = cadAnchor(root,shooter,[.29,.36,0],'cad-shot-mouth',THREE.MathUtils.degToRad(8));
  cadAnchor(root,hooks,[.13,.5,.3],'cad-climb-hook');
  let pitch = 0, lift = 0, reach = 0;
  return {
    replaces:['chassis','launcher','hopper','intakeRollers','climber','funnel'],
    intakeAnchor:intake,heldAnchor:held,lightAt:[0,.3,.3],
    flow:{intake:()=>[cadPoint(k,intake),new THREE.Vector3(-.12,.1,0),cadPoint(k,held)],stow:()=>cadPoint(k,held),feed:()=>[cadPoint(k,held),cadPoint(k,shot)]},
    update(s) {
      const active = animated(), climbing = s.climb > 0, aim = s.aiming || s.firing > 0;
      const angle = aim || s.passing ? THREE.MathUtils.clamp(s.hood,THREE.MathUtils.degToRad(8),THREE.MathUtils.degToRad(60)) : THREE.MathUtils.degToRad(8);
      pitch = active ? scoringActuator(pitch,angle-THREE.MathUtils.degToRad(8),4,s.dt) : 0;
      // TRAP: "hold Y to put the elevator at max height after the driver climbed" (1706 code release).
      lift = active ? scoringActuator(lift,climbing && s.climb <= .5 ? .55 : s.amp ? .3 : 0,1.2,s.dt) : 0;
      reach = active ? actuator(reach,climbing ? (s.climb > .5 ? .45 : .08) : 0,.8,s.dt) : 0;
      shooter.rotation.z = pitch;
      // Continuous rigging: the inner stage moves half as far as the carriage it carries.
      stage.position.copy(rests[0]).addScaledVector(ELEVATOR,lift/2);
      carriage.position.copy(rests[1]).addScaledVector(ELEVATOR,lift);
      hooks.position.copy(rests[2]); hooks.position.y += reach;
      if (mid) { mid.position.copy(rests[3]); mid.position.y += reach/2; }
    },
  };
}
