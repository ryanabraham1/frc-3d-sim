import { scoringEase } from './scoringReadiness';
import * as THREE from 'three';
import type { ModelKit, RobotModel } from './models';
import { articulation, ease, fuel, point, replaces } from './additionalCadModels';

/**
 * 1987 Broncobots CYCLONE (public Onshape release "2026_1987_Main" / "1. Main"; GLB export).
 *
 * Checklist (CLAUDE.md "verify before you build"):
 *  - Archetype: TURRET over a "dye rotor" floor (spinning disc with a sweeper arm and a flex-wheel kicker up the
 *    centre column), coaxial with the turret; the turret's top is held by a fixed 1.5 in "cell tower" column. Floating
 *    hood with 1 in rollers, driven by a Thrifty cycloidal about the flywheel shaft; single 4 in urethane flywheel
 *    (CD "1987 Broncobots 2026 Robot Reveal" and CAD threads, refs/cd-517100, refs/cd-524348; CAD part names).
 *  - Intake end: BACK (source -Y). "V5 intake slip & slide" runs out on racks with the hopper's end wall, a two-roller
 *    head and a floor kicker ("dejamifier"). Scoring end: the turret, which can face anywhere.
 *  - Colours: raw aluminium frame, clear polycarbonate hopper walls, black hood/turret plates and prints, red bumpers
 *    (TBA 2026 match photos refs/1987-2026/sheet.jpg). CAD colours kept; the clock-face hopper walls get a clear finish.
 *  - Frame 25 x 30.4 in (source ±.317 x ±.386), CAD top 0.553 m: trench robot.
 *  - Capacity / rate / speed: no team figure. [EST]
 *
 * Measured joints (robot metres, X = source Y, Y = source Z, Z = source X): turret and dye-rotor axis (.038, ·, 0) from
 * the sprocket/coax plates; flywheel shaft (-.0655, .5015, -.0125); hood cycloidal bore (-.0735, .5015). The export is
 * the deployed intake. [EST] rack travel 0.20 m (end wall back to the bumper line) and hood travel 0.35 rad.
 */
export const CYCLONE_TRAVEL = .20;
const AXIS_X = .038;
/** Export heading of the shot (radians about +Y): the flywheel sits behind the turret axis, so the head faces -X. */
export const CYCLONE_EXPORT_YAW = Math.PI;

export function build1987Cad(root: THREE.Group, k: ModelKit, isAnimated: () => boolean): RobotModel {
  const p = articulation(root);
  const turret = p('turret', [AXIS_X, .41, 0]);
  const flywheel = p('flywheel', [-.0655, .5015, -.0125]);
  const hood = p('hood', [-.0735, .5015, 0]);
  turret.attach(flywheel); turret.attach(hood);
  const rotor = p('rotor', [AXIS_X, .07, 0]);
  const intake = p('intake', [0, 0, 0]);
  const tip = new THREE.Object3D(); tip.position.set(-.585, .085, 0); intake.add(tip);
  const pile = fuel(k, -.58, .27, .1, .54, .70, -.38, (x, z) => Math.hypot(x - AXIS_X, z) > .13 || x < -.2);
  let deploy = 1, spin = 0, feed = 0, lift = 0;
  return {
    replaces, lightAt: [-.25, .56, .3], intakeAnchor: tip,
    flow: {
      intake: () => [point(k, tip, 0, .02), new THREE.Vector3(-.50, .22, 0), new THREE.Vector3(-.36, .2, 0), new THREE.Vector3(-.2, .18, 0)],
      stow: pile.stow,
      feed: () => [point(k, rotor, -.15, .08), point(k, rotor, -.06, .2), new THREE.Vector3(AXIS_X, .40, 0), point(k, flywheel, .06, .02), point(k, flywheel, -.02, .11)],
    },
    update(s) {
      deploy = ease(deploy, s.enabled || s.fill > .5 ? 1 : 0, s.dt);
      pile.update(s.fill, deploy);
      if (!isAnimated()) return;
      intake.position.x = (1 - deploy) * CYCLONE_TRAVEL;
      // The simulated aim is about the launcher's +X heading; remove the export heading first.
      turret.rotation.y = k.turret.rotation.y - CYCLONE_EXPORT_YAW;
      spin = scoringEase(spin, s.enabled && (s.aiming || s.firing > 0) ? 1 : 0, s.dt);
      feed = scoringEase(feed, s.enabled && (s.intaking || s.firing > 0) ? 1 : 0, s.dt);
      flywheel.rotation.z += 60 * spin * s.dt;
      rotor.rotation.y += (s.enabled ? 1 + 5 * Math.max(feed, s.firing > 0 ? 1 : 0) : 0) * s.dt;
      // Floating hood: steeper (closer to the wheel) for short shots, flatter for long ones.
      lift = ease(lift, s.enabled && s.aiming ? THREE.MathUtils.clamp((s.hood - .6) / .6, 0, 1) : 0, s.dt);
      hood.rotation.z = .35 * lift;
    },
  };
}
