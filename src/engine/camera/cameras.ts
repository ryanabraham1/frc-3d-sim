import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { FieldFrame, FieldPoint, FieldPose } from '../coords';
import { clamp, wrapAngle } from '../units';

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
/** Extra clear distance (m) required before the chase camera moves back out after being pulled in. */
const CHASE_RELEASE_BAND = 0.2;

/**
 * Camera rig with the standard FRC viewpoints. `referenceYaw` is the field yaw that "forward" on the
 * sticks maps to — fixed for driver-station/overhead (field-oriented driving), camera yaw otherwise.
 *
 * chase:  locked behind the robot, looking along its intake side (so you see where you're about to intake)
 *         or its shooter side (toggle with `toggleChaseFacing`); pulled in when field elements are in the way.
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
  /** Fraction (0..1) of the chase offset kept after pulling in for obstacles. Snaps in, eases back out. */
  private chaseScale = 1;
  /** Which end of the robot the chase camera looks toward. */
  chaseFacing: 'intake' | 'shooter' = 'intake';
  /** Yaw offset (0 or π) from the robot's heading to its floor-intake direction; the game keeps it current. */
  chaseIntakeOffset = 0;
  private chaseFlip = 0;
  private readonly offset = new THREE.Vector3();
  private readonly probe = new THREE.Vector3();

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
    this.chaseScale = 1;
  }

  /** Swing the chase view between the intake side and the shooter side. */
  toggleChaseFacing(): 'intake' | 'shooter' {
    this.chaseFacing = this.chaseFacing === 'intake' ? 'shooter' : 'intake';
    return this.chaseFacing;
  }

  /** Display name of the current view (chase says which end it is looking along). */
  get label(): string {
    if (this.mode !== 'chase') return CAMERA_LABELS[this.mode];
    return `Chase (${this.chaseFacing === 'intake' ? 'intake view' : 'shooter view'})`;
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
        const want = this.chaseFacing === 'intake' ? this.chaseIntakeOffset : 0;
        this.chaseFlip = this.initialized ? this.chaseFlip + wrapAngle(want - this.chaseFlip) * (1 - Math.exp(-dt * 5)) : want;
        const yaw = t.yaw + this.chaseFlip;
        const back = 2.6;
        f.toWorld(t.x - Math.cos(yaw) * back, t.y - Math.sin(yaw) * back, targetZ + 1.7, this.desiredPos);
        f.toWorld(t.x + Math.cos(yaw) * 2.5, t.y + Math.sin(yaw) * 2.5, targetZ + 0.3, this.desiredLook);
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
    if (this.mode === 'chase') this.pullInFromObstacles(dt, t, targetZ);
    this.camera.position.lerp(this.desiredPos, k);
    this.lookAt.lerp(this.desiredLook, k);
    this.camera.lookAt(this.lookAt);
    this.initialized = true;
  }

  /**
   * Shorten the chase offset when something solid is between the robot and the camera's target spot, so the
   * view is never buried inside a field element. The ray goes to the *target* position (not the smoothed
   * camera), so the result doesn't feed back into itself: a closer obstacle snaps the offset in, a clearer
   * view eases it back out slowly, which keeps the camera from jittering along grazing edges.
   */
  private pullInFromObstacles(dt: number, t: FieldPose, targetZ: number): void {
    this.frame.toWorld(t.x, t.y, targetZ + 0.6, this.anchor);
    const offset = this.offset.copy(this.desiredPos).sub(this.anchor);
    const len = offset.length();
    let target = 1;
    const hit = this.occlusion && len > 1e-3 ? this.occlusion(this.anchor, this.probe.copy(this.desiredPos)) : null;
    if (hit !== null) target = clamp((hit - CHASE_MARGIN) / len, Math.min(1, CHASE_MIN_DIST / len), 1);
    if (target < this.chaseScale) this.chaseScale = target;
    // Dead-band: only back out again when there is clearly more room, so a noisy hit distance can't pump the camera.
    else if ((target - this.chaseScale) * len > CHASE_RELEASE_BAND) this.chaseScale += (target - this.chaseScale) * (1 - Math.exp(-dt * 2.5));
    this.desiredPos.copy(this.anchor).addScaledVector(offset, this.chaseScale);
  }

  dispose(): void {
    this.orbit.dispose();
  }
}
