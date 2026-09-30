import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { FieldFrame } from '../coords';
import { GROUPS, type PhysicsWorld } from '../physics/world';
import type { Vec3 } from './builder';

/** A rigid part of a hanging element, in the element's local FIELD axes (x, y, z-up) relative to its origin. */
export type HangingPart =
  | { kind: 'box'; center: Vec3; size: Vec3 }
  | { kind: 'cylinder'; a: Vec3; b: Vec3; radius: number };

export interface HangingSpec {
  /** Element origin at rest, in field frame. */
  origin: Vec3;
  /** Fixed pivot (eye nut / chain top) in field frame. The element swings as a pendulum about it. */
  pivot: Vec3;
  parts: HangingPart[];
  /** Total mass, kg. */
  mass: number;
  material: THREE.Material;
  /** Local point where the chain/rope drawn from the pivot attaches (e.g. top plate center). */
  tetherFrom?: Vec3;
  tetherRadius?: number;
  tetherMaterial?: THREE.Material;
  linearDamping?: number;
  angularDamping?: number;
  friction?: number;
  name?: string;
}

/** Host state for replication: world position + quaternion. */
export type HangingNetState = [number, number, number, number, number, number, number];

const UP = new THREE.Vector3(0, 1, 0);
const round = (v: number, k: number) => Math.round(v * k) / k;

/**
 * A field element that hangs from a fixed point and SWINGS when robots or pieces push it (2025 CAGES,
 * hanging chains, flaps). Real fields often include parts that move. Model them as dynamic bodies like
 * this, never as static geometry, so pushing, defence, contact fouls and climbing match the real field.
 *
 * Host: a dynamic rigid body on a spherical joint. `hold()` makes it follow something (e.g. a climbing
 * robot) kinematically and `release()` lets it swing again. Multiplayer clients call `applyNetState()`,
 * which poses it kinematically from host snapshots. Call `syncVisual()` every rendered frame.
 */
export class HangingElement {
  readonly body: RAPIER.RigidBody;
  readonly visual = new THREE.Group();
  readonly colliders: RAPIER.Collider[] = [];
  private readonly rest: THREE.Vector3;
  private readonly pivotWorld: THREE.Vector3;
  private readonly tether: THREE.Mesh | null = null;
  private readonly tetherLocal: THREE.Vector3 | null = null;
  private held = false;
  private replica = false;
  private readonly tmp = new THREE.Vector3();
  private readonly tmpQ = new THREE.Quaternion();

  constructor(private readonly physics: PhysicsWorld, parent: THREE.Object3D, private readonly frame: FieldFrame, spec: HangingSpec) {
    const R = physics.R;
    this.rest = frame.toWorld(...spec.origin);
    this.pivotWorld = frame.toWorld(...spec.pivot);
    this.body = physics.world.createRigidBody(R.RigidBodyDesc.dynamic()
      .setTranslation(this.rest.x, this.rest.y, this.rest.z)
      .setLinearDamping(spec.linearDamping ?? 0.25)
      .setAngularDamping(spec.angularDamping ?? 0.8)
      .setCcdEnabled(true));
    const volume = spec.parts.reduce((v, p) => v + (p.kind === 'box' ? p.size[0] * p.size[1] * p.size[2]
      : Math.PI * p.radius ** 2 * Math.hypot(p.b[0] - p.a[0], p.b[1] - p.a[1], p.b[2] - p.a[2])), 0);
    const density = spec.mass / Math.max(volume, 1e-6);
    for (const part of spec.parts) {
      let desc: RAPIER.ColliderDesc, geo: THREE.BufferGeometry;
      const pos = new THREE.Vector3(), q = new THREE.Quaternion();
      if (part.kind === 'box') {
        const [sx, sy, sz] = part.size;
        desc = R.ColliderDesc.cuboid(sx / 2, sz / 2, sy / 2);
        geo = new THREE.BoxGeometry(sx, sz, sy);
        pos.copy(local(part.center));
      } else {
        const a = local(part.a), b = local(part.b), len = a.distanceTo(b);
        desc = R.ColliderDesc.cylinder(len / 2, part.radius);
        geo = new THREE.CylinderGeometry(part.radius, part.radius, len, 12);
        pos.copy(a).add(b).multiplyScalar(0.5);
        q.setFromUnitVectors(UP, b.clone().sub(a).normalize());
      }
      desc.setTranslation(pos.x, pos.y, pos.z).setRotation(q).setDensity(density)
        .setFriction(spec.friction ?? 0.5).setRestitution(0.1).setCollisionGroups(GROUPS.field);
      this.colliders.push(physics.world.createCollider(desc, this.body));
      const mesh = new THREE.Mesh(geo, spec.material);
      mesh.position.copy(pos); mesh.quaternion.copy(q); mesh.castShadow = true;
      this.visual.add(mesh);
    }
    // Fixed body at the world origin, so anchor1 is the pivot's world position.
    const anchor2 = this.pivotWorld.clone().sub(this.rest);
    physics.world.createImpulseJoint(R.JointData.spherical(
      { x: this.pivotWorld.x, y: this.pivotWorld.y, z: this.pivotWorld.z }, { x: anchor2.x, y: anchor2.y, z: anchor2.z }),
      physics.fixedBody(), this.body, true);
    if (spec.name) this.visual.name = spec.name;
    parent.add(this.visual);
    if (spec.tetherFrom) {
      this.tetherLocal = local(spec.tetherFrom);
      this.tether = new THREE.Mesh(new THREE.CylinderGeometry(spec.tetherRadius ?? 0.007, spec.tetherRadius ?? 0.007, 1, 6), spec.tetherMaterial ?? spec.material);
      parent.add(this.tether);
    }
    this.syncVisual();
  }

  /** Current origin in field frame. */
  fieldPosition(): { x: number; y: number; z: number } { return this.frame.toField(this.body.translation()); }
  /** Horizontal swing of the origin away from rest, meters. */
  swing(): number { const t = this.body.translation(); return Math.hypot(t.x - this.rest.x, t.z - this.rest.z); }
  get isHeld(): boolean { return this.held; }

  /** Follow a target origin (field frame), upright, e.g. while a robot climbs it. Call once per physics step. */
  hold(x: number, y: number, z: number): void {
    if (!this.held) { this.body.setBodyType(this.physics.R.RigidBodyType.KinematicPositionBased, true); this.held = true; }
    const w = this.frame.toWorld(x, y, z, this.tmp);
    this.body.setNextKinematicTranslation({ x: w.x, y: w.y, z: w.z });
    this.body.setNextKinematicRotation({ x: 0, y: 0, z: 0, w: 1 });
  }

  /** Let the element swing freely again from where it is, at rest. */
  release(): void {
    if (!this.held || this.replica) return;
    this.held = false;
    this.body.setBodyType(this.physics.R.RigidBodyType.Dynamic, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
  }

  /** Back to hanging still at rest (match reset). */
  reset(): void {
    this.release();
    this.body.setTranslation({ x: this.rest.x, y: this.rest.y, z: this.rest.z }, true);
    this.body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
  }

  /** Give it a push (world-frame impulse at the origin), e.g. in tests. */
  push(fx: number, fy: number): void { this.body.applyImpulse(this.frame.velToWorld(fx, fy, 0, this.tmp), true); }

  netState(): HangingNetState {
    const t = this.body.translation(), q = this.body.rotation();
    return [round(t.x, 1000), round(t.y, 1000), round(t.z, 1000), round(q.x, 1e4), round(q.y, 1e4), round(q.z, 1e4), round(q.w, 1e4)];
  }

  /** Multiplayer client: pose from the host; the local body only collides (kinematic). */
  applyNetState(s: HangingNetState): void {
    if (!this.replica) { this.body.setBodyType(this.physics.R.RigidBodyType.KinematicPositionBased, true); this.replica = true; this.held = true; }
    this.body.setTranslation({ x: s[0], y: s[1], z: s[2] }, true);
    this.body.setRotation({ x: s[3], y: s[4], z: s[5], w: s[6] }, true);
  }

  /** Copy the body pose to the visual (smoothed on replicas, which update at snapshot rate) and redraw the tether. */
  syncVisual(dt = 0): void {
    const t = this.body.translation(), r = this.body.rotation();
    this.tmpQ.set(r.x, r.y, r.z, r.w);
    const k = this.replica && dt > 0 ? 1 - Math.exp(-dt * 20) : 1;
    this.visual.position.lerp(this.tmp.set(t.x, t.y, t.z), k);
    this.visual.quaternion.slerp(this.tmpQ, k);
    if (this.tether && this.tetherLocal) {
      const end = this.tetherLocal.clone().applyQuaternion(this.visual.quaternion).add(this.visual.position);
      const len = end.distanceTo(this.pivotWorld);
      this.tether.position.copy(end).add(this.pivotWorld).multiplyScalar(0.5);
      this.tether.quaternion.setFromUnitVectors(UP, this.pivotWorld.clone().sub(end).normalize());
      this.tether.scale.set(1, Math.max(len, 1e-3), 1);
    }
  }
}

/** Local field axes (x, y, z-up) → local world axes (x, z-up→y, -y→z). */
function local(p: Vec3): THREE.Vector3 { return new THREE.Vector3(p[0], p[2], -p[1]); }
