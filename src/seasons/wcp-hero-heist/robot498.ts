import type { TeamRobot } from '@engine/core/season';
import { lb, deg } from '@engine/units';
import { heroRobotDefaults, normalizeHeroConfig } from './config';
import { registerRobotModel, drivebase, box, bar, mat, roller, type ModelKit } from '@engine/robot/models';
import * as THREE from 'three';

// Lightweight source-shaped fallback for headless play or a failed CAD load. The engine still draws the floor
// intake rollers and the held-bubble hopper, so held pieces and the intake stay visible.
registerRobotModel('hero-mystic-498', (k: ModelKit) => {
  const db = drivebase(k), dark = mat(0x171b20), grey = mat(0xaab2ba);
  const turret = new THREE.Group(); turret.position.set(.178, .505, 0); k.visual.add(turret);
  box(turret, .30, .03, .30, dark, .1, 0, 0);
  const wheel = roller(turret, .0508, .06, grey, .1, .08, 0);
  box(k.visual, .12, .55, .12, grey, -.06, .4, -.216);
  bar(k.visual, [-.3, .35, -.33], [-.3, .35, .33], .02, dark);
  return { replaces: ['chassis', 'launcher', 'climber'], update(s) { db.update(s); turret.rotation.y = k.turret.rotation.y; wheel.rotation.z += s.aiming ? 45 * s.dt : 0; } };
});

/** Team 498 · Mystic. Frame, mechanism positions and climber stages are measured from the Onshape CAD; speed, mass and rates are estimates. */
export function hero498Robot(): TeamRobot {
  const c = heroRobotDefaults();
  c.teamNumber = 498;
  c.options = { ...c.options, heroClass: 'mystic', archetype: 'mystic-498', bubbleCapacity: 6, panelCapacity: 0, panelPreload: 0 };
  // 26 x 26 in frame (104 in perimeter, CAD); 3.25 in bumpers. Height: stowed telescope nested under 33 in [EST], enough for HIGH.
  c.frameLength = .6604; c.frameWidth = .6604; c.height = .826; c.mass = lb(112);
  c.preload = 3; c.maxSpeed = 4.5; c.maxAccel = 7.5;
  // Back over-the-bumper roller ramp, 0.5 m wide (CAD); reach past the bumper at full deploy.
  c.intake = { ...c.intake, width: .54, reach: .14, station: false };
  // Turret center (CAD), flywheel axle 0.10 m ahead of it at 0.584 m; rate is an estimate.
  c.launcher = { ...c.launcher, turret: true, height: .584, muzzleForward: .1, mounts: [{ forward: .178, side: 0 }], rate: 4, angle: deg(50), minAngle: deg(20), maxAngle: deg(70) };
  c.climber = { maxLevel: 3, secondsPerLevel: 1.8 };
  return {
    id: 'hero-mystic-498', team: 498, name: 'Mystic',
    description: 'Team 498’s Hero Heist Mystic: back over-the-bumper roller ramp, six-bubble hopper, turret with a tilting roller hood, and a three-stage winch telescope with a hooked wrench. Frame and joints are from the CAD; speed, mass, fire rate and stowed climber nesting are estimates.',
    source: 'https://cad.onshape.com/documents/308c2281e3ff59722e4dd3fb/w/d059f7fdd2c497ad09ad9396/e/fea64e26c2dcad32744bfd47',
    config: normalizeHeroConfig(c),
  };
}
