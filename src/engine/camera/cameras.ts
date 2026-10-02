import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { FieldFrame, FieldPoint, FieldPose } from '../coords';
import { clamp } from '../units';

/**
 * Casts a ray through the solid field (and other robots) from `from` toward `to` (world coords). Returns
 * the distance to the first hit, or null when the segment is clear. Used to keep chase cameras out of walls.
 */
export type CameraOcclusion = (from: THREE.Vector3, to: THREE.Vector3) => number | null;

export type CameraMode = 'driver' | 'chase' | 'overhead' | 'orbit';
export const CAMERA_MODES: CameraMode[] = ['driver', 'chase', 'overhead', 'orbit'];
export const CAMERA_LABELS: Record<CameraMode, string> = {
  driver: 'Driver station',
  chase: 'Chase (locked behind)',
  overhead: 'Overhead',
  orbit: 'Free orbit',
};

const CHASE_MARGIN = 0.25;
const CHASE_MIN_DIST = 0.6;

/**
 * Camera rig with the standard FRC viewpoints. `referenceYaw` is the field yaw that "forward" on the
 * sticks maps to — fixed for driver-station/overhead (field-oriented driving), camera yaw otherwise.
 *
 * chase:  locked behind the robot's heading; pulled in toward the robot when field elements are in the way.
 */
export class CameraRig {
  mode: CameraMode = 'driver';
  private orbit: OrbitControls;
  private readonly lookAt = new THREE.Vector3();
  private readonly desiredPos = new THREE.Vector3();
  private readonly desiredLook = new THREE.Vector3();
  private initialized = false;

  /** Set by the game: lets the chase camera stay in front of walls and other solid field elements. */
  occlusion: CameraOcclusion | null = null;
  private readonly anchor = new THREE.Vector3();
  private readonly toCam = new THREE.Vector3();

  constructor(
    readonly camera: THREE.PerspectiveCamera,
    readonly dom: HTMLElement,
    readonly frame: FieldFrame,
    /** Driver eye position (field frame) and the yaw the driver faces. */
    public driverEye: { x: number; y: number; z: number; yaw: number },
  ) {
    this.orbit = new OrbitControls(camera, dom);
    this.orbit.enabled = false;
    this.orbit.enableDamping = true;
    this.orbit.maxPolarAngle = Math.PI / 2 - 0.02;
    this.orbit.minDistance = 1;
    this.orbit.maxDistance = 40;
  }

  setMode(mode: CameraMode): void {
    // Saved settings from older versions may name the removed 'follow' (3rd person) mode.
    if (!CAMERA_MODES.includes(mode)) mode = 'chase';
    this.mode = mode;
    this.orbit.enabled = mode === 'orbit';
    if (mode === 'orbit') {
      this.orbit.target.copy(this.lookAt);
      this.orbit.update();
    }
    this.initialized = false;
  }

  next(): CameraMode {
    const i = CAMERA_MODES.indexOf(this.mode);
    this.setMode(CAMERA_MODES[(i + 1) % CAMERA_MODES.length]);
    return this.mode;
  }

  get referenceYaw(): number {
    if (this.mode === 'driver' || this.mode === 'overhead') return this.driverEye.yaw;
    const dir = new THREE.Vector3();
    this.camera.getWorldDirection(dir);
    return Math.atan2(-dir.z, dir.x);
  }

  update(dt: number, target: FieldPose | null, focus?: FieldPoint, targetZ = 0): void {
    const f = this.frame;
    const t = target ?? { x: f.length / 2, y: f.width / 2, yaw: 0 };
    const k = this.initialized ? 1 - Math.exp(-dt * 6) : 1;
    switch (this.mode) {
      case 'driver': {
        const e = this.driverEye;
        f.toWorld(e.x, e.y, e.z, this.desiredPos);
        // Look toward a point between the far field and the robot so the robot stays in view.
        const far = { x: e.x + Math.cos(e.yaw) * f.length * 0.55, y: f.width / 2 };
        const fx = focus ?? t;
        f.toWorld(far.x * 0.45 + fx.x * 0.55, far.y * 0.35 + fx.y * 0.65, 0, this.desiredLook);
        break;
      }
      case 'chase': {
        const back = 2.6;
        f.toWorld(t.x - Math.cos(t.yaw) * back, t.y - Math.sin(t.yaw) * back, targetZ + 1.7, this.desiredPos);
        f.toWorld(t.x + Math.cos(t.yaw) * 2.5, t.y + Math.sin(t.yaw) * 2.5, targetZ + 0.3, this.desiredLook);
        break;
      }
      case 'overhead': {
        const e = this.driverEye;
        f.toWorld(f.length / 2 - Math.cos(e.yaw) * 5.5, f.width / 2 - Math.sin(e.yaw) * 5.5, 14.5, this.desiredPos);
        f.toWorld(f.length / 2 + Math.cos(e.yaw) * 0.6, f.width / 2 + Math.sin(e.yaw) * 0.6, 0, this.desiredLook);
        break;
      }
      case 'orbit': {
        this.orbit.update();
        this.lookAt.copy(this.orbit.target);
        this.initialized = true;
        return;
      }
    }
    this.camera.position.lerp(this.desiredPos, k);
    this.lookAt.lerp(this.desiredLook, k);
    if (this.mode === 'chase') this.keepInFront(t, targetZ);
    this.camera.lookAt(this.lookAt);
    this.initialized = true;
  }

  /**
   * Pull the camera toward the robot when something solid is between them, so the view is never buried
   * inside (or hidden behind) a field element. Applied after smoothing so it takes effect immediately.
   */
  private keepInFront(t: FieldPose, targetZ: number): void {
    if (!this.occlusion) return;
    this.frame.toWorld(t.x, t.y, targetZ + 0.6, this.anchor);
    this.toCam.copy(this.camera.position).sub(this.anchor);
    const len = this.toCam.length();
    if (len < 1e-3) return;
    const hit = this.occlusion(this.anchor, this.camera.position);
    if (hit === null) return;
    const dist = clamp(hit - CHASE_MARGIN, CHASE_MIN_DIST, len);
    this.camera.position.copy(this.anchor).addScaledVector(this.toCam, dist / len);
  }

  dispose(): void {
    this.orbit.dispose();
  }
}
