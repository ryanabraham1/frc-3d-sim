import * as THREE from 'three';
import { scoringEase } from './scoringReadiness';
import type { ModelKit, RobotModel } from './models';
import { anchor, ease, mount, parked, placeOf, type V3 } from './reefscapeCadRig';

// 190 Gompei and the H.E.R.D. Redundancy (2025 V2). Source: public Onshape "A-25B-0000" (frc190.onshape.com), CAD
// release https://www.chiefdelphi.com/t/503355 (V1 StackUp + V2 Redundancy), reveal https://www.chiefdelphi.com/t/493653;
// TBA 2025 photos (refs/190-2025/sheet.jpg) and the CAD render in the release thread.
// Checklist (CAD + release thread unless marked):
// - Archetype: two-stage elevator (V2: 2 Krakens; Team-190/2k25-Robot-Code) carrying "Gustav", a narrow CORAL end effector (plates 12 cm apart, CORAL
//   lengthwise) whose top star wheels flip CORAL up onto L4 ("the star wheel helped grab the lip of the coral and flip
//   it onto L4"), and "The Claw", an ALGAE arm pivoting on Gustav's claw shaft.
// - Intake end: CORAL only from the "clapping funnel" at the back (source -Y -> robot -X); its flaps close to hold CORAL
//   and fold for the climb [flaps not animated]. Floor ALGAE: front over-the-bumper roller on racks (A-25B-6000) that runs
//   out 0.35 m in front of the bumper (code); its retracted rack is Gustav's CORAL hard stop; the claw holds ALGAE in front of Gustav.
// - Scoring end: front (+X).
// - Climber: gas-spring ("BansBach") arm with a grappling hook at the back, Kraken winch [EST: swing angle and pivot].
// - Colours: CAD finishes (black structure, red plates) match the V2 render and match photos; bumpers drawn by the sim.
// - Rates: weight about 115 lb (reveal thread, V1); lift, cycle and climb are simulator estimates.
// Axes: source (Y, Z, X) -> robot (X, Y, Z), meters, origin at the frame centre on the carpet.
const CORAL: V3 = [.2, .52, 0];          // CORAL along Gustav's wheel rows, below the top star wheel [EST]
const AXIS: V3 = [.905, -.426, 0];
const CLAW: V3 = [.133, .688, 0];        // CLAW PIVOT SHAFT, axis +Z
const ALGAE: V3 = [.444, .301, 0];       // ALGAE under the claw's roller cores, export (floor) pose [EST]
const FUNNEL: V3 = [-.01, .6, 0];        // funnel throat above Gustav
const CLIMB: V3 = [-.222, .133, 0];      // climber arm shaft (72T gear), axis +Z [EST]
const CAGE: V3 = [-.18, .55, 0];         // grappling hook
const SLIDE = .35, CLIMB_OUT = 1.2, RISE: [number, number] = [0, 1.443], CARRIAGE_FIRST = .82;

export function buildRedundancyCad(root: THREE.Group, _k: ModelKit, animated: () => boolean): RobotModel {
  const stage = mount(root, 'elevator-stage', [0, 0, 0]), carriage = mount(root, 'carriage', [0, 0, 0]);
  const gustav = mount(root, 'effector', [0, 0, 0], carriage), claw = mount(root, 'algae', CLAW, gustav);
  const held = anchor(root, gustav, CORAL), algae = anchor(root, claw, ALGAE), funnel = anchor(root, root, FUNNEL);
  const intake = mount(root, 'intake', [0, 0, 0]);
  const climber = mount(root, 'climber', CLIMB), cage = anchor(root, climber, CAGE);
  const seat = new THREE.Vector2(ALGAE[0] - CLAW[0], ALGAE[1] - CLAW[1]);
  let rise = 0, tilt = 0, slide = 0, out = 0;
  return {
    replaces: ['chassis', 'mast', 'hopper', 'intakeRollers', 'climber', 'funnel'],
    heldAnchor: held, coralAxis: [AXIS[0], AXIS[1], AXIS[2]], algaeAnchor: algae, algaeGripScale: [.8, .96, .8],
    intakeAnchor: funnel, climbAnchor: cage, handoffStyle: 'direct', lightAt: [.07, 1.07, 0],
    update(s) {
      if (!animated()) return;
      const p = placeOf(s), floorAlgae = s.intaking && parked(p);
      // Claw from STOW_DOWN (-77°, the export pose): REEF +31°, PROCESSOR +36°, NET STOW_UP +152° (ball carried over
      // the elevator top), floor +3.5°; it hangs at stow otherwise.
      const want = !p.algae ? (floorAlgae ? .06 : 0) : p.height > 1.7 ? 2.65 : p.height < .7 ? .63 : .54;
      const seatY = CLAW[1] + seat.clone().rotateAround(new THREE.Vector2(), want).y;
      const target = parked(p) ? 0 : p.height - (p.algae ? seatY : CORAL[1]);
      rise = scoringEase(rise, THREE.MathUtils.clamp(target, RISE[0], RISE[1]), s.dt);
      // Mechanism3d: the carriage climbs its own stage first, then stage 1 carries the rest.
      stage.position.y = Math.max(0, rise - CARRIAGE_FIRST); carriage.position.y = rise;
      tilt = ease(tilt, want, s.dt, 7); claw.rotation.z = tilt;
      slide = ease(slide, floorAlgae ? 1 : 0, s.dt, 6); intake.position.x = slide * SLIDE;
      out = ease(out, CLIMB_OUT * THREE.MathUtils.clamp((s.climb - .25) / .75, 0, 1), s.dt, 6);
      climber.rotation.z = out;
    },
  };
}
