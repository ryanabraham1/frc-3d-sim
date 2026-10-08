import * as THREE from 'three';
import { scoringEase } from './scoringReadiness';
import type { ModelKit, RobotModel } from './models';
import { anchor, ease, mount, parked, placeOf, type V3 } from './reefscapeCadRig';

// 3005 RoboChargers Relay (2025). Source: public Onshape "3005 2025: FULL ROBOT (PUBLIC)", CAD release
// https://www.chiefdelphi.com/t/504887, reveal https://www.chiefdelphi.com/t/493529; TBA 2025 photo (refs/3005-2025/sheet.jpg).
// Checklist:
// - Archetype (reveal): "a coral ejector and an algae gripper attached to a laterator, mounted on a 3 stage elevator";
//   continuous chain elevator (CAD thread). CORAL goes through the elevator: the station chute and serializer feed it
//   up into the ejector from behind. The laterator slides the ejector sideways to line up with a branch; the sim
//   has no lateral alignment state, so it stays centred [not animated].
// - Intake end: back (source +Y -> robot -X): Coral Chute with a flap and the Coral Serializer. No floor intake.
// - Scoring end: front (+X); the ejector shoots CORAL forward and down along its roller rows (reference "Coral (Deployed)").
// - ALGAE: gripper (two pairs of 3 in roller wheels) pivoting on the laterator at the 7A12 arm sprocket; it stows
//   pointing up and back over the robot and swings forward to grip ALGAE [EST: swing angle].
// - Climber: "Climber V2" arm on the right side (+Z), pivoting on the 8F01 sprocket (axis along the robot) with hooks
//   and a guide wedge; it swings up and out over the right bumper for the deep cage [EST: angle].
// - Colours: black structure and clear polycarbonate match the TBA photo; the pink block-CAD wiring harness is omitted.
// - Rates: unpublished; lift, cycle and climb are simulator estimates.
// Axes: source (-Y, Z, -X) -> robot (X, Y, Z), meters, origin at the frame centre on the carpet.
const CORAL: V3 = [.137, .299, 0];      // reference "Coral (Deployed)" between the ejector roller rows
const AXIS: V3 = [.908, -.419, 0];      // CORAL leaves forward and down along the lower roller row
const GRIP: V3 = [.31, .406, 0];        // algae gripper pivot (7A12 arm sprocket)
const ALGAE: V3 = [.066, .795, 0];      // ALGAE squeezed between the roller wheel pairs, stowed export pose [EST]
const CHUTE: V3 = [-.1, .45, 0];        // serializer outlet below the ejector
const CLIMB: V3 = [.031, .459, .315];   // 8F01 climber sprocket, axis +X
const CAGE: V3 = [0, .6, .097];         // hooks and guide wedge
const GRIP_OUT = -1.2, CLIMB_OUT = 1.6, RISE: [number, number] = [0, 1.75];

export function buildRelayCad(root: THREE.Group, _k: ModelKit, animated: () => boolean): RobotModel {
  const stage1 = mount(root, 'elevator-stage', [0, 0, 0]), stage2 = mount(root, 'elevator-stage-2', [0, 0, 0]);
  const carriage = mount(root, 'carriage', [0, 0, 0]), ejector = mount(root, 'effector', [0, 0, 0], carriage);
  const gripper = mount(root, 'algae', GRIP, carriage);
  const held = anchor(root, ejector, CORAL), algae = anchor(root, gripper, ALGAE), chute = anchor(root, root, CHUTE);
  const climber = mount(root, 'climber', CLIMB), cage = anchor(root, climber, CAGE);
  const seat = new THREE.Vector2(ALGAE[0] - GRIP[0], ALGAE[1] - GRIP[1]);
  let rise = 0, tilt = 0, out = 0;
  return {
    replaces: ['chassis', 'mast', 'hopper', 'intakeRollers', 'climber', 'funnel'],
    heldAnchor: held, coralAxis: [AXIS[0], AXIS[1], AXIS[2]], algaeAnchor: algae, algaeGripScale: [.8, .96, .8],
    intakeAnchor: chute, climbAnchor: cage, handoffStyle: 'direct', lightAt: [-.05, 1.05, .3],
    update(s) {
      if (!animated()) return;
      const p = placeOf(s);
      const want = p.algae ? GRIP_OUT : 0;
      // The elevator carries the ejector (or the swung-out ALGAE seat) to the placement height.
      const seatY = GRIP[1] + seat.clone().rotateAround(new THREE.Vector2(), want).y;
      const target = parked(p) ? 0 : p.height - (p.algae ? seatY : CORAL[1]);
      rise = scoringEase(rise, THREE.MathUtils.clamp(target, RISE[0], RISE[1]), s.dt);
      stage1.position.y = rise / 3; stage2.position.y = rise * 2 / 3; carriage.position.y = rise;
      tilt = ease(tilt, want, s.dt, 7); gripper.rotation.z = tilt;
      out = ease(out, CLIMB_OUT * THREE.MathUtils.clamp((s.climb - .25) / .75, 0, 1), s.dt, 6);
      climber.rotation.x = out;
    },
  };
}
