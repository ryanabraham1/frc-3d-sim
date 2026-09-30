import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { GROUPS, PhysicsWorld } from '../physics/world';
import { FieldFrame } from '../coords';

export interface GamePieceSpec {
  name: string;
  /** Visual radius (m). */
  radius: number;
  /** Collider radius as a fraction of visual radius (<1 models squishy foam, allows tight staging). */
  colliderScale?: number;
  mass: number;
  restitution: number;
  friction: number;
  /** Linear damping while airborne (keep low so ballistic aim math stays accurate). */
  airDamping?: number;
  /** Linear damping while touching the floor (models carpet rolling resistance). */
  groundDamping?: number;
  angularDamping?: number;
  color: THREE.ColorRepresentation;
  count: number;
}

/**
 * field    – simulated rigid body on the field
 * held     – inside a robot (body disabled, hidden)
 * reserve  – out of play: human player stock, inside a goal being processed, etc.
 */
export type PieceState = 'field' | 'held' | 'reserve';

const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0);

/** Fixed-size pool of spherical game pieces rendered with a single InstancedMesh. */
export class GamePiecePool {
  readonly bodies: RAPIER.RigidBody[] = [];
  readonly state: PieceState[] = [];
  /** Robot id holding the piece, or -1. */
  readonly owner: number[] = [];
  /** Free-form tag set by season rules (e.g. which hub is processing it). */
  readonly tag: (string | null)[] = [];
  private readonly airborne: boolean[] = [];
  /** Pieces whose state/owner/tag changed since the last `takeChanges()` (multiplayer host). */
  private readonly changed = new Set<number>();
  readonly mesh: THREE.InstancedMesh;
  readonly radius: number;
  readonly colliderRadius: number;
  private readonly tmpM = new THREE.Matrix4();
  private readonly tmpQ = new THREE.Quaternion();
  private readonly tmpP = new THREE.Vector3();
  private readonly one = new THREE.Vector3(1, 1, 1);

  constructor(
    readonly physics: PhysicsWorld,
    scene: THREE.Scene,
    readonly frame: FieldFrame,
    readonly spec: GamePieceSpec,
  ) {
    const R = physics.R;
    this.radius = spec.radius;
    this.colliderRadius = spec.radius * (spec.colliderScale ?? 1);
    const geo = new THREE.SphereGeometry(spec.radius, 14, 10);
    const mat = new THREE.MeshStandardMaterial({ color: spec.color, roughness: 0.65 });
    this.mesh = new THREE.InstancedMesh(geo, mat, spec.count);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);

    for (let i = 0; i < spec.count; i++) {
      const body = physics.world.createRigidBody(
        R.RigidBodyDesc.dynamic()
          .setTranslation(0, -10 - i * 0.2, 0)
          .setLinearDamping(spec.groundDamping ?? 0.5)
          .setAngularDamping(spec.angularDamping ?? 0.6)
          .setCcdEnabled(true)
          .setCanSleep(true)
          .setEnabled(false),
      );
      const col = R.ColliderDesc.ball(this.colliderRadius)
        .setMass(spec.mass)
        .setRestitution(spec.restitution)
        .setFriction(spec.friction)
        .setCollisionGroups(GROUPS.piece);
      physics.world.createCollider(col, body);
      this.bodies.push(body);
      this.state.push('reserve');
      this.owner.push(-1);
      this.tag.push(null);
      this.airborne.push(false);
      this.mesh.setMatrixAt(i, HIDDEN);
    }
  }

  get count(): number {
    return this.bodies.length;
  }

  /** Put piece i on the field at a WORLD position with optional WORLD velocity. */
  placeWorld(i: number, pos: THREE.Vector3, vel?: THREE.Vector3): void {
    const b = this.bodies[i];
    b.setEnabled(true);
    b.setTranslation({ x: pos.x, y: pos.y, z: pos.z }, true);
    b.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
    b.setLinvel(vel ? { x: vel.x, y: vel.y, z: vel.z } : { x: 0, y: 0, z: 0 }, true);
    b.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.state[i] = 'field';
    this.owner[i] = -1;
    this.tag[i] = null;
    this.changed.add(i);
  }

  /** Put piece i on the field at a FIELD position (x, y, z-up), resting on the carpet if z omitted. */
  placeField(i: number, x: number, y: number, z?: number): void {
    this.placeWorld(i, this.frame.toWorld(x, y, z ?? this.colliderRadius + 0.001, this.tmpP));
  }

  hold(i: number, ownerId: number): void {
    this.bodies[i].setEnabled(false);
    this.state[i] = 'held';
    this.owner[i] = ownerId;
    this.changed.add(i);
  }

  reserve(i: number, tag: string | null = null): void {
    this.bodies[i].setEnabled(false);
    this.state[i] = 'reserve';
    this.owner[i] = -1;
    this.tag[i] = tag;
    this.changed.add(i);
  }

  /** Indices changed since the last call (and clears the set). */
  takeChanges(): number[] {
    const out = [...this.changed];
    this.changed.clear();
    return out;
  }

  /**
   * Replica (multiplayer client) update: set bookkeeping without simulating. Bodies stay disabled —
   * clients never step physics for pieces; positions come from snapshots via `setReplicaPosition`.
   */
  applyReplicaState(i: number, state: PieceState, owner: number, tag: string | null): void {
    this.state[i] = state;
    this.owner[i] = owner;
    this.tag[i] = tag;
  }

  setReplicaPosition(i: number, x: number, y: number, z: number): void {
    this.bodies[i].setTranslation({ x, y, z }, false);
  }

  /** Indices in a state (optionally with a tag). */
  indices(state: PieceState, tag?: string | null): number[] {
    const out: number[] = [];
    for (let i = 0; i < this.state.length; i++) {
      if (this.state[i] === state && (tag === undefined || this.tag[i] === tag)) out.push(i);
    }
    return out;
  }

  countIn(state: PieceState, tag?: string | null): number {
    let n = 0;
    for (let i = 0; i < this.state.length; i++) if (this.state[i] === state && (tag === undefined || this.tag[i] === tag)) n++;
    return n;
  }

  /** World position of a field piece (live reference from Rapier). */
  position(i: number): { x: number; y: number; z: number } {
    return this.bodies[i].translation();
  }

  velocity(i: number): { x: number; y: number; z: number } {
    return this.bodies[i].linvel();
  }

  /** Switch damping between air/ground values. Call once per physics step. */
  updateDamping(): void {
    const air = this.spec.airDamping ?? 0.02;
    const ground = this.spec.groundDamping ?? 0.5;
    const thresh = this.colliderRadius + 0.03;
    for (let i = 0; i < this.bodies.length; i++) {
      if (this.state[i] !== 'field') continue;
      const b = this.bodies[i];
      if (b.isSleeping()) continue;
      const inAir = b.translation().y > thresh;
      if (inAir !== this.airborne[i]) {
        this.airborne[i] = inAir;
        b.setLinearDamping(inAir ? air : ground);
      }
    }
  }

  syncVisuals(): void {
    for (let i = 0; i < this.bodies.length; i++) {
      if (this.state[i] !== 'field') {
        this.mesh.setMatrixAt(i, HIDDEN);
        continue;
      }
      const b = this.bodies[i];
      const t = b.translation();
      const r = b.rotation();
      this.tmpP.set(t.x, t.y, t.z);
      this.tmpQ.set(r.x, r.y, r.z, r.w);
      this.tmpM.compose(this.tmpP, this.tmpQ, this.one);
      this.mesh.setMatrixAt(i, this.tmpM);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
