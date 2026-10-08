import { scoringEase } from './scoringReadiness';
import * as THREE from 'three';
import type { ModelKit, RobotModel } from './models';
import { articulation, ease, fuel, point, replaces } from './additionalCadModels';
import { flatNet, fourBar } from './rebuiltCadKit';

/**
 * 6329 Bucks' Wrath ROMAN II (public release "6329-2026.2, Roman II - Public Release", Onshape GLB).
 *
 * Checklist (CLAUDE.md "verify before you build"):
 *  - Archetype: FIXED full-width drum shooter, no turret, no adjustable hood. FUEL climbs a vertical feed column (two
 *    cat-tongue feed rollers against a rolled plate) into the gap between the 4 in drum (front) and two powered hood
 *    rollers behind it, and leaves upward over the front. Source: CAD (drum / hood roller / feed roller parts and belt
 *    runs); Spectrum CAD Collection row 70 names Roman II as the fixed-drum rebuild of the turret Roman I.
 *  - Intake end: BACK (source -Y). Long driven four-bar carries a two-roller head (2 in 30A wheels on Versaroller
 *    tubes, two Kraken X60 on the head) out over the bumper; a dropdown tube in front of the bumper is pushed down by the
 *    driving arm. Scoring end: FRONT (source +Y, the drum).
 *  - Colours: raw aluminium side plates, purple prints, black cat-tongue drum/rollers, clear polycarbonate end and side
 *    panels with sponsor decals, black net roof (TBA 2026 photos refs/6329-2026/sheet.jpg: front and intake-end views).
 *    The CAD exports the side/end panels as opaque grey; they get a clear finish here.
 *  - Frame 30 in wide x 24 in long (Drivetrain tubes), 21.6 in tall (CAD max Z 0.548 m): a trench robot.
 *  - Capacity / rate: no team figure for Roman II. [EST] packed real-size FUEL in the deployed hopper below the net.
 *
 * Measured joints (robot metres, X = source Y, Y = source Z): drive arm on the front-roller/SplineXL axis A
 * (-.267,.2095); driven arm shaft B (-.165,.254); coupler pins C (-.567,.444) and D (-.461,.514) from the four Pivot Stub
 * Shafts; dropdown stub axle (-.286,.2605); drum shaft (.2285,.4825). The export is the deployed pose.
 * [EST] stow travel (drive arm -1.0 rad, head inside the bumper line) and the dropdown swing (0.15 rad).
 */
const A: [number, number] = [-.267, .2095], B: [number, number] = [-.165, .254], C0: [number, number] = [-.567, .444], D0: [number, number] = [-.461, .514];
const DRUM: [number, number, number] = [.2285, .4825, 0];
const SHOOTER_ROLLERS: [number, number][] = [[.0335, .527], [.0285, .487], [.0565, .375], [.0695, .2985]];
const FLOOR_ROLLERS: [number, number][] = [[.0015, .133], [-.0515, .148], [-.104, .163], [-.156, .178], [-.209, .193], [-.2665, .2095]];
const INTAKE_ROLLERS: [number, number][] = [[-.5335, .165], [-.489, .2685]];
export const ROMAN_STOW = -1.0;

export function build6329Cad(root: THREE.Group, k: ModelKit, isAnimated: () => boolean): RobotModel {
  const p = articulation(root);
  const drive = p('intake-drive-arm', [A[0], A[1], 0]);
  const driven = p('intake-driven-arm', [B[0], B[1], 0]);
  const rollers = INTAKE_ROLLERS.map(([x, y], i) => p(`intake-roller-${i}`, [x, y, 0]));
  const head = p('intake', [C0[0], C0[1], 0]);
  for (const r of rollers) head.attach(r);
  const dropdown = p('intake-dropdown', [-.286, .2605, 0]);
  const drum = p('flywheel', DRUM);
  const shooterRollers = SHOOTER_ROLLERS.map(([x, y], i) => p(`shooter-roller-${i}`, [x, y, 0]));
  const floorRollers = FLOOR_ROLLERS.map(([x, y], i) => p(`floor-roller-${i}`, [x, y, 0]));
  const linkage = fourBar(A, B, C0, D0);
  // Mouth: just under and behind the lower head roller, where FUEL is pinched against the carpet.
  const tip = new THREE.Object3D(); tip.position.set(-.555, .09, 0); root.add(tip); head.attach(tip);
  // The net stops behind the hood rollers so the shot leaves the drum gap unobstructed (TBA drum-end photo).
  const net = flatNet(root, 0, 1, .548, .76); net.visible = !k.config.hopperExpansion;
  // FUEL sits on the sloped roller floor and, when deployed, over the four-bar head; it stays clear of the feed column.
  const pile = fuel(k, -.53, .015, .17, .535, .70, -.28);
  let deploy = 1, spinFloor = 0, spinShot = 0;
  const pose = (d: number) => {
    const theta = (1 - d) * ROMAN_STOW, s = linkage.solve(theta);
    drive.rotation.z = theta;
    driven.rotation.z = Math.atan2(s.d.y - B[1], s.d.x - B[0]) - Math.atan2(D0[1] - B[1], D0[0] - B[0]);
    head.position.set(s.c.x, s.c.y, 0); head.rotation.z = s.coupler;
    dropdown.rotation.z = (1 - d) * .15; // [EST] eases back once the drive arm lifts off it (stowed photo: still at bumper level)
    const front = THREE.MathUtils.lerp(-.30, -.56, d);
    net.position.x = front; net.scale.x = -front;
  };
  // No pose() here: the unanimated CAD-export view keeps the exported (deployed) linkage; the net starts at that pose.
  net.position.x = -.56; net.scale.x = .56;
  return {
    replaces, lightAt: [-.05, .56, .30], intakeAnchor: tip,
    flow: {
      intake: () => [point(k, tip, 0, .02), point(k, rollers[1], .03, -.03), new THREE.Vector3(-.36, .24, 0), new THREE.Vector3(-.22, .22, 0)],
      stow: pile.stow,
      feed: (shot = 0) => {
        const z = ((shot % 4) - 1.5) * .15;
        return [new THREE.Vector3(-.05, .22, z), new THREE.Vector3(.11, .26, z), new THREE.Vector3(.12, .38, z), point(k, drum, -.115, .02, z), point(k, drum, -.09, .11, z)];
      },
    },
    update(s) {
      deploy = ease(deploy, s.enabled || s.fill > .5 ? 1 : 0, s.dt);
      pile.update(s.fill, deploy);
      if (!isAnimated()) return;
      pose(deploy);
      const feeding = s.enabled && (s.intaking || s.firing > 0);
      spinFloor = scoringEase(spinFloor, feeding ? 1 : 0, s.dt);
      spinShot = scoringEase(spinShot, s.enabled && (s.aiming || s.firing > 0) ? 1 : 0, s.dt);
      for (const r of rollers) r.rotation.z += 30 * spinFloor * s.dt;
      for (const r of floorRollers) r.rotation.z -= 24 * spinFloor * s.dt;
      // Drum's rear face and the hood/feed rollers' front faces both move FUEL upward through the gap.
      drum.rotation.z -= 55 * spinShot * s.dt;
      for (const r of shooterRollers) r.rotation.z += 40 * Math.max(spinShot, spinFloor * .5) * s.dt;
    },
  };
}
