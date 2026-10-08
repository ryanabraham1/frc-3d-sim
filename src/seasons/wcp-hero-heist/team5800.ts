import type { TeamRobot } from '@engine/core/season';
import { lb, deg } from '@engine/units';
import { heroRobotDefaults, normalizeHeroConfig } from './config';
import { registerRobotModel, drivebase, box, bar, mat, roller, type ModelKit } from '@engine/robot/models';
import * as THREE from 'three';

const SOURCE = 'https://cad.onshape.com/documents/c2dc8ce89390e85cfb5cc7c0/w/6edfacad0375c29c51ee8642/e/1e2cf780d4393e634018fd90';

// Lightweight source-shaped fallback for headless play or a failed CAD load: front elevator and wrist, rear 4-bar intake,
// turret on top (see docs/HERO-HEIST-5800.md).
for (const id of ['hero-multiclass-5800', 'hero-multiclass-5800-gadgeteer']) registerRobotModel(id, (k: ModelKit) => {
  const db = drivebase(k), dark = mat(0x171b20), grey = mat(0x9aa3ad);
  const turret = new THREE.Group(); turret.position.set(.033, .416, 0); k.visual.add(turret);
  box(turret, .30, .025, .28, dark, .05, 0, 0);
  const wheel = roller(turret, .0508, .18, grey, .06, .08, 0);
  const intake = new THREE.Group(); intake.position.set(-.12, .18, 0); k.visual.add(intake);
  for (const z of [-.3, .3]) bar(intake, [0, 0, z], [-.19, .06, z], .018, grey);
  roller(intake, .026, .62, mat(0xff7a1a), -.19, .06, 0);
  const mast = box(k.visual, .12, .72, .26, grey, .26, .38, 0);
  const wrist = box(k.visual, .02, .16, .60, dark, .38, .62, 0);
  return { replaces: ['chassis', 'launcher', 'hopper', 'intakeRollers', 'climber'], update(s) {
    db.update(s); turret.rotation.y = k.turret.rotation.y - 1.0212; wheel.rotation.z += s.aiming ? 55 * s.dt : 0;
    intake.rotation.z = s.intaking && s.enabled ? .6 : 0; mast.scale.y = 1 + (s.place?.height ?? 0) * .3; wrist.position.y = .62 + (s.place?.height ?? 0) * .3;
  } };
});

/** Wolverine's Multiclass: the same robot declared as a Mystic (6 bubbles) or as a Gadgeteer (1 panel + bubbles). */
export function team5800Robots(): TeamRobot[] {
  const base = (hero: 'mystic' | 'gadgeteer', archetype: string) => {
    const c = heroRobotDefaults();
    c.teamNumber = 5800;
    c.options = { ...c.options, heroClass: hero, archetype };
    // Binder: 27 x 25 in frame (the full 104 in Mystic perimeter), 98 lb, WCP Swerve X2i high-speed with Kraken X60; speed is an estimate.
    c.frameLength = .6858; c.frameWidth = .635; c.height = .757; c.mass = lb(98); // binder: 27 x 25 in, 98 lb
    c.maxSpeed = 4.6; c.maxAccel = 7.5;
    // Binder: one ground intake, the rear over-the-bumper 4-bar; the front wrist only handles panels.
    c.intake = { ...c.intake, width: .60, reach: .22, groundYaw: undefined, station: true };
    // Binder: turret (180 degree range, not enforced by the engine), dual-wheel flywheel, variable-angle hood; rate is an estimate.
    c.launcher = { ...c.launcher, turret: true, height: .62, muzzleForward: .2, mounts: [{ forward: .0333, side: 0 }], rate: 3, angle: deg(45), minAngle: deg(25), maxAngle: deg(70) };
    c.climber = { maxLevel: 0, secondsPerLevel: 2 }; // sheet: Park only
    return c;
  };
  const mystic = base('mystic', 'multiclass-5800');
  mystic.options = { ...mystic.options, bubbleCapacity: 6, panelCapacity: 0, panelPreload: 0 };
  mystic.preload = 3;
  const gadgeteer = base('gadgeteer', 'multiclass-5800-gadgeteer');
  gadgeteer.options = { ...gadgeteer.options, bubbleCapacity: 4, panelCapacity: 1, panelPreload: 1 };
  gadgeteer.preload = 3;
  gadgeteer.placement = { ...gadgeteer.placement!, maxLevel: 2, liftSpeed: 1.2, reach: .45, cycleSeconds: .9, harvestSeconds: .5, scoreSide: 'front' };
  return [
    { id: 'hero-multiclass-5800', team: 5800, name: 'Multiclass · Mystic', source: SOURCE, config: normalizeHeroConfig(mystic),
      description: 'Wolverine’s Multiclass declared as a Mystic: rear 4-bar tube-roller intake and front wrist wheels (both collect), six-bubble spindexer, turret with three 4 in drive wheels on a fixed hood, Park only. Speed, shooter angle/rate and mass are estimates.' },
    { id: 'hero-multiclass-5800-gadgeteer', team: 5800, name: 'Multiclass · Gadgeteer', source: SOURCE, config: normalizeHeroConfig(gadgeteer),
      description: 'The same Wolverine robot declared as a Gadgeteer: 2-stage elevator and wrist place one panel (plus up to three bubbles) in the low baskets and slits, rear 4-bar and front wrist intake bubbles. Placement cycle time is an estimate.' },
  ];
}
