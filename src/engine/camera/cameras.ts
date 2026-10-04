import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { FieldFrame, FieldPoint, FieldPose } from '../coords';
import { clamp, wrapAngle } from '../units';

export type CameraMode = 'driver' | 'follow' | 'chase' | 'overhead' | 'orbit';
export const CAMERA_MODES: CameraMode[] = ['driver', 'follow', 'chase', 'overhead', 'orbit'];
export const CAMERA_LABELS: Record<CameraMode, string> = {
  driver: 'Driver station',
  follow: '3rd person',
  chase: 'Chase (locked behind)',
  overhead: 'Overhead',
  orbit: 'Free orbit',
};

/** 3rd-person camera: distance behind the robot (toward its driver station) and height above it, m. */
const FOLLOW_BACK = 3.4;
const FOLLOW_HEIGHT = 2.5;
/** How far past the robot (downfield) the 3rd-person camera aims, m. */
const FOLLOW_LEAD = 1.2;
/** How far the 3rd-person camera may sit beyond either alliance wall (short of the driver-station booths), m. */
const FOLLOW_WALL_OVERHANG = 0.8;

/**
 * Camera rig with the standard FRC viewpoints. `referenceYaw` is the field yaw that "forward" on the
 * sticks maps to — fixed for driver-station/overhead (field-oriented driving), camera yaw otherwise.
 *
 * follow: 3rd person. Trails the robot from its driver's side but keeps the driver-station heading, so the view
 *         never swings when the robot turns and field-oriented sticks still match the screen. It doesn't pull in
 *         for obstacles: in every view, the game fades whatever field element hides the robot (`OcclusionFader`).
 * chase:  locked behind the robot, looking along its intake side (so you see where you're about to intake)
 *         or its shooter side (toggle with `toggleChaseFacing`).
 */
export class CameraRig {
  mode: CameraMode = 'driver';
  private orbit: OrbitControls;
  private readonly lookAt = new THREE.Vector3();
  private readonly desiredPos = new THREE.Vector3();
  private readonly desiredLook = new THREE.Vector3();
  private initialized = false;

  /** Which end of the robot the chase camera looks toward. */
  chaseFacing: 'intake' | 'shooter' = 'intake';
  /** Yaw offset (0 or π) from the robot's heading to its floor-intake direction; the game keeps it current. */
  chaseIntakeOffset = 0;
  private chaseFlip = 0;

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
    if (!CAMERA_MODES.includes(mode)) mode = 'follow';
    this.mode = mode;
    this.orbit.enabled = mode === 'orbit';
    if (mode === 'orbit') {
      this.orbit.target.copy(this.lookAt);
      this.orbit.update();
    }
    this.initialized = false;
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
    if (this.mode === 'driver' || this.mode === 'overhead' || this.mode === 'follow') return this.driverEye.yaw;
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
      case 'follow': {
        const yaw = this.driverEye.yaw;
        const c = Math.cos(yaw);
        const s = Math.sin(yaw);
        const camX = clamp(t.x - c * FOLLOW_BACK, -FOLLOW_WALL_OVERHANG, f.length + FOLLOW_WALL_OVERHANG);
        f.toWorld(camX, t.y - s * FOLLOW_BACK, targetZ + FOLLOW_HEIGHT, this.desiredPos);
        f.toWorld(t.x + c * FOLLOW_LEAD, t.y + s * FOLLOW_LEAD, targetZ + 0.2, this.desiredLook);
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
    this.camera.position.lerp(this.desiredPos, k);
    this.lookAt.lerp(this.desiredLook, k);
    this.camera.lookAt(this.lookAt);
    this.initialized = true;
  }

  dispose(): void {
    this.orbit.dispose();
  }
}
