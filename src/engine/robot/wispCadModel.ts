import * as THREE from 'three';
import { scoringEase } from './scoringReadiness';
import { transferFold } from '../../seasons/2025-reefscape/transferVisual';
import type { ModelKit, RobotModel } from './models';
import { anchor, ease, mount, parked, placeOf, point, type V3 } from './reefscapeCadRig';

// 422 Mech Tech Dragons Wisp (2025). Source: public Onshape "Wisp Public" / Main Assembly, CAD + binder release
// https://www.chiefdelphi.com/t/501340, reveal https://www.chiefdelphi.com/t/497928; TBA 2025 pit photos
// (refs/422-2025/sheet.jpg). The linked binder document has since been deleted, so mechanism behaviour below is read
// from the CAD and photos.
// Checklist:
// - Archetype: continuous-belt elevator (fixed 1st stage, 2nd and 3rd stages, carriage; nested side tubes at
//   ±.197/.165/.133/.10 m) carrying a fixed-angle "Manipulator" with no wrist: two rows of 3 in compliant wheels and
//   sushi rollers eject CORAL lying across the robot, ALGAE Directors and an ALGAE crossbar above it [EST: ALGAE seat].
// - Intake end: back (source -Y -> robot -X). A station funnel (Funnel Mk2) feeds the manipulator; the "Ground Coral"
//   star-wheel arm stows upright over the funnel and swings out over the back bumper about its 36T sprocket shaft,
//   then flips CORAL back up into the funnel (fold handoff); 2.0 rad puts the star wheels on the carpet.
// - Scoring end: front (+X), over the elevator's front face.
// - Climber: right side (+Z). Spring-loaded L plates with hooks pivot about bushings at (x .337, z .4056 source); the
//   MAXPlanetary winch pulls the robot up [EST: unfold angle].
// - Colours: CAD finishes; green printed parts and clear polycarbonate match the pit photos.
// - Rates: unpublished; lift, cycle, drive and climb are simulator estimates.
// Axes: source (Y, Z, X) -> robot (X, Y, Z), meters.
const CORAL: V3 = [.20, .24, 0];     // CORAL across the manipulator, resting on its guides under both wheel rows
const ALGAE: V3 = [.40, .50, 0];     // [EST] ALGAE pinned by the upper wheel row, ALGAE Directors and crossbar
const INTAKE: V3 = [-.1956, .3023, 0];
const MOUTH: V3 = [-.2074, .6692, 0]; // star-wheel roller in the stowed export pose
const CLIMB: V3 = [-.051, .4056, .337];
const CAGE: V3 = [-.05, .545, .13];
const DEPLOY = 2.0, CLIMB_OUT = 1.5, RISE: [number, number] = [0, 1.6];

export function buildWispCad(root: THREE.Group, k: ModelKit, animated: () => boolean): RobotModel {
  const stage2 = mount(root, 'elevator-stage', [0, 0, 0]), stage3 = mount(root, 'elevator-stage-2', [0, 0, 0]);
  const carriage = mount(root, 'carriage', [0, 0, 0]), head = mount(root, 'effector', [0, 0, 0], carriage);
  const held = anchor(root, head, CORAL), algae = anchor(root, head, ALGAE);
  const intake = mount(root, 'intake', INTAKE), tip = anchor(root, intake, MOUTH);
  const climber = mount(root, 'climber', CLIMB), cage = anchor(root, climber, CAGE);
  let rise = 0, deploy = 0, out = 0;
  return {
    replaces: ['chassis', 'mast', 'hopper', 'intakeRollers', 'climber', 'funnel'],
    heldAnchor: held, coralAxis: [0, 0, 1], algaeAnchor: algae, algaeGripScale: [.82, .94, .82],
    intakeAnchor: tip, climbAnchor: cage, handoffStyle: 'fold', lightAt: [.02, .96, 0],
    flow: { handoff: () => [point(k, tip), new THREE.Vector3(-.12, .50, 0), new THREE.Vector3(.08, .32, 0), point(k, held)] },
    update(s) {
      if (!animated()) return;
      const p = placeOf(s);
      // No wrist: the elevator alone raises the fixed manipulator to the CORAL / ALGAE height.
      const target = parked(p) || p.handoff ? 0 : p.height - (p.algae ? ALGAE[1] : CORAL[1]);
      rise = scoringEase(rise, THREE.MathUtils.clamp(target, RISE[0], RISE[1]), s.dt);
      stage2.position.y = rise / 3; stage3.position.y = rise * 2 / 3; carriage.position.y = rise;
      deploy = p.handoff ? 1 - transferFold(p.handoff) : ease(deploy, s.intaking ? 1 : 0, s.dt, 7);
      intake.rotation.z = deploy * DEPLOY;
      out = ease(out, CLIMB_OUT * THREE.MathUtils.clamp((s.climb - .25) / .75, 0, 1), s.dt, 6);
      climber.rotation.x = out;
    },
  };
}
