import * as THREE from 'three';
import { scoringEase } from './scoringReadiness';
import type { ModelKit, RobotModel } from './models';
import { anchor, ease, mount, parked, pitchIK, placeOf, type V3 } from './reefscapeCadRig';

// 1706 Ratchet Rockers Singularity (2025). Source: public Onshape "RS-000 Singularity - Public Release", CAD/code
// release https://www.chiefdelphi.com/t/510177 (code: github.com/rr1706/konshu, whose README lists the subsystems),
// teaser https://www.chiefdelphi.com/t/495400. TBA has no 2025 photos for 1706; the teaser video frames
// (refs/cd-495400/sheet.jpg) show the blue bumpers, clear funnel and elevator.
// Checklist (CAD + code README unless marked):
// - Archetype: three-stage belt elevator (RS-200, nested tube pairs at |y| .2413 / .2032 / .1651 source) with a carriage
//   (RS-300) driving a pivoting arm (RS400, "Arm" Kraken through 48T sprockets on a MAXSpline shaft). The arm carries a
//   narrow CORAL channel (plates 13 cm apart, CORAL lengthwise) and stealth wheels that pin ALGAE on its front face
//   ("Algae on Arm" / "Coral on Arm" motors), so it can hold one of each [EST: CORAL seat in the channel].
// - Intake end: CORAL only from the station funnel at the back (RS-700 belt-roller ramp sloping down to the arm pivot).
//   No floor CORAL intake. Floor ALGAE: front over-the-bumper roller (RS-500, "Algae Intake Deploy" + roller) on a large
//   curved rack (888T, 20 DP: 0.564 m pitch radius) driven by a fixed pinion; the roller retracts along that arc into
//   the frame [EST: arc centre fitted through the pinion and rack ends, travel 0.7 rad, enough to bring the roller inside the bumper].
// - Scoring end: front (+X, source -X), over the bumper by the arm.
// - Climber: "Harpoon" (RS-600) at the back, cage rollers on a winch-driven arm pivoting on the 40T sprocket shaft
//   [EST: swing angle].
// - Colours: CAD finishes; blue bumpers omitted (drawn by the sim).
// - Rates: unpublished; lift, cycle and climb are simulator estimates.
// Axes: source (-X, Z, Y) -> robot (X, Y, Z), origin moved to the frame centre (offset .3555 m) and the wheel contact.
const PIVOT: V3 = [.0761, .3745, 0];   // MAXSpline arm shaft / 48T sprockets on the carriage
const CORAL: V3 = [.2125, .264, 0];    // CORAL centre between the middle channel wheels [EST]
const ALGAE: V3 = [.4435, .52, 0];     // reference ALGAE in the export, pinned by the front stealth wheels
const FUNNEL: V3 = [-.1545, .461, 0];  // bottom of the funnel's belt-roller ramp
const CLIMB: V3 = [-.3049, .4641, 0];  // 40T sprocket shaft, axis +Z
const CAGE: V3 = [-.43, .55, 0];       // harpoon fingers and 3 in compliant cage rollers
const AXIS: V3 = [.742, -.671, 0];     // CORAL runs along the channel (export pose)
const RACK: V3 = [.283, .69, 0];        // centre of the 888T curved rack's pitch circle (the pinion sits on it)
const RETRACT = -.7, CLIMB_OUT = .7, RISE: [number, number] = [0, 1.8];

export function buildSingularityCad(root: THREE.Group, _k: ModelKit, animated: () => boolean): RobotModel {
  const stage2 = mount(root, 'elevator-stage', [0, 0, 0]), stage3 = mount(root, 'elevator-stage-2', [0, 0, 0]);
  const carriage = mount(root, 'carriage', [0, 0, 0]), arm = mount(root, 'effector', PIVOT, carriage);
  const held = anchor(root, arm, CORAL), algae = anchor(root, arm, ALGAE);
  const intake = mount(root, 'intake', RACK);
  const funnel = anchor(root, root, FUNNEL);
  const climber = mount(root, 'climber', CLIMB), cage = anchor(root, climber, CAGE);
  let rise = 0, pitch = 0, deploy = 1, out = 0;
  return {
    replaces: ['chassis', 'mast', 'hopper', 'intakeRollers', 'climber', 'funnel'],
    heldAnchor: held, coralAxis: [AXIS[0], AXIS[1], AXIS[2]], algaeAnchor: algae, algaeGripScale: [.8, .96, .8],
    intakeAnchor: funnel, climbAnchor: cage, handoffStyle: 'direct', lightAt: [.08, 1.0, .3],
    update(s) {
      if (!animated()) return;
      const p = placeOf(s), floorAlgae = s.intaking && parked(p);
      let r = 0, a = 0;
      if (!parked(p)) ({ rise: r, angle: a } = pitchIK(PIVOT, p.algae ? ALGAE : CORAL, p.forward, p.height, RISE));
      rise = scoringEase(rise, r, s.dt); pitch = scoringEase(pitch, a, s.dt);
      // Three-stage elevator: each stage carries an equal share of the carriage travel [EST: cascade rigging].
      stage2.position.y = rise / 3; stage3.position.y = rise * 2 / 3; carriage.position.y = rise;
      arm.rotation.z = pitch;
      // The export has the ALGAE roller run out over the front bumper; the rack carries it back along its arc when idle.
      deploy = ease(deploy, floorAlgae ? 1 : 0, s.dt, 6);
      intake.rotation.z = (1 - deploy) * RETRACT;
      out = ease(out, CLIMB_OUT * THREE.MathUtils.clamp((s.climb - .25) / .75, 0, 1), s.dt, 6);
      climber.rotation.z = out;
    },
  };
}
