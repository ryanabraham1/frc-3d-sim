import * as THREE from 'three';
import type { ModelKit, RobotModel } from './models';
import { box, mat, approach, intakeDeployTarget } from './models';
import { scoringEase } from './scoringReadiness';

/**
 * Source checklist (docs/HERO-HEIST-FIREWEED.md; team binder "1540 Fireweed 2025 technical binder", sheet link):
 * archetype = Gadgeteer, no turret (binder MoSCoW "Won't have a turret"), fixed Stealth-wheel shooter with rack-and-pinion hood;
 * intake end = back (-x): double-jointed arm, joint 1 bubble intake, joint 2 panel end effector, mounted on the elevator carriage;
 * scoring end = front (+x) shooter; one-stage elevator, two hard-stop positions, ~10 in travel; boat-hook vacuum climber, all levels;
 * capacity 4 bubbles (binder: "enough space to hold 4"), 1 panel (sheet); frame 29.5 in swerve (binder); colors from the CAD
 * (red/orange frame, blue bumpers of our alliance). Rate, speed, mass are [EST].
 *
 * Team 1540 "Fireweed" (Hero Heist Gadgeteer) rig. Onshape export (Z up) mapped (Y,Z,X) -> robot (x,y,z), so the
 * shooter faces +x and the floor intake is on the back (-x). Joint centers are measured from the exported pins and
 * shafts; travel limits are simulator estimates [EST].
 *   - Back intake: over-the-bumper arm pivoting on the elevator carriage (10DP 30T intake pivots), stowed inside the frame.
 *   - Elevator carriage: slides on the single fixed stage; it carries the intake pivot and the panel fork.
 *   - Indexer ramp + sushi-roller bed + J-path to a 2"/3" Stealth wheel shooter with a rack-and-pinion servo hood.
 *   - Climber: bi-stable reeled composite tube ("boat hook") with a vacuum cup, plus a pneumatic vacuum arm.
 */
const ORANGE = 0xff7a1a;
const BUBBLE_R = 0.0889;
/** Four bubbles ride single file between the indexer plates (x_src .0-.185); slots run shooter end first. */
const BUBBLE_SLOTS: [number, number, number][] = [[.06, .55, .09], [.21, .44, .09], [.135, .285, .09], [-.04, .285, .09]];

export function buildFireweed1540(_id: string, root: THREE.Group, k: ModelKit, animated: () => boolean): RobotModel {
  const get = (name: string) => root.getObjectByName(name);
  const group = (name: string, at: [number, number, number], parent: THREE.Object3D, parts: THREE.Object3D[] = []) => {
    const g = new THREE.Group(); g.name = name; g.position.fromArray(at); parent.add(g);
    root.updateMatrixWorld(true);
    for (const o of parts) g.attach(o);
    return g;
  };
  const lift = group('cad-lift', [0, 0, 0], root);
  const carriage = get('elevator-carriage'); if (carriage) lift.attach(carriage);
  const intakePivot = group('cad-intake-pivot', [-.30, .35, 0], lift);
  const intake = get('intake'); if (intake) intakePivot.attach(intake);
  // Second link of the double-jointed arm: the panel end effector, pinned at the end of the bubble-intake arm.
  const ee = get('intake-ee');
  const eePivot = group('cad-intake-ee-pivot', [-.308, -.2, 0], intakePivot, ee ? [ee] : []);
  const hoodPivot = group('cad-hood-pivot', [.037, .55, 0], root);
  const hood = get('hood'); if (hood) hoodPivot.attach(hood);
  // Each Stealth wheel spins about its own shaft (source +X = robot z).
  const wheels: THREE.Group[] = [];
  for (let i = 0; get(`wheel-${i}`); i++) {
    const o = get(`wheel-${i}`)!; root.updateMatrixWorld(true);
    const c = new THREE.Box3().setFromObject(o).getCenter(new THREE.Vector3());
    wheels.push(group(`cad-wheel-${i}-pivot`, root.worldToLocal(c).toArray() as [number, number, number], root, [o]));
  }
  const tube = get('climb-tube'), cup = get('climb-cup');
  const tubePivot = group('cad-climb-tube-pivot', [0, .178, 0], root, tube ? [tube] : []);
  const cupLift = group('cad-climb-cup-lift', [0, 0, 0], root, cup ? [cup] : []);
  const contact = new THREE.Object3D(); contact.name = 'fireweed-climb-contact'; contact.position.set(.018, .554, -.148); cupLift.add(contact);

  // Orange roller bars mark the intake mouth on the moving arm (lower bubble roller and upper panel roller).
  const orange = mat(ORANGE, { rough: .5 });
  root.updateMatrixWorld(true);
  for (const [x, y, parent] of [[-.47, .345, intakePivot], [-.69, .07, eePivot]] as const) {
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(.022, .022, .56, 12), orange);
    bar.rotation.x = Math.PI / 2; bar.name = 'intake-marker'; parent.add(bar); bar.position.copy(parent.worldToLocal(root.localToWorld(new THREE.Vector3(x, y, 0))));
  }
  const tip = new THREE.Object3D(); eePivot.add(tip); tip.position.copy(eePivot.worldToLocal(root.localToWorld(new THREE.Vector3(-.70, .08, 0))));

  // Held SPEECH BUBBLES drawn in the indexer (visual only), alliance colored.
  const ballMat = mat(k.alliance === 'red' ? 0xe83d4f : 0x337fe8, { rough: .7 });
  const ballGeo = new THREE.SphereGeometry(BUBBLE_R * .95, 14, 10);
  const balls = BUBBLE_SLOTS.map(([y, z, x]) => {
    const m = new THREE.Mesh(ballGeo, ballMat); m.name = 'held-bubble'; m.position.set(y, z, x); m.visible = false; root.add(m); return m;
  });

  // Panel fork: telescopes from the carriage over the bumper; the season draws held STORY PANELS on `held`.
  const alu = k.mats.alu, held = new THREE.Group(); held.name = 'fireweed-panel-cradle'; k.visual.add(held);
  const fork = [-1, 1].map(s => box(k.visual, 1, .03, .03, alu, 0, 0, s * .25));
  const L = k.fp.length / 2;
  let dep = 0, ext = 0, pitch = 0, rise = 0, cradleY = .45, cradleX = L - .15;
  return {
    replaces: ['chassis', 'hopper', 'launcher', 'climber', 'intakeRollers', 'funnel'],
    heldAnchor: held, intakeAnchor: tip, climbAnchor: contact, lightAt: [-.2, .74, .3],
    update(s) {
      const fill = THREE.MathUtils.clamp(s.fill, 0, 1), count = Math.round(fill * balls.length);
      balls.forEach((b, i) => { b.visible = i < count; });
      cradleY = approach(cradleY, s.place ? s.place.height : .45, 7, s.dt);
      cradleX = approach(cradleX, s.place ? s.place.forward : L - .15, 7, s.dt);
      held.position.set(cradleX, cradleY, 0);
      const base = -.1;
      fork.forEach(f => { f.scale.x = Math.max(.05, cradleX - base); f.position.set(base + (cradleX - base) / 2, cradleY - .03, f.position.z); });
      if (!animated()) return;
      dep = scoringEase(dep, intakeDeployTarget(s), s.dt);
      intakePivot.rotation.z = -(1 - dep) * 2.15;
      eePivot.rotation.z = -(1 - dep) * 1.3;
      // The elevator has two hard-stop positions (about 10 in apart): down, and up while a panel is being placed.
      rise = scoringEase(rise, (s.place?.level ?? 0) > 0 ? .254 : 0, s.dt);
      lift.position.y = rise;
      pitch = scoringEase(pitch, s.aiming ? THREE.MathUtils.clamp((s.hood - .85) * .5, -.3, .3) : 0, s.dt);
      hoodPivot.rotation.z = pitch;
      const spinRate = s.enabled && (s.aiming || s.firing > 0) ? 60 : s.enabled && s.intaking ? 14 : 0;
      wheels.forEach(w => { w.rotation.z -= spinRate * s.dt; });
      ext = scoringEase(ext, s.climb > .6 ? 1 : s.climb > 0 ? .25 : 0, s.dt);
      cupLift.position.y = ext * .62; tubePivot.scale.y = 1 + ext * .62 / .328;
    },
  };
}
