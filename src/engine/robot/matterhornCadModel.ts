import { scoringEase } from './scoringReadiness';
import * as THREE from 'three';
import type { ModelKit, RobotModel } from './models';
import { articulation, ease, fuel, point, replaces } from './additionalCadModels';
import { flatNet } from './rebuiltCadKit';

/**
 * 9496 LYNK MATTERHORN (public Onshape release "9496_2026_LYNK_Matterhorn_Public"; GLB export).
 *
 * Checklist (CLAUDE.md "verify before you build"):
 *  - Archetype: FIXED full-width drum shooter, no turret, no hood actuator. A three-roller vertical feeder lifts FUEL in
 *    front of the drum ("Feeder V3"); the drum (with brass inertia flywheels on its ends) throws it up past three printed
 *    "shooter path" guides at the front. Sloped roller floor ("Hopper Floor V4"). Source: CAD part names and layout.
 *  - Intake end: BACK (source -Y). "Intake V2" pivots on a sector "Pivot Gear" driven by an 11t pinion in the floor; the
 *    hopper's slotted side panels and end panel ("Comp Hopper V5") telescope out with it. Scoring end: FRONT (drum).
 *  - Colours: black anodised/powder-coat plates and prints, orange accents, black net roof, red/black bumpers
 *    (TBA 2026 photos refs/9496-2026/sheet.jpg: shooter-end view with the net, and a loaded-hopper view). CAD colours kept.
 *  - Frame 27 x 27 in (source chassis ±.343), CAD top about 0.556 m: trench robot.
 *  - Capacity / rate / speed: no team figure (CD build log refs/cd-511797 has none). [EST]
 *
 * Measured joints (robot metres, X = source Y, Y = source Z): drum (.127, .454); feeder rollers x .158 at y .28 / .334 /
 * .388; intake rollers (-.511, .256) and (-.576, .161). [EST] intake pivot (-.38, .20) from the sector gear and pinion
 * layout, stow angle 1.75 rad, hopper telescope travel 0.24 m. The export is the deployed pose.
 */
const PIVOT: [number, number, number] = [-.38, .20, 0];
export const MATTERHORN_STOW = 1.75;
export const MATTERHORN_TRAVEL = .24;

export function build9496Cad(root: THREE.Group, k: ModelKit, isAnimated: () => boolean): RobotModel {
  const p = articulation(root);
  const intake = p('intake', PIVOT);
  const rollers = [p('intake-roller-0', [-.511, .256, 0]), p('intake-roller-1', [-.576, .161, 0])];
  for (const r of rollers) intake.attach(r);
  const ext = p('hopper-ext', [0, 0, 0]);
  const drum = p('flywheel', [.127, .454, 0]);
  const feeders = [.28, .334, .388].map((y, i) => p(`feeder-roller-${i}`, [.158, y, 0]));
  const tip = new THREE.Object3D(); tip.position.set(-.60, .085, 0); root.add(tip); intake.attach(tip);
  const net = flatNet(root, 0, 1, .556, .66); net.visible = !k.config.hopperExpansion;
  net.position.x = -.64; net.scale.x = .64 + .14;
  const pile = fuel(k, -.60, .14, .17, .54, .64, -.36);
  let deploy = 1, spinShot = 0, spinFeed = 0;
  return {
    replaces, lightAt: [-.1, .56, .3], intakeAnchor: tip,
    flow: {
      intake: () => [point(k, tip, 0, .02), point(k, rollers[0], .03, -.03), new THREE.Vector3(-.36, .24, 0), new THREE.Vector3(-.2, .22, 0)],
      stow: pile.stow,
      feed: (shot = 0) => {
        const z = ((shot % 3) - 1) * .19;
        return [new THREE.Vector3(.05, .22, z), point(k, feeders[0], .07, 0, z), point(k, feeders[2], .07, 0, z), point(k, drum, .1, .02, z), point(k, drum, .1, .14, z)];
      },
    },
    update(s) {
      deploy = ease(deploy, s.enabled || s.fill > .5 ? 1 : 0, s.dt);
      pile.update(s.fill, deploy);
      if (!isAnimated()) return;
      intake.rotation.z = -(1 - deploy) * MATTERHORN_STOW;
      ext.position.x = (1 - deploy) * MATTERHORN_TRAVEL;
      net.position.x = -.64 + ext.position.x; net.scale.x = .78 - ext.position.x;
      spinShot = scoringEase(spinShot, s.enabled && (s.aiming || s.firing > 0) ? 1 : 0, s.dt);
      spinFeed = scoringEase(spinFeed, s.enabled && (s.intaking || s.firing > 0) ? 1 : 0, s.dt);
      // Front faces of the drum and feeder rollers move FUEL upward through the gap behind the front guides.
      drum.rotation.z += 60 * spinShot * s.dt;
      for (const f of feeders) f.rotation.z += 40 * Math.max(spinShot, spinFeed * .5) * s.dt;
      for (const r of rollers) r.rotation.z += 30 * spinFeed * s.dt;
    },
  };
}
