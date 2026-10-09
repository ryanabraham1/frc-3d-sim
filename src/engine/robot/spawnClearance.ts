import * as THREE from 'three';
import type { Robot } from './robot';

/**
 * Distance from a piece spawned at `p` (world) to the robot's collision box, minus the piece radius.
 * `halfHeight` < r marks a flat piece (a ring/disc): its vertical and horizontal extents differ.
 */
export function spawnClearance(robot: Robot, p: { x: number; y: number; z: number }, r: number, halfHeight = r): number {
  // Into the chassis frame (the robot may be tilted).
  const t = robot.body.translation();
  const q = robot.body.rotation();
  const v = new THREE.Vector3(p.x - t.x, p.y - t.y, p.z - t.z).applyQuaternion(new THREE.Quaternion(q.x, q.y, q.z, q.w).invert());
  const fp = robot.footprint;
  const ox = Math.max(0, Math.abs(v.x) - fp.length / 2);
  const oz = Math.max(0, Math.abs(v.z) - fp.width / 2);
  const y = v.y;
  const oy = y > robot.config.height ? y - robot.config.height : y < 0 ? -y : 0;
  if (halfHeight < r) return Math.max(oy - halfHeight, Math.hypot(ox, oz) - r);
  return Math.hypot(ox, oy, oz) - r;
}
