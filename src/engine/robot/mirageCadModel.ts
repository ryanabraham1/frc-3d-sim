import { dyeRotorRate, scoringEase } from './scoringReadiness';
import * as THREE from 'three';
import type { ModelKit, RobotModel } from './models';
import { articulation, ease, fuel, point, replaces } from './additionalCadModels';

/**
 * 1706 Ratchet Rockers MIRAGE, Championship configuration (public Onshape release "RB-MIRAGE" / "Mirage Public Release").
 *
 * Checklist (CLAUDE.md "verify before you build"):
 *  - Archetype: TWIN TURRETS ("seeing double", hence the name: team, CD CAD-release thread 522276), each fed by its own
 *    spindexer floor (two discs with blue centre cones). Each head: two 3 in urethane shooter wheels at the front, two
 *    shafts of 1 in "rear accelerator" wheels run at a different speed (team post), a 5 in aluminium inertia flywheel
 *    geared beside them. No adjustable hood in the CAD; dual CANcoders track turret yaw.
 *  - Intake end: BACK (source -X). The intake head and the black-walled hopper extension box translate out together
 *    ("the bumper foam is just pushed out of the way when the [intake] extends out", team). Scoring end: FRONT (turrets).
 *  - Climber: removed for Champs; the Thrifty telescoping tube left on the robot only stiffens the Limelight mount (team).
 *  - Colours: raw aluminium pocketed plates, blue 3D prints and turret rings, black hopper walls with the MIRAGE logo
 *    (TBA 2026 match photo refs/1706-2026/sheet.jpg; CD CAD screenshots refs/cd-522276/sheet.jpg).
 *  - Frame 25.2 x 29.5 in (chassis plates), CAD top 0.548 m: trench robot.
 *  - Capacity / rate / speed: no team figure. [EST] packed real-size FUEL; rate split over two streams.
 *
 * Measured joints (robot metres): turret rings (gear centres) at (.165, .33, ±.2225); export head yaw from the 1 in → 3 in
 * wheel line: right -0.3437 rad, left -0.4896 rad (the two heads were exported at different yaws); spindexer axes
 * (-.0885, ±.1775). [EST] intake/extension travel 0.30 m (front returns to the frame line).
 */
const TURRET_X = .165, TURRET_Y = .33, TURRET_Z = .2225;
const EXPORT_YAW = { left: -.4896, right: -.3437 };
export const MIRAGE_TRAVEL = .30;

export function build1706Cad(root: THREE.Group, k: ModelKit, isAnimated: () => boolean): RobotModel {
  const p = articulation(root);
  const sides = (['left', 'right'] as const).map(side => {
    const z = side === 'left' ? -TURRET_Z : TURRET_Z, yaw = EXPORT_YAW[side];
    const turret = p(`turret-${side}`, [TURRET_X, TURRET_Y, z]);
    // Shafts lie across each head: pivot frames carry the head's export yaw so local Z is the shaft axis.
    const wheelsAt = side === 'left' ? [.258, .4607, -.1727] : [.2642, .4607, .2577];
    const flyAt = side === 'left' ? [.1121, .4488, -.1228] : [.1272, .4488, .3284];
    const wheels = p(`wheels-${side}`, wheelsAt as [number, number, number], yaw);
    const flywheel = p(`flywheel-${side}`, flyAt as [number, number, number], yaw);
    turret.attach(wheels); turret.attach(flywheel);
    const rotor = p(`rotor-${side}`, [-.0885, .16, side === 'left' ? -.1775 : .1775]);
    return { turret, wheels, flywheel, rotor, yaw };
  });
  const intake = p('intake', [0, 0, 0]);
  const rollers = [p('intake-roller-0', [-.564, .1595, 0]), p('intake-roller-1', [-.5325, .2585, 0])];
  for (const r of rollers) intake.attach(r);
  const tip = new THREE.Object3D(); tip.position.set(-.585, .08, 0); intake.add(tip);
  // FUEL rests on the spindexer floors and the extension box floor, behind the turret rings.
  const pile = fuel(k, -.60, .03, .17, .535, .70, -.30);
  let deploy = 1, spin = 0, feed = 0, rotorRate = 0;
  return {
    replaces, lightAt: [-.2, .56, .33], intakeAnchor: tip,
    flow: {
      intake: () => [point(k, tip, 0, .02), point(k, rollers[1], .04, -.02), new THREE.Vector3(-.33, .26, 0), new THREE.Vector3(-.2, .24, 0)],
      stow: pile.stow,
      feed: (shot = 0) => {
        const head = sides[shot % 2];
        return [point(k, head.rotor, .12, .09), point(k, head.turret, 0, .02), point(k, head.wheels, -.09, -.02), point(k, head.wheels, .02, .06)];
      },
    },
    update(s) {
      deploy = ease(deploy, s.enabled || s.fill > .5 ? 1 : 0, s.dt);
      pile.update(s.fill, deploy);
      if (!isAnimated()) return;
      intake.position.x = (1 - deploy) * MIRAGE_TRAVEL;
      spin = scoringEase(spin, s.enabled && (s.aiming || s.firing > 0) ? 1 : 0, s.dt);
      feed = scoringEase(feed, s.enabled && (s.intaking || s.firing > 0) ? 1 : 0, s.dt);
      rotorRate = dyeRotorRate(rotorRate, s, 9);
      for (const h of sides) {
        // Both heads share the simulated aim; remove each head's own export yaw first.
        h.turret.rotation.y = k.turret.rotation.y - h.yaw;
        h.wheels.rotation.z += 60 * spin * s.dt;
        h.flywheel.rotation.z += 45 * spin * s.dt;
        h.rotor.rotation.y += rotorRate * s.dt;
      }
      for (const r of rollers) r.rotation.z += 30 * feed * s.dt;
    },
  };
}
