import * as THREE from 'three';
import type { ModelKit, RobotModel } from './models';
import { scoringEase } from './scoringReadiness';

/**
 * Team 498's CADathon Mystic. Source axes (y,z,x) in meters: sim +x = CAD +Y (turret side), sim y = CAD Z, sim z = CAD +X;
 * the over-the-bumper intake is on the back (-x). Joint centers are measured from the exported shafts:
 *  - intake arm: roller drive shaft (the 25.5 in hex) at (-.2795,.3535); the CAD pose is the stowed, upright arm.
 *  - turret: 8 in X-contact bearing at (.178,.505); hood and flywheel share the 11.15 in shaft at (.2755,.584).
 *  - wrench: carriage pivot shaft at (-.0385,.93,-.216), folded down along the telescope when stowed.
 * The CAD is exported with the telescope extended; the stowed nesting below is derived from the stage lengths [EST].
 */
const INTAKE_PIVOT: [number, number, number] = [-.2795, .3535, 0];
const TURRET_PIVOT: [number, number, number] = [.178, .505, 0];
const FLYWHEEL_PIVOT: [number, number, number] = [.2755, .584, 0];
const WRENCH_PIVOT: [number, number, number] = [-.0385, .93, -.216];
/** Roller dead axles in the CAD pose (x, y), across the full intake width. */
const ROLLERS: [number, number][] = [[-.305, .7095], [-.2315, .5935], [-.2575, .4585]];
export const STAGE1_DROP = .21, CARRIAGE_DROP = .42, INTAKE_DEPLOY = 2.5, WRENCH_FOLD = Math.PI / 2;
/** Where held SPEECH BUBBLES sit: three across the indexer floor, two stacked in the hopper column, one on top. */
export const HELD_SLOTS: [number, number, number][] = [
  [-.15, .253, -.18], [-.15, .253, 0], [-.15, .253, .18], [.178, .235, 0], [.178, .413, 0], [-.15, .40, 0],
];
const BUBBLE_R = .0889;

export function buildMystic498Cad(_id: string, root: THREE.Group, k: ModelKit, animated: () => boolean): RobotModel {
  const get = (name: string) => root.getObjectByName(name);
  const pivot = (name: string, at: [number, number, number], parts: string[]) => {
    const g = new THREE.Group(); g.name = `cad-${name}-pivot`; g.position.fromArray(at); root.add(g);
    root.updateMatrixWorld(true);
    for (const part of parts) { const o = get(part); if (o) g.attach(o); }
    return g;
  };
  const intake = pivot('intake', INTAKE_PIVOT, ['intake-rollers']);
  const turret = pivot('turret', TURRET_PIVOT, ['turret', 'hood', 'flywheel']);
  const hood = pivot('hood', FLYWHEEL_PIVOT, ['hood']); turret.attach(hood);
  const flywheel = pivot('flywheel', FLYWHEEL_PIVOT, ['flywheel']); turret.attach(flywheel);
  const stage1 = pivot('climb-stage1', [0, 0, 0], ['climb-stage1']);
  const carriage = pivot('climb-carriage', [0, 0, 0], ['climb-carriage']);
  const wrench = pivot('climb-wrench', WRENCH_PIVOT, ['climb-wrench']); carriage.attach(wrench);

  // Orange sleeves on the three roller tubes mark the intake.
  const orange = new THREE.MeshStandardMaterial({ color: 0xff6a00, roughness: .55, metalness: .1 });
  for (const [x, y] of ROLLERS) {
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(.03, .03, .5, 16), orange);
    bar.name = 'intake-marker'; bar.rotation.x = Math.PI / 2;
    bar.position.set(x - INTAKE_PIVOT[0], y - INTAKE_PIVOT[1], 0); intake.add(bar);
  }
  const tip = new THREE.Object3D(); tip.position.set(ROLLERS[0][0] - INTAKE_PIVOT[0], ROLLERS[0][1] - INTAKE_PIVOT[1], 0); intake.add(tip);
  const contact = new THREE.Object3D(); contact.name = 'mystic498-climb-contact'; contact.position.set(-.064, 1.229, -.216); carriage.add(contact);

  // Visual-only held SPEECH BUBBLES, shown by the robot's fill level.
  const bubbleMaterial = new THREE.MeshStandardMaterial({ color: k.alliance === 'red' ? 0xe83d4f : 0x337fe8, roughness: .35, metalness: 0, transparent: true, opacity: .92 });
  const bubbleGeometry = new THREE.SphereGeometry(BUBBLE_R * .97, 20, 14);
  const held = HELD_SLOTS.map(([x, y, z]) => {
    const m = new THREE.Mesh(bubbleGeometry, bubbleMaterial); m.name = 'held-bubble'; m.position.set(x, y, z); m.visible = false; root.add(m); return m;
  });
  const showHeld = (fill: number) => { const n = Math.round(THREE.MathUtils.clamp(fill, 0, 1) * held.length); held.forEach((m, i) => { m.visible = i < n; }); };

  let deploy = 0, extension = 0, wrenchOut = 0, pitch = 0, spin = 0;
  const pose = () => {
    intake.rotation.z = deploy * INTAKE_DEPLOY;
    stage1.position.y = -STAGE1_DROP * (1 - extension);
    carriage.position.y = -CARRIAGE_DROP * (1 - extension);
    wrench.rotation.x = -WRENCH_FOLD * (1 - wrenchOut);
    hood.rotation.z = pitch;
  };
  pose();
  return {
    replaces: ['chassis', 'hopper', 'launcher', 'climber', 'intakeRollers', 'funnel'],
    intakeAnchor: tip, climbAnchor: contact, lightAt: [-.1, .55, .28],
    flow: {
      intake: () => [new THREE.Vector3(-.42, .12, 0), new THREE.Vector3(-.28, .24, 0), new THREE.Vector3(-.15, .253, 0)],
      stow: () => new THREE.Vector3(.178, .30, 0),
    },
    update(s) {
      showHeld(s.fill);
      if (!animated()) return;
      deploy = scoringEase(deploy, s.enabled && !s.climb ? 1 : 0, s.dt);
      extension = scoringEase(extension, s.climb > .6 ? 1 : s.climb > 0 ? .35 : 0, s.dt);
      wrenchOut = scoringEase(wrenchOut, s.climb > 0 ? 1 : 0, s.dt);
      turret.rotation.y = k.turret.rotation.y;
      // Hood tilts about the flywheel shaft with the launch elevation [EST range].
      pitch = scoringEase(pitch, s.aiming ? THREE.MathUtils.clamp(s.hood, .26, 1.22) - .85 : 0, s.dt);
      spin += (s.enabled && (s.aiming || s.firing > 0) ? 45 : 0) * s.dt; flywheel.rotation.z = spin;
      pose();
    },
  };
}
