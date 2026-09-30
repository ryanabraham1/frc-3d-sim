import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { FieldFrame, FieldPoint, FieldPose } from '../coords';
import { clamp } from '../units';

export type CameraMode = 'driver' | 'follow' | 'chase' | 'overhead' | 'orbit';
export const CAMERA_MODES: CameraMode[] = ['driver', 'follow', 'chase', 'overhead', 'orbit'];
export const CAMERA_LABELS: Record<CameraMode, string> = {
  driver: 'Driver station',
  follow: 'Follow (3rd person)',
  chase: 'Chase (locked behind)',
  overhead: 'Overhead',
  orbit: 'Free orbit',
};

/**
 * Camera rig with the standard FRC viewpoints. `referenceYaw` is the field yaw that "forward" on the
 * sticks maps to — fixed for driver-station/overhead (field-oriented driving), camera yaw otherwise.
 *
 * follow: third-person camera that tracks the robot's position but NOT its rotation. Mouse drag
 *         orbits around the robot, wheel zooms. Driving is relative to the camera.
 * chase:  locked behind the robot's heading.
 */
export class CameraRig {
  mode: CameraMode = 'driver';
  private orbit: OrbitControls;
  private readonly lookAt = new THREE.Vector3();
  private readonly desiredPos = new THREE.Vector3();
  private readonly desiredLook = new THREE.Vector3();
  private initialized = false;

  /** Follow-camera spherical offset: yaw = field direction the camera looks, pitch above horizon. */
  followYaw: number;
  followPitch = 0.42;
  followDist = 3.6;
  private dragging = false;
  private lastX = 0;
  private lastY = 0;

  private readonly onDown = (e: PointerEvent) => {
    if (this.mode !== 'follow') return;
    this.dragging = true;
    this.lastX = e.clientX;
    this.lastY = e.clientY;
    this.dom.setPointerCapture?.(e.pointerId);
  };
  private readonly onMove = (e: PointerEvent) => {
    if (!this.dragging || this.mode !== 'follow') return;
    this.followYaw -= (e.clientX - this.lastX) * 0.006;
    this.followPitch = clamp(this.followPitch + (e.clientY - this.lastY) * 0.004, 0.08, 1.35);
    this.lastX = e.clientX;
    this.lastY = e.clientY;
  };
  private readonly onUp = () => {
    this.dragging = false;
  };
  private readonly onWheel = (e: WheelEvent) => {
    if (this.mode !== 'follow') return;
    e.preventDefault();
    this.followDist = clamp(this.followDist * (1 + e.deltaY * 0.0012), 1.4, 14);
  };
  private readonly onContext = (e: Event) => {
    if (this.mode === 'follow') e.preventDefault();
  };

  constructor(
    readonly camera: THREE.PerspectiveCamera,
    readonly dom: HTMLElement,
    readonly frame: FieldFrame,
    /** Driver eye position (field frame) and the yaw the driver faces. */
    public driverEye: { x: number; y: number; z: number; yaw: number },
  ) {
    this.followYaw = driverEye.yaw;
    this.orbit = new OrbitControls(camera, dom);
    this.orbit.enabled = false;
    this.orbit.enableDamping = true;
    this.orbit.maxPolarAngle = Math.PI / 2 - 0.02;
    this.orbit.minDistance = 1;
    this.orbit.maxDistance = 40;
    dom.addEventListener('pointerdown', this.onDown);
    window.addEventListener('pointermove', this.onMove);
    window.addEventListener('pointerup', this.onUp);
    dom.addEventListener('wheel', this.onWheel, { passive: false });
    dom.addEventListener('contextmenu', this.onContext);
  }

  setMode(mode: CameraMode): void {
    this.mode = mode;
    this.orbit.enabled = mode === 'orbit';
    if (mode === 'orbit') {
      this.orbit.target.copy(this.lookAt);
      this.orbit.update();
    }
    if (mode === 'follow') this.followYaw = this.driverEye.yaw;
    this.initialized = false;
  }

  next(): CameraMode {
    const i = CAMERA_MODES.indexOf(this.mode);
    this.setMode(CAMERA_MODES[(i + 1) % CAMERA_MODES.length]);
    return this.mode;
  }

  get referenceYaw(): number {
    if (this.mode === 'driver' || this.mode === 'overhead') return this.driverEye.yaw;
    if (this.mode === 'follow') return this.followYaw;
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
        const horiz = this.followDist * Math.cos(this.followPitch);
        const up = this.followDist * Math.sin(this.followPitch);
        const lookZ = targetZ + 0.45;
        f.toWorld(t.x - Math.cos(this.followYaw) * horiz, t.y - Math.sin(this.followYaw) * horiz, lookZ + up, this.desiredPos);
        f.toWorld(t.x, t.y, lookZ, this.desiredLook);
        // Follow tightly so the robot never drifts out of frame.
        const kf = this.initialized ? 1 - Math.exp(-dt * 14) : 1;
        this.camera.position.lerp(this.desiredPos, kf);
        this.lookAt.lerp(this.desiredLook, kf);
        this.camera.lookAt(this.lookAt);
        this.initialized = true;
        return;
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
    this.camera.lookAt(this.lookAt);
    this.initialized = true;
  }

  dispose(): void {
    this.orbit.dispose();
    this.dom.removeEventListener('pointerdown', this.onDown);
    window.removeEventListener('pointermove', this.onMove);
    window.removeEventListener('pointerup', this.onUp);
    this.dom.removeEventListener('wheel', this.onWheel);
    this.dom.removeEventListener('contextmenu', this.onContext);
  }
}
