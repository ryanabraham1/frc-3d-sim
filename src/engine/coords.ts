import * as THREE from 'three';

/**
 * FIELD FRAME (used by all season code) — identical to the WPILib field coordinate system:
 *   origin = blue alliance wall, right-hand corner from the blue drivers' view
 *   +x toward the red alliance wall, +y to the left (from blue), +z up. Meters. Yaw CCW from +x.
 *
 * WORLD FRAME (Three.js / Rapier): y-up, origin at field center.
 *   world.x =  field.x - L/2
 *   world.y =  field.z
 *   world.z = -(field.y - W/2)
 * A field yaw θ maps to a rotation of θ about world +Y (verified: (cosθ, sinθ) -> (cosθ, 0, -sinθ)).
 */
export type Alliance = 'red' | 'blue';
export const ALLIANCES: readonly Alliance[] = ['red', 'blue'] as const;
export const opponent = (a: Alliance): Alliance => (a === 'red' ? 'blue' : 'red');

export interface FieldPoint {
  x: number;
  y: number;
}
export interface FieldPose extends FieldPoint {
  yaw: number;
}

export class FieldFrame {
  constructor(
    public readonly length: number,
    public readonly width: number,
  ) {}

  toWorld(x: number, y: number, z = 0, out = new THREE.Vector3()): THREE.Vector3 {
    return out.set(x - this.length / 2, z, -(y - this.width / 2));
  }

  toField(v: { x: number; y: number; z: number }): { x: number; y: number; z: number } {
    return { x: v.x + this.length / 2, y: this.width / 2 - v.z, z: v.y };
  }

  /** Field-frame velocity (vx, vy, vz-up) -> world vector. */
  velToWorld(vx: number, vy: number, vz = 0, out = new THREE.Vector3()): THREE.Vector3 {
    return out.set(vx, vz, -vy);
  }

  /** Rotationally-symmetric counterpart of a point (standard for most FRC fields). */
  mirrorRotational(p: FieldPoint): FieldPoint {
    return { x: this.length - p.x, y: this.width - p.y };
  }

  /** Mirror across the center line only (for mirror-symmetric fields). */
  mirrorX(p: FieldPoint): FieldPoint {
    return { x: this.length - p.x, y: p.y };
  }

  inField(p: FieldPoint, margin = 0): boolean {
    return p.x >= -margin && p.x <= this.length + margin && p.y >= -margin && p.y <= this.width + margin;
  }
}

/** Yaw (about world +Y) extracted from a quaternion. Equal to field yaw. */
export function yawFromQuat(q: { x: number; y: number; z: number; w: number }): number {
  return Math.atan2(2 * (q.w * q.y + q.x * q.z), 1 - 2 * (q.y * q.y + q.x * q.x));
}

export function quatFromYaw(yaw: number): { x: number; y: number; z: number; w: number } {
  return { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) };
}
