import { scoringEase } from './scoringReadiness';
import * as THREE from 'three';
import { decal, type ModelKit, type RobotModel } from './models';
import { articulation, ease, fuel, point, replaces } from './additionalCadModels';
import { flatNet } from './rebuiltCadKit';

/**
 * 7769 The CREW "CHUNK" (public Onshape "Full Robot", assembly "Chunk"; GLB export).
 *
 * Checklist (CLAUDE.md "verify before you build"):
 *  - Archetype: wide FIXED shooter (no turret) on 4 in Stealth wheels across most of the front, a compliant-wheel
 *    feeder under it, and a hood that the team raises "up in shooting position" and lowers to pass under the TRENCH
 *    (CD "FRC 7769 - CAD & Tech Slides : CHUNK", refs/cd-521008). In the CAD the "Adjust Hood" plates, hood plates and
 *    hood tube ride on 32t plate sprockets around the flywheel shaft, chain-driven from a Kraken X44 (12t), so the hood
 *    pivots about the flywheel axis; the "Fixed Hood" guides stay with the frame.
 *  - Intake end: BACK (source -Y). "Intake <1>/Moving" slides out on independently driven racks with the hopper
 *    extension walls and a kick bar at floor level (team: the intake also shuffles while shooting to stop jams).
 *    Scoring end: FRONT (source +Y).
 *  - L1 climb arm: single vertical tube with a spear tip on the front-right of the frame, winched. Stock 2026 robots
 *    start without a climber (project rule), so it only rises when a user enables a TOWER climb.
 *  - Colours: raw aluminium frame, blue 3D prints and blue Stealth wheels, black sponsor-decal polycarbonate walls, black
 *    net roof (TBA 2026 match photo refs/7769-2026/sheet.jpg; team render refs/cd-521008/sheet.jpg). CAD colours kept.
 *  - Frame 25 x 29 in (source chassis ±.317 x ±.368), CAD top 0.557 m: trench robot.
 *  - Capacity: team says "almost 70 (mostly 50-60)"; the non-expanding trench-height box holds far less. [EST] packed.
 *
 * Measured joints (robot metres, X = source Y, Y = source Z): flywheel and hood axis (.2285,.4955); feeder shaft
 * (.106,.3175); intake roller (-.578,.175); climb tube at x .289, z 0. The export is the deployed intake.
 * [EST] rack travel 0.22 m (intake back to the bumper line), hood lift 0.30 rad, climb arm rise 0.20 m.
 */
export const CHUNK_TRAVEL = .22;
const FLYWHEEL: [number, number, number] = [.2285, .4955, 0];

export function build7769Cad(root: THREE.Group, k: ModelKit, isAnimated: () => boolean): RobotModel {
  const p = articulation(root);
  const intake = p('intake', [0, 0, 0]);
  const roller = p('intake-roller', [-.578, .175, 0]);
  const kick = p('kick-bar', [-.455, .043, 0]);
  intake.attach(roller); intake.attach(kick);
  const flywheel = p('flywheel', FLYWHEEL);
  const hood = p('hood', FLYWHEEL);
  const feeder = p('feeder', [.106, .3175, 0]);
  const climber = p('climber', [.289, 0, 0]);
  const tip = new THREE.Object3D(); tip.position.set(-.60, .085, 0); intake.add(tip);
  // Spear tip at the top of the climb tube (source rubber cap, z .52-.557).
  const spear = new THREE.Object3D(); spear.position.set(.016, .54, 0); climber.add(spear);
  // Sponsor decals on the smoked stationary hopper walls (the CAD has no artwork; TBA photo shows APTIV and CHUNK).
  for (const sz of [-1, 1]) {
    const rotY = sz > 0 ? 0 : Math.PI, z = sz * .3545;
    decal(root, 'APTIV', { w: .16, h: .035, color: '#ffffff', background: '#101114', x: -.07, y: .49, z, rotY });
    decal(root, 'CHUNK', { w: .2, h: .06, color: '#ffffff', background: '#101114', x: -.07, y: .40, z, rotY });
  }
  const net = flatNet(root, 0, 1, .557, .70); net.visible = !k.config.hopperExpansion;
  net.position.x = -.62; net.scale.x = .62 + .02;
  // FUEL rests on the hopper floor between the intake walls and the feeder.
  const pile = fuel(k, -.58, .04, .16, .545, .64, -.36);
  let deploy = 1, spinShot = 0, spinFeed = 0, lift = 0, raise = 0;
  return {
    replaces, lightAt: [-.1, .56, .3], intakeAnchor: tip, climbAnchor: spear,
    flow: {
      intake: () => [point(k, tip, 0, .02), point(k, roller, .05, .03), new THREE.Vector3(-.35, .24, 0), new THREE.Vector3(-.2, .22, 0)],
      stow: pile.stow,
      feed: (shot = 0) => {
        const z = ((shot % 3) - 1) * .14;
        return [new THREE.Vector3(-.05, .22, z), point(k, feeder, -.06, -.01, z), point(k, feeder, -.04, .08, z), point(k, flywheel, -.1, .02, z), point(k, flywheel, -.02, .12, z)];
      },
    },
    update(s) {
      deploy = ease(deploy, s.enabled || s.fill > .5 ? 1 : 0, s.dt);
      pile.update(s.fill, deploy);
      if (!isAnimated()) return;
      // Racks run the intake out; while firing they shuffle it (team's anti-jam "truffle shuffle").
      const shuffle = s.firing > 0 ? .12 * (.5 + .5 * Math.sin(s.time * 9)) : 0;
      intake.position.x = (1 - deploy) * CHUNK_TRAVEL + shuffle * deploy;
      net.position.x = -.62 + intake.position.x; net.scale.x = .64 - intake.position.x;
      spinShot = scoringEase(spinShot, s.enabled && (s.aiming || s.firing > 0) ? 1 : 0, s.dt);
      spinFeed = scoringEase(spinFeed, s.enabled && (s.intaking || s.firing > 0) ? 1 : 0, s.dt);
      raise = scoringEase(raise, s.enabled && (s.aiming || s.firing > 0) ? 1 : 0, s.dt);
      // Rear faces of the flywheel and feeder move FUEL upward; the shot leaves over the top toward +X.
      flywheel.rotation.z -= 60 * spinShot * s.dt;
      feeder.rotation.z -= 40 * Math.max(spinShot, spinFeed * .5) * s.dt;
      roller.rotation.z += 30 * spinFeed * s.dt;
      // Hood rises about the flywheel shaft for the shot and drops back to trench height.
      hood.rotation.z = -.30 * raise;
      lift = ease(lift, s.climb > .5 ? .20 : s.climb > 0 ? .05 : 0, s.dt);
      climber.position.y = lift;
    },
  };
}
