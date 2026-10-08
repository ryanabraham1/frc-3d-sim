import * as THREE from 'three';
import type { ModelKit, PlaceAnim, RobotAnimState } from './models';

/** Small helpers shared by the per-robot REEFSCAPE CAD rigs (taiyaki, wisp, singularity, relay, redundancy). */
export type V3 = [number, number, number];

/** Reparent a named CAD group under a new pivot at a measured joint, preserving its exported pose. */
export function mount(root: THREE.Object3D, name: string, at: V3, parent: THREE.Object3D = root): THREE.Group {
  const g = new THREE.Group(); g.name = `cad-${name}-pivot`; g.position.fromArray(at);
  root.add(g); root.updateMatrixWorld(true);
  const part = root.getObjectByName(name);
  if (part) g.attach(part);
  if (parent !== root) parent.attach(g);
  return g;
}

/** An empty marker placed at a robot-local point and carried by `parent`. */
export function anchor(root: THREE.Object3D, parent: THREE.Object3D, at: V3): THREE.Object3D {
  const a = new THREE.Object3D(); a.position.fromArray(at); root.add(a); root.updateMatrixWorld(true); parent.attach(a); return a;
}

/** Robot-local position of an object (for piece-flow paths). */
export function point(k: ModelKit, o: THREE.Object3D): THREE.Vector3 {
  k.visual.updateMatrixWorld(true); return k.visual.worldToLocal(o.getWorldPosition(new THREE.Vector3()));
}

export const ease = (a: number, b: number, dt: number, rate = 9) => dt > 0 ? a + (b - a) * (1 - Math.exp(-rate * dt)) : b;
export const placeOf = (s: RobotAnimState): PlaceAnim => s.place ?? { height: .45, forward: .3, level: 1 };
export const parked = (p: PlaceAnim) => p.height <= .46 && !p.handoff;

/**
 * Elevator + pitch-joint inverse kinematics in the robot X/Y plane. `pivot` is the joint in the export pose and
 * `grip` the tool point (both robot-local, export pose). Returns the carriage rise and the joint rotation (about +Z,
 * relative to the export pose) that put the grip at (x, y); a tool that cannot reach keeps its closest solution.
 */
export function pitchIK(pivot: V3, grip: V3, x: number, y: number, rise: [number, number], preferUp = true): { rise: number; angle: number } {
  const vx = grip[0] - pivot[0], vy = grip[1] - pivot[1], r = Math.hypot(vx, vy), a0 = Math.atan2(vy, vx);
  const c = THREE.MathUtils.clamp((x - pivot[0]) / r, -1, 1);
  let a = Math.acos(c) * (preferUp ? 1 : -1);
  let d = y - pivot[1] - r * Math.sin(a);
  if (d < rise[0]) { a = -Math.abs(a); d = y - pivot[1] - r * Math.sin(a); }
  if (d > rise[1] && preferUp === false) { a = Math.abs(a); d = y - pivot[1] - r * Math.sin(a); }
  return { rise: THREE.MathUtils.clamp(d, rise[0], rise[1]), angle: Math.atan2(Math.sin(a - a0), Math.cos(a - a0)) };
}
