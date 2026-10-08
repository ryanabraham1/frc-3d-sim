import type { TeamRobot } from '@engine/core/season';
import { lb, deg } from '@engine/units';
import { heroRobotDefaults, normalizeHeroConfig } from './config';
import { registerRobotModel, drivebase, box, bar, mat, roller, approach, type ModelKit } from '@engine/robot/models';
import { SENTINEL_BUBBLES } from '@engine/robot/heroSentinelCad';
import * as THREE from 'three';

// Lightweight source-shaped fallback for headless play or a failed CAD load (the CAD model is heroSentinelCad.ts).
registerRobotModel('hero-sentinel-1923', (k: ModelKit) => {
  const db = drivebase(k), dark = mat(0x1d2025), gold = mat(0xe0c050), orange = mat(0xf56a0a), steel = mat(0x9aa2aa);
  box(k.visual, .62, .02, .36, dark, .05, .06, 0);
  // Ball tunnel: curved-bowl side plates, feed rollers, 4 in flywheel at the front.
  for (const sz of [-1, 1]) box(k.visual, .5, .26, .008, steel, .05, .19, sz * .105);
  const flywheel = new THREE.Group(); flywheel.position.set(.10, .2555, 0); k.visual.add(flywheel);
  roller(flywheel, .0508, .2, dark, 0, 0, 0);
  for (const x of [.0, -.09, -.2]) roller(k.visual, .036, .2, dark, x, .31, 0);
  // Slapdown intake at the back with orange rollers, hinged on the top shaft.
  const intake = new THREE.Group(); intake.position.set(-.318, .314, 0); k.visual.add(intake);
  for (const sz of [-1, 1]) bar(intake, [0, 0, sz * .14], [-.36, -.19, sz * .14], .016, dark);
  for (const [x, y] of [[-.12, -.06], [-.24, -.125], [-.36, -.19]]) roller(intake, .036, .62, orange, x, y, 0).rotation.x = Math.PI / 2;
  // Panel arm on the left side, hinged at the front.
  const arm = new THREE.Group(); arm.position.set(.286, .32, -.26); k.visual.add(arm);
  bar(arm, [0, 0, 0], [-.58, .04, 0], .02, gold);
  for (const x of [.12, .22]) bar(k.visual, [x, .06, -.26], [.286, .32, -.26], .016, gold);
  // Held bubbles inside the tunnel.
  const ballMat = new THREE.MeshStandardMaterial({ color: k.alliance === 'red' ? 0xe83d4f : 0x337fe8, roughness: .55 });
  const balls = SENTINEL_BUBBLES.map(p => { const m = new THREE.Mesh(new THREE.SphereGeometry(.0853, 12, 8), ballMat); m.position.fromArray(p); m.visible = false; k.visual.add(m); return m; });
  let stow = 0, rot = 0;
  return {
    replaces: ['chassis', 'launcher', 'hopper', 'intakeRollers', 'climber'],
    update(s) {
      db.update(s);
      balls.forEach((b, i) => { b.visible = i < Math.round(s.fill * balls.length); });
      stow = approach(stow, s.intaking && s.enabled ? 1 : 0, 8, s.dt);
      intake.rotation.z = -(1 - stow) * 1.75;
      flywheel.rotation.z += s.enabled && (s.aiming || s.firing > 0) ? 60 * s.dt : 0;
      rot = approach(rot, s.place && s.place.level > 0 ? -1.9 : 0, 6, s.dt);
      arm.rotation.z = rot;
    },
  };
});

export function sentinel1923Robot(): TeamRobot {
  const c = heroRobotDefaults();
  c.teamNumber = 1923;
  c.options = { ...c.options, heroClass: 'gadgeteer', archetype: 'sentinel-1923', bubbleCapacity: 3, panelCapacity: 1, panelPreload: 1 };
  // Frame from the CAD (bumper shell omitted): 29 in square. Height is the stowed slapdown intake [EST].
  c.frameLength = c.frameWidth = .7366; c.height = .70; c.mass = lb(118);
  c.preload = 3; c.maxSpeed = 5; c.maxAccel = 7.5;
  // Back slapdown intake (12 in past the frame), no station funnel in the CAD.
  c.intake = { ...c.intake, width: .62, reach: .30, groundYaw: undefined, station: false };
  // Ball tunnel with an adjustable hood: 4 in flywheel at x .10 m, exit .30 m high; hood travel limits are not in the binder [EST].
  c.launcher = { ...c.launcher, turret: false, height: .30, muzzleForward: .17, mounts: [{ forward: .10, side: 0 }], rate: 3, angle: deg(55), minAngle: deg(30), maxAngle: deg(70) };
  c.climber = { maxLevel: 0, secondsPerLevel: 2 };
  // The pivoting arm's claw reaches the DOWNTOWN/UPTOWN slits only [EST from 0.59 m + 0.2 m slide].
  c.placement = { ...c.placement!, maxLevel: 1 };
  return {
    id: 'hero-sentinel-1923', team: 1923, name: 'Sentinel',
    description: 'MidKnight Inventors’ Gadgeteer: swerve, back slapdown roller intake, three-bubble ball tunnel with a fixed forward flywheel shooter, and a pivoting telescoping panel arm on the left side; park only. Speed, hood angle, arm reach, intake stow height and playing mass are estimates.',
    source: 'https://cad.onshape.com/documents/264bc1a68a1b98bb7580a604/w/71c614ca220467a6a0209fa9/e/67d0ee0989ec87adab4475b9',
    config: normalizeHeroConfig(c),
  };
}
