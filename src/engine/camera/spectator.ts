import * as THREE from 'three';
import type { FieldFrame } from '../coords';

export const SPECTATOR_VIEWS = ['broadcast', 'overhead', 'blue', 'red', 'follow', 'orbit'] as const;
export type SpectatorView = typeof SPECTATOR_VIEWS[number];
export const SPECTATOR_LABELS: Record<SpectatorView, string> = {
  broadcast: 'Broadcast', overhead: 'Overhead', blue: 'Blue end', red: 'Red end', follow: 'Follow robot', orbit: 'Free orbit',
};

/** Fit the full arena into the usable view at any aspect ratio, including tall phone screens. */
export function spectatorFraming(frame: FieldFrame, view: Exclude<SpectatorView, 'follow' | 'orbit'>, fov: number, aspect: number) {
  const look = frame.toWorld(frame.length / 2, frame.width / 2, 1);
  const direction = new THREE.Vector3(...(view === 'broadcast' ? [-0.15, 0.85, 1] : view === 'blue' ? [-1, 0.7, 0.15] : view === 'red' ? [1, 0.7, -0.15] : [0, 1, 0.001]) as [number, number, number]).normalize();
  const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), direction).normalize();
  const up = new THREE.Vector3().crossVectors(direction, right).normalize();
  const vertical = Math.tan(THREE.MathUtils.degToRad(fov / 2)) * 0.78;
  const horizontal = vertical * Math.max(aspect, 0.1);
  let distance = 1;
  for (const x of [0, frame.length]) for (const y of [0, frame.width]) for (const z of [0, 4]) {
    const corner = frame.toWorld(x, y, z).sub(look);
    distance = Math.max(distance, corner.dot(direction) + Math.max(Math.abs(corner.dot(right)) / horizontal, Math.abs(corner.dot(up)) / vertical));
  }
  return { position: look.clone().addScaledVector(direction, distance), look };
}
