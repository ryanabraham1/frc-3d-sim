import { dyeRotorRate, scoringEase } from './scoringReadiness';
import * as THREE from 'three';
import type { ModelKit, RobotModel } from './models';
import { articulation, ease, fuel, point, replaces } from './additionalCadModels';

/**
 * 3256 WarriorBorgs AIMBOT (user-supplied "Real Real Main.glb" Onshape export + the team's 2026 technical binder).
 *
 * Checklist (CLAUDE.md "verify before you build"):
 *  - Archetype: TURRET + PIVOTING HOOD shooter. 8 in X-contact ring turret (two WCP CANcoders), shooter on top with a 3 in
 *    central flywheel + 5 in inertia wheel and 1 in hood rollers, "27 deg pivot range" on a 3D-printed herringbone gear
 *    (binder p.4-5). A rotating polycarbonate-walled SPINDEXER floor (printed cone, Kraken X60) funnels FUEL into a feeder
 *    column that lifts it through the turret ring into the shooter (binder p.6). Bump bot: tall (30 in), crosses the BUMP.
 *  - Intake end: BACK (source -Y). Gear-driven SLAPDOWN intake, ~122 deg of travel, three 2 in rollers + a 1 in kicker;
 *    the hopper's clear end walls slide out on 3/8 in shafts, "pushed out by intake" (binder p.7-8). Scoring end: the
 *    turret, which aims anywhere. No climber (binder has no climb section; TBA photos show none).
 *  - Colours: black anodised frame and plates, clear 1/8 in polycarbonate hopper walls, 3D-printed spindexer parts, blue/red
 *    bumpers with white "3256" (binder cover, TBA 2026 sheet refs/3256-2026/sheet.jpg). CAD colours kept; walls forced clear.
 *  - Frame 27 x 27 in MK5n swerve (binder p.3; CAD rails +-0.34 m), CAD top 0.754 m.
 *  - Capacity: 100 FUEL and 8-10 FUEL/s are the team's figures (told to us by the user); the binder's design target is
 *    ~7/s. Drive speed [EST].
 *
 * Measured joints (robot metres, X = source Y, Y = source Z, Z = source X): turret ring centre (.145, .495, .145) from the
 * 8.5 in bearing and its base plate; flywheel axis (.2195, .595) from the 3 in wheel stack; spindexer spline (-.07, ·, 0);
 * slapdown pivot axle (-.275, .215) (0500_Pivot_Axle). The export is the deployed intake. [EST] hood pivot axis
 * (.14, .62) (middle of the pivot plates), hopper wall travel 0.30 m and the 2.13 rad (122 deg, binder) stow fold.
 */
export const AIMBOT_TURRET = { x: .145, y: .495, z: .145 };
export const AIMBOT_INTAKE_PIVOT = { x: -.275, y: .215 };
/** Slapdown travel from the binder (~122 degrees). */
export const AIMBOT_INTAKE_FOLD = 2.13;
export const AIMBOT_HOPPER_TRAVEL = .30;
/** Hood pivot range from the binder (27 degrees). */
export const AIMBOT_HOOD_RANGE = 27 * Math.PI / 180;

export function buildAimbotCad(root: THREE.Group, k: ModelKit, isAnimated: () => boolean): RobotModel {
  const p = articulation(root);
  const turret = p('turret', [AIMBOT_TURRET.x, AIMBOT_TURRET.y, AIMBOT_TURRET.z]);
  const hood = p('hood', [.14, .62, .17]);
  const flywheel = p('flywheel', [.2195, .595, .17]);
  turret.attach(hood); hood.attach(flywheel);
  const rotor = p('rotor', [-.07, .17, 0]);
  const intake = p('intake', [AIMBOT_INTAKE_PIVOT.x, AIMBOT_INTAKE_PIVOT.y, 0]);
  const hopperExt = p('hopper-ext', [0, 0, 0]);
  // Mouth: the lead roller sits on the carpet at the front of the slapdown plates.
  const tip = new THREE.Object3D(); tip.position.set(-.60 - AIMBOT_INTAKE_PIVOT.x, .08 - AIMBOT_INTAKE_PIVOT.y, 0); intake.add(tip);
  // FUEL fills the tall clear hopper around the turret tower (the +X/+Z quarter, source x,y >= 0, is the tower).
  k.visual.userData.fuelKeepouts=[
    {x:AIMBOT_TURRET.x,z:AIMBOT_TURRET.z,radius:.085,bottom:.15,top:.44},
    {x:AIMBOT_TURRET.x,z:AIMBOT_TURRET.z,radius:.18,bottom:.44,top:.95},
  ];
  const pile = fuel(k, -.64, .34, .23, .72, .66, -.34, (x, z) => !(x > -.02 && z > -.02));
  let deploy = 1, spin = 0, lift = 0, rotorRate = 0;
  return {
    replaces, lightAt: [.17, .5, .36], intakeAnchor: tip,
    flow: {
      intake: () => [point(k, tip, 0, .02), new THREE.Vector3(-.46, .2, 0), new THREE.Vector3(-.3, .19, 0), new THREE.Vector3(-.15, .18, .05)],
      stow: pile.stow,
      feed: () => [point(k, rotor, .12, .06, .1), point(k, rotor, .14, .06, .15), new THREE.Vector3(.145, .38, .15), point(k, turret, 0, .03, 0),
        point(k, flywheel, -.05, .07, 0), point(k, flywheel, .07, .09, 0)],
    },
    update(s) {
      deploy = ease(deploy, s.enabled || s.fill > .5 ? 1 : 0, s.dt);
      pile.update(s.fill, deploy);
      if (!isAnimated()) return;
      // Slapdown: the CAD is deployed; folding rotates the plates up and in about the pivot axle, and the hopper walls it
      // pushes out come back with it.
      intake.rotation.z = -(1 - deploy) * AIMBOT_INTAKE_FOLD;
      hopperExt.position.x = (1 - deploy) * AIMBOT_HOPPER_TRAVEL;
      // The export head faces +X (source +Y), the simulated aim is about the launcher's +X heading.
      turret.rotation.y = k.turret.rotation.y;
      spin = scoringEase(spin, s.enabled && (s.aiming || s.firing > 0) ? 1 : 0, s.dt);
      flywheel.rotation.z -= 60 * spin * s.dt;
      rotorRate = dyeRotorRate(rotorRate, s, 8);
      rotor.rotation.y += rotorRate * s.dt;
      // The whole flywheel pack tilts through the 27 degree range: flatter for long shots, steeper up close.
      lift = ease(lift, s.enabled && s.aiming ? THREE.MathUtils.clamp((s.hood - .5) / .75, 0, 1) : 0, s.dt);
      hood.rotation.z = AIMBOT_HOOD_RANGE * (lift - .5) * (s.enabled && s.aiming ? 1 : 0);
    },
  };
}
