import type { TeamRobot } from '@engine/core/season';
import { lb, deg } from '@engine/units';
import { heroRobotDefaults, normalizeHeroConfig } from './config';
import * as THREE from 'three';
import { registerRobotModel, drivebase, box, bar, mat, roller, type ModelKit } from '@engine/robot/models';

// Lightweight source-shaped fallback for headless play or a failed CAD load: back roller intake, turret, front elevator with claw.
registerRobotModel('hero-poofs-254', (k: ModelKit) => {
  const db = drivebase(k), dark = mat(0x171b20), alu = mat(0xc0c7cf), red = mat(0xb3202a), orange = mat(0xff7a1a);
  const intake = new THREE.Group(); intake.position.set(-.1, .19, 0); k.visual.add(intake);
  roller(intake, .034, .58, orange, -.52, .045, 0);
  bar(intake, [0, 0, -.3], [-.52, .045, -.3], .016, dark); bar(intake, [0, 0, .3], [-.52, .045, .3], .016, dark);
  box(k.visual, .08, .12, .5, dark, -.3, .3, 0);
  const turret = new THREE.Group(); turret.position.set(-.0365, .54, 0); k.visual.add(turret);
  box(turret, .3, .16, .3, red, 0, .1, 0);
  const wheel = roller(turret, .05, .2, dark, .07, .195, 0);
  const mast = box(k.visual, .05, .75, .45, alu, .19, .42, 0);
  const claw = box(k.visual, .3, .03, .5, red, .1, .83, 0);
  // Held bubbles in the serializer (visual only).
  const ballMat = mat(k.alliance === 'red' ? 0xe83d4f : 0x337fe8), geo = new THREE.SphereGeometry(.085, 12, 8);
  const balls = [[-.285, .29, -.17], [-.285, .29, .17], [-.12, .3, 0]].map(p => { const m = new THREE.Mesh(geo, ballMat); m.position.set(p[0], p[1], p[2]); m.visible = false; k.visual.add(m); return m; });
  return { replaces: ['chassis', 'launcher', 'hopper', 'intakeRollers', 'climber'], update(s) {
    db.update(s);
    turret.rotation.y = k.turret.rotation.y;
    wheel.rotation.z += (s.aiming || s.firing > 0 ? 60 : 0) * s.dt;
    intake.rotation.z = s.enabled ? 0 : -.7;
    mast.scale.y = 1 + s.climb * .6; claw.position.y = .83 + s.climb * .6;
    balls.forEach((m, n) => m.visible = n < Math.round(s.fill * balls.length));
  } };
});

export function poofs254Robot(): TeamRobot {
  const c = heroRobotDefaults();
  c.teamNumber = 254;
  c.options = { ...c.options, heroClass: 'gadgeteer', archetype: 'poofs-254', bubbleCapacity: 3, panelCapacity: 1, panelPreload: 1 };
  // Drivebase from the CAD: 0.661 m (lateral) × 0.737 m; stowed height capped at the 30 in start limit [EST]; playing mass [EST].
  c.frameLength = .7366; c.frameWidth = .6604; c.height = .762; c.mass = lb(110);
  c.preload = 3; c.maxSpeed = 4.5; c.maxAccel = 7.5;
  c.intake = { ...c.intake, width: .58, reach: .22, groundSide: 'back', station: true, stationSide: 'back' };
  // Turret ring centre 0.037 m behind the frame centre; flywheel axis ≈ 0.735 m high (CAD).
  c.launcher = { ...c.launcher, turret: true, height: .735, muzzleForward: .1, mounts: [{ forward: -.0365, side: 0 }], rate: 4, angle: deg(49), minAngle: deg(15), maxAngle: deg(70) };
  c.climber = { maxLevel: 3, secondsPerLevel: 2 };
  c.placement = { ...c.placement!, maxLevel: 2, liftSpeed: 1.4, cycleSeconds: .8 };
  return {
    id: 'hero-poofs-254', team: 254, name: 'Cheesy Poofs',
    description: 'Bellarmine’s Hero Heist Gadgeteer: back floor intake into a three-bubble serializer, turret and hood shooter, three-stage elevator carrying a swinging disk claw for the STORY PANEL and a suction-pad climb. Drive speed, mass, shooter rate and joint travel are estimates.',
    source: 'https://team254.onshape.com/documents/e13cf09d6c701404c3324795/w/09bdbe7bc1def77234d6b4e7/e/c0b6c3ba6d288d37dadfce27',
    config: normalizeHeroConfig(c),
  };
}
