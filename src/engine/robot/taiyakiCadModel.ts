import * as THREE from 'three';
import { scoringEase } from './scoringReadiness';
import type { ModelKit, RobotModel } from './models';
import { anchor, ease, mount, parked, pitchIK, placeOf, point, type V3 } from './reefscapeCadRig';

// 5940 BREAD Taiyaki (2025). Source: public Onshape "5940 BREAD 2025 - Taiyaki" (A-0000-Taiyaki), team CAD release
// https://www.chiefdelphi.com/t/501347 and its technical binder; TBA 2025 photos (refs/5940-2025/sheet.jpg).
// Checklist (binder unless marked):
// - Archetype: 2-stage cascade elevator (SDS blocks, 2x X60, full height in 0.5 s) on the robot's left side. The
//   carriage carries a "pivot" (3.5 in X-contact bearing, 52:1) holding a cantilevered single-motor end effector:
//   CORAL fingers (x≈0) and ALGAE squish-wheel claw (x≈.15) side by side, so it holds one of each.
// - Intake end: full-width over-bumper floor intake on the back (source -Y -> robot -X), chain-deployed about the
//   48T sprocket shaft; indexer with star wheels hands CORAL forward/up into the end effector. No station funnel.
// - Scoring end: front (+X); the effector swings forward over the bumper. L1 bar on the intake [not animated].
// - Climber: torsion-spring arm on the right side (+Z) unfolds outward about bushings at (x .3429, z .437 source);
//   25:1 MAXPlanetary winch pulls it back in, 1.5 s to lift. Deep cage.
// - Colours: CAD finishes (silver structure, black plates/wheels) match the match photos.
// - Rates: 15 ft/s drive, elevator full travel 0.5 s (binder); cycle/harvest times [EST].
// Axes: source (Y, Z, X) -> robot (X, Y, Z), meters. Joints measured from concentric CAD hardware (robot-local):
const PIVOT: V3 = [.1905, .2476, -.0953];   // X-contact bearing / 60T sprocket on the carriage
const CORAL: V3 = [.38, .625, 0];            // CORAL seated against the finger-tip 2 in flex wheels [EST]
const ALGAE: V3 = [.59, .38, .152];          // ALGAE seat between the 3 in squish wheels (.388/.477, .242/.598)
const INTAKE: V3 = [-.3091, .3112, 0];       // 48T deploy sprocket shaft
const MOUTH: V3 = [-.62, .09, 0];            // between the 2 in and 3 in TPU front rollers (deployed export pose)
const CLIMB: V3 = [.0254, .437, .3429];      // climber arm bushings, axis +X
const CAGE: V3 = [-.16, .72, .343];          // 1 in tube / fly-swatter contact on the arm
const STOW = -1.9, CLIMB_OUT = 1.15, RISE: [number, number] = [0, 1.62];

export function buildTaiyakiCad(root: THREE.Group, k: ModelKit, animated: () => boolean): RobotModel {
  const stage = root.getObjectByName('elevator-stage');
  const carriage = mount(root, 'carriage', [0, 0, 0]);
  const head = mount(root, 'effector', PIVOT, carriage);
  const held = anchor(root, head, CORAL), algae = anchor(root, head, ALGAE);
  const intake = mount(root, 'intake', INTAKE), tip = anchor(root, intake, MOUTH);
  const climber = mount(root, 'climber', CLIMB), cage = anchor(root, climber, CAGE);
  let rise = 0, pitch = 0, deploy = 1, out = 0;
  return {
    replaces: ['chassis', 'mast', 'hopper', 'intakeRollers', 'climber', 'funnel'],
    heldAnchor: held, coralAxis: [0, 0, 1], algaeAnchor: algae, algaeGripScale: [.80, .96, .80],
    intakeAnchor: tip, climbAnchor: cage, handoffStyle: 'conveyor', lightAt: [.19, 1.06, -.18],
    flow: { handoff: () => [point(k, tip), new THREE.Vector3(-.25, .28, 0), new THREE.Vector3(.12, .30, -.02), point(k, held)] },
    update(s) {
      if (!animated()) return;
      const p = placeOf(s);
      let r = 0, a = 0;
      if (!parked(p) && !p.handoff) ({ rise: r, angle: a } = pitchIK(PIVOT, p.algae ? ALGAE : CORAL, p.forward, p.height, RISE));
      rise = scoringEase(rise, r, s.dt); pitch = scoringEase(pitch, a, s.dt);
      carriage.position.y = rise;
      if (stage) stage.position.y = rise / 2; // cascade: stage 1 moves half the carriage travel
      head.rotation.z = pitch;
      // The indexer carries floor CORAL forward, so the intake stays down through the handoff.
      deploy = p.handoff ? deploy : ease(deploy, s.intaking ? 1 : 0, s.dt, 7);
      intake.rotation.z = (1 - deploy) * STOW;
      // Torsion spring unfolds the arm in the endgame; the winch pulls it back upright while lifting.
      out = ease(out, CLIMB_OUT * THREE.MathUtils.clamp((s.climb - .25) / .75, 0, 1), s.dt, 6);
      climber.rotation.x = out;
    },
  };
}
