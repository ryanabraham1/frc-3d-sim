import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { collisionGroups, Group, GROUPS, PhysicsWorld } from '../physics/world';
import { FieldFrame } from '../coords';

export interface GamePieceSpec {
  /**
   * sphere (default) · tube (pipe along its length) · ring (a flat torus such as a 2024 NOTE: `radius` = outer
   * radius, `innerRadius` = hole radius, `length` = thickness; it rests flat and its collider is a flat disc).
   */
  shape?: 'sphere' | 'tube' | 'ring';
  length?: number;
  innerRadius?: number;
  /** Ring only: number of equidistant white tape bands (e.g. 3 for a 2024 HIGH NOTE). */
  stripes?: number;
  /**
   * Tube only: a real hollow collider (a ring of staves around the bore) so a pipe can pass through it — e.g. a 2025
   * CORAL sliding onto a BRANCH. `colliderInnerRadius` sets the bore (default `innerRadius`).
   */
  hollow?: boolean;
  colliderInnerRadius?: number;
  /** Additional piece types use stable index ranges in the same synchronized pool. */
  variants?: { start: number; spec: Omit<GamePieceSpec, 'variants'> }[];
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

function ringHalfHeight(s: Omit<GamePieceSpec, 'variants'>): number {
  return (s.length ?? s.radius * 0.28) / 2;
}

function restHeightOf(s: Omit<GamePieceSpec, 'variants'>): number {
  return s.shape === 'ring' ? ringHalfHeight(s) : s.radius;
}

/** Flat torus (hole axis = world up). Striped variants get white tape bands via vertex colors. */
function ringGeometry(s: Omit<GamePieceSpec, 'variants'>): THREE.BufferGeometry {
  const inner = s.innerRadius ?? s.radius * 0.7;
  const tube = (s.radius - inner) / 2;
  const geo = new THREE.TorusGeometry(inner + tube, tube, 10, 32).rotateX(Math.PI / 2);
  // Squash the round cross-section to the piece's thickness.
  geo.scale(1, ringHalfHeight(s) / tube, 1);
  const stripes = s.stripes ?? 0;
  if (stripes > 0) {
    const base = new THREE.Color(s.color);
    const white = new THREE.Color(0xffffff);
    const pos = geo.getAttribute('position');
    const colors = new Float32Array(pos.count * 3);
    for (let k = 0; k < pos.count; k++) {
      const a = Math.atan2(pos.getZ(k), pos.getX(k));
      const band = Math.abs(((a / (2 * Math.PI)) * stripes) % 1);
      const c = band < 0.12 ? white : base;
      colors.set([c.r, c.g, c.b], k * 3);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  }
  return geo;
}

/** Fixed-size pool of game pieces (spheres, tubes or rings), one InstancedMesh per piece type. */
export class GamePiecePool {
  readonly bodies: RAPIER.RigidBody[] = [];
  /** Per owner robot: hopper that keeps held pieces as real physics bodies (see robot/stowBay.ts). */
  readonly bays = new Map<number, { accept(i: number): void; forget(i: number): void }>();
  /** Held pieces that are real bodies inside a hopper (drawn from their body, like field pieces). */
  private readonly stowed: boolean[] = [];
  readonly state: PieceState[] = [];
  /** Robot id holding the piece, or -1. */
  readonly owner: number[] = [];
  /** Free-form tag set by season rules (e.g. which hub is processing it). */
  readonly tag: (string | null)[] = [];
  private readonly airborne: boolean[] = [];
  /** Pieces whose state/owner/tag changed since the last `takeChanges()` (multiplayer host). */
  private readonly changed = new Set<number>();
  /** Per piece: 1 = instance matrix shows its current field pose, 2 = shows it hidden, 0 = stale. */
  private shown = new Uint8Array(0);
  /** Multiplayer client: poses come from snapshots, so only pieces touched since the last draw are redrawn. */
  private replica = false;
  readonly mesh: THREE.InstancedMesh;
  readonly radius: number;
  readonly colliderRadius: number;
  readonly meshes: THREE.InstancedMesh[] = [];
  private readonly specs: GamePieceSpec[] = [];
  private readonly meshIndex: number[] = [];
  private readonly tmpM = new THREE.Matrix4();
  private readonly tmpQ = new THREE.Quaternion();
  private readonly tmpP = new THREE.Vector3();
  private readonly one = new THREE.Vector3(1, 1, 1);
  private readonly prevP = new THREE.Vector3();
  private readonly prevQ = new THREE.Quaternion();
  /** Pose of each moving piece before the latest physics step (x y z qx qy qz qw), for render interpolation. */
  private prevPose = new Float32Array(0);
  private prevOk = new Uint8Array(0);

  constructor(
    readonly physics: PhysicsWorld,
    scene: THREE.Scene,
    readonly frame: FieldFrame,
    readonly spec: GamePieceSpec,
  ) {
    const R = physics.R;
    this.radius = spec.radius;
    this.colliderRadius = spec.radius * (spec.colliderScale ?? 1);
    const types = [{ start: 0, spec }, ...(spec.variants ?? [])];
    for (const t of types) {
      const s = t.spec;
      const half = (s.length ?? s.radius * 2) / 2;
      const inner = s.innerRadius ?? s.radius * 0.8;
      const geo = s.shape === 'tube'
        ? new THREE.LatheGeometry([new THREE.Vector2(inner, -half), new THREE.Vector2(s.radius, -half), new THREE.Vector2(s.radius, half), new THREE.Vector2(inner, half), new THREE.Vector2(inner, -half)], 16).rotateZ(Math.PI / 2)
        : s.shape === 'ring'
          ? ringGeometry(s)
          : new THREE.SphereGeometry(s.radius, 14, 10);
      const striped = s.shape === 'ring' && (s.stripes ?? 0) > 0;
      const mesh = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ color: striped ? 0xffffff : s.color, vertexColors: striped, roughness: 0.65, side: THREE.DoubleSide }), spec.count);
      mesh.castShadow = mesh.receiveShadow = true;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false;
      for (let i = 0; i < spec.count; i++) mesh.setMatrixAt(i, HIDDEN);
      this.meshes.push(mesh);
      scene.add(mesh);
    }
    this.mesh = this.meshes[0];
    this.shown = new Uint8Array(spec.count);
    this.prevPose = new Float32Array(spec.count * 7);
    this.prevOk = new Uint8Array(spec.count);

    for (let i = 0; i < spec.count; i++) {
      const type = types.reduce((last, t, k) => i >= t.start ? k : last, 0);
      const piece = types[type].spec;
      this.specs.push(piece);
      this.meshIndex.push(type);
      const body = physics.world.createRigidBody(
        R.RigidBodyDesc.dynamic()
          .setTranslation(0, -10 - i * 0.2, 0)
          .setLinearDamping(piece.groundDamping ?? 0.5)
          .setAngularDamping(piece.angularDamping ?? 0.6)
          .setCcdEnabled(true)
          .setCanSleep(true)
          .setEnabled(false),
      );
      if (piece.shape === 'tube' && piece.hollow) {
        // Staves around the tube axis (body-local +X): a polygonal bore a pipe can pass through.
        const n = 10;
        const half = (piece.length ?? piece.radius * 2) / 2;
        const rIn = piece.colliderInnerRadius ?? piece.innerRadius ?? piece.radius * 0.8;
        const wall = Math.max(piece.radius - rIn, 0.004);
        const rMid = rIn + wall / 2;
        const chord = 2 * piece.radius * Math.tan(Math.PI / n);
        for (let k = 0; k < n; k++) {
          const a = (k / n) * Math.PI * 2;
          const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), a);
          const stave = R.ColliderDesc.cuboid(half, wall / 2, chord / 2)
            .setTranslation(0, rMid * Math.cos(a), rMid * Math.sin(a))
            .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
            .setMass(piece.mass / n)
            .setRestitution(piece.restitution)
            .setFriction(piece.friction)
            .setCollisionGroups(GROUPS.piece);
          physics.world.createCollider(stave, body);
        }
        this.bodies.push(body);
        this.state.push('reserve');
        this.stowed.push(false);
        this.owner.push(-1);
        this.tag.push(null);
        this.airborne.push(false);
        this.mesh.setMatrixAt(i, HIDDEN);
        continue;
      }
      const col = (piece.shape === 'tube'
        ? R.ColliderDesc.cylinder((piece.length ?? piece.radius * 2) / 2, piece.radius).setRotation({ x: 0, y: 0, z: Math.SQRT1_2, w: Math.SQRT1_2 })
        : piece.shape === 'ring'
          // Flat disc (world y = up); rounded edge so rings slide over each other instead of snagging.
          ? R.ColliderDesc.roundCylinder(ringHalfHeight(piece) * 0.5, piece.radius * (piece.colliderScale ?? 1) - ringHalfHeight(piece) * 0.5, ringHalfHeight(piece) * 0.5)
          : R.ColliderDesc.ball(piece.radius * (piece.colliderScale ?? 1)))
        .setMass(piece.mass)
        .setRestitution(piece.restitution)
        .setFriction(piece.friction)
        .setCollisionGroups(GROUPS.piece);
      physics.world.createCollider(col, body);
      this.bodies.push(body);
      this.state.push('reserve');
      this.stowed.push(false);
      this.owner.push(-1);
      this.tag.push(null);
      this.airborne.push(false);
      this.mesh.setMatrixAt(i, HIDDEN);
    }
  }

  get count(): number {
    return this.bodies.length;
  }

  specAt(i: number): GamePieceSpec { return this.specs[i]; }
  radiusAt(i: number): number { return this.specs[i].radius; }
  /** Height of a resting piece's center above the carpet (a ring lies flat). */
  restHeight(i: number): number { return restHeightOf(this.specs[i]); }
  /** Vertical half-extent of the collider (= radius for spheres, half the thickness for rings). */
  get colliderHalfHeight(): number { return this.spec.shape === 'ring' ? ringHalfHeight(this.spec) : this.colliderRadius; }

  /** Put piece i on the field at a WORLD position with optional WORLD velocity. */
  placeWorld(i: number, pos: THREE.Vector3, vel?: THREE.Vector3): void {
    this.leaveBay(i);
    const b = this.bodies[i];
    b.setEnabled(true);
    b.setTranslation({ x: pos.x, y: pos.y, z: pos.z }, true);
    b.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
    b.setLinvel(vel ? { x: vel.x, y: vel.y, z: vel.z } : { x: 0, y: 0, z: 0 }, true);
    b.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.state[i] = 'field';
    this.owner[i] = -1;
    this.tag[i] = null;
    this.shown[i] = 0;
    this.changed.add(i);
  }

  /** Put piece i on the field at a FIELD position (x, y, z-up), resting on the carpet if z omitted. */
  placeField(i: number, x: number, y: number, z?: number): void {
    this.placeWorld(i, this.frame.toWorld(x, y, z ?? this.restHeight(i) + 0.001, this.tmpP));
  }

  /**
   * Let piece i pass through robots (true) or collide with them again (false) — for a piece released from inside
   * a robot's mechanism (it starts overlapping that robot's collision box).
   */
  setIgnoreRobots(i: number, ignore: boolean): void {
    const b = this.bodies[i];
    const groups = ignore ? collisionGroups(Group.PIECE, Group.FIELD | Group.PIECE | Group.PIECE_ONLY) : GROUPS.piece;
    for (let k = 0; k < b.numColliders(); k++) b.collider(k).setCollisionGroups(groups);
  }

  /** Forget a piece's hopper: it is a normal collidable field piece again (position and velocity untouched). */
  private leaveBay(i: number): void {
    const owner = this.owner[i];
    if (owner >= 0) this.bays.get(owner)?.forget(i);
    if (!this.stowed[i]) return;
    this.stowed[i] = false;
    this.setGroups(i, GROUPS.piece);
    this.setColliderRadius(i, this.colliderRadius);
    this.setColliderMass(i, this.specs[i].mass);
    this.airborne[i] = false;
    this.bodies[i].setLinearDamping(this.specs[i].groundDamping ?? 0.5);
  }

  /** Held balls are a touch smaller than field balls (foam and net compress them): 40+ real-size FUEL fit a hopper rated for them. */
  static readonly STOWED_SCALE = 0.93;
  /**
   * Held balls weigh a tenth of a field ball to the chassis: a full hopper of real-mass balls sits high on the robot and
   * its sloshing would tip it over when it hits a pile or a wall (the rated robot mass already includes its load).
   */
  static readonly STOWED_MASS = 0.1;
  private setColliderMass(i: number, mass: number): void {
    const shape = this.specs[i].shape;
    if (shape === 'tube' || shape === 'ring') return;
    this.bodies[i].collider(0).setMass(mass);
  }

  private setColliderRadius(i: number, radius: number): void {
    const shape = this.specs[i].shape;
    if (shape === 'tube' || shape === 'ring') return;
    this.bodies[i].collider(0).setRadius(radius);
  }

  private setGroups(i: number, groups: number): void {
    const b = this.bodies[i];
    for (let k = 0; k < b.numColliders(); k++) b.collider(k).setCollisionGroups(groups);
  }

  /** Keep a held piece's body live inside a hopper with these collision groups (GROUPS.feeding / GROUPS.stowed). */
  setStowed(i: number, groups: number, scale = GamePiecePool.STOWED_SCALE): void {
    const b = this.bodies[i];
    if (!this.stowed[i]) {
      this.stowed[i] = true;
      b.setLinearDamping(0.35);
      this.setColliderRadius(i, this.colliderRadius * scale);
      this.setColliderMass(i, this.specs[i].mass * GamePiecePool.STOWED_MASS);
    }
    b.setEnabled(true);
    this.setGroups(i, groups);
    b.wakeUp();
    this.shown[i] = 0;
  }

  isStowed(i: number): boolean { return this.stowed[i]; }

  /** A piece that rolled out of a hopper becomes an ordinary field piece, exactly where it is and moving as it was. */
  releaseToField(i: number): void {
    this.leaveBay(i);
    this.state[i] = 'field';
    this.owner[i] = -1;
    this.tag[i] = null;
    this.shown[i] = 0;
    this.changed.add(i);
  }

  /** A held piece leaves its robot's physics hopper but stays held: back to a plain (disabled) held body. */
  parkHeld(i: number): void {
    this.leaveBay(i);
    this.bodies[i].setLinvel({ x: 0, y: 0, z: 0 }, false);
    this.bodies[i].setEnabled(false);
    this.shown[i] = 0;
  }

  hold(i: number, ownerId: number): void {
    const bay = this.bays.get(ownerId);
    if (bay) {
      this.state[i] = 'held';
      this.owner[i] = ownerId;
      this.shown[i] = 0;
      this.changed.add(i);
      bay.accept(i);
      return;
    }
    this.bodies[i].setEnabled(false);
    this.state[i] = 'held';
    this.owner[i] = ownerId;
    this.changed.add(i);
  }

  reserve(i: number, tag: string | null = null): void {
    this.leaveBay(i);
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
    this.replica = true;
    if (state !== this.state[i]) this.shown[i] = 0;
    this.state[i] = state;
    this.owner[i] = owner;
    this.tag[i] = tag;
  }

  setReplicaPosition(i: number, x: number, y: number, z: number): void {
    this.bodies[i].setTranslation({ x, y, z }, false);
    this.shown[i] = 0;
  }

  setReplicaRotation(i: number, x: number, y: number, z: number, w: number): void {
    this.bodies[i].setRotation({ x, y, z, w }, false);
    this.shown[i] = 0;
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
    for (let i = 0; i < this.bodies.length; i++) {
      if (this.state[i] !== 'field') continue;
      const b = this.bodies[i];
      if (b.isSleeping()) continue;
      const s = this.specs[i];
      const inAir = b.translation().y > restHeightOf(s) + 0.03;
      if (inAir !== this.airborne[i]) {
        this.airborne[i] = inAir;
        b.setLinearDamping(inAir ? (s.airDamping ?? 0.02) : (s.groundDamping ?? 0.5));
      }
    }
  }

  /** Before each physics step: remember where every moving piece is (sleeping pieces are drawn where they are). */
  capturePrevPoses(): void {
    const pp = this.prevPose;
    for (let i = 0; i < this.bodies.length; i++) {
      const b = this.bodies[i];
      if ((this.state[i] !== 'field' && !this.stowed[i]) || b.isSleeping()) { this.prevOk[i] = 0; continue; }
      const t = b.translation(), r = b.rotation(), k = i * 7;
      pp[k] = t.x; pp[k + 1] = t.y; pp[k + 2] = t.z; pp[k + 3] = r.x; pp[k + 4] = r.y; pp[k + 5] = r.z; pp[k + 6] = r.w;
      this.prevOk[i] = 1;
    }
  }

  /** `alpha`: how far the clock is between the previous physics step and the latest (1 = draw the latest). */
  syncVisuals(alpha = 1): void {
    let dirty = false;
    for (let i = 0; i < this.bodies.length; i++) {
      const mesh = this.meshes[this.meshIndex[i]];
      if (this.state[i] !== 'field' && !this.stowed[i]) {
        if (this.shown[i] !== 2) {
          mesh.setMatrixAt(i, HIDDEN);
          this.shown[i] = 2;
          dirty = true;
        }
        continue;
      }
      const b = this.bodies[i];
      // Multiplayer clients: poses only change through setReplicaPosition/Rotation, which mark the piece
      // stale — untouched pieces keep last frame's matrix. (The simulating side always reads the body: a
      // "sleeping" flag is not proof that a body hasn't moved.)
      if (this.replica && this.shown[i] === 1) continue;
      const t = b.translation();
      const r = b.rotation();
      this.tmpP.set(t.x, t.y, t.z);
      this.tmpQ.set(r.x, r.y, r.z, r.w);
      if (alpha < 1 && this.prevOk[i] && this.shown[i] === 1) {
        const pp = this.prevPose, k = i * 7;
        this.prevP.set(pp[k], pp[k + 1], pp[k + 2]);
        // A piece that jumped (launched from a robot, reset, handed off) is drawn where it is, not streaked.
        if (this.prevP.distanceToSquared(this.tmpP) < 0.25) {
          this.tmpP.lerpVectors(this.prevP, this.tmpP, alpha);
          this.tmpQ.slerpQuaternions(this.prevQ.set(pp[k + 3], pp[k + 4], pp[k + 5], pp[k + 6]), this.tmpQ, alpha);
        }
      }
      this.tmpM.compose(this.tmpP, this.tmpQ, this.one);
      mesh.setMatrixAt(i, this.tmpM);
      this.shown[i] = 1;
      dirty = true;
    }
    if (dirty) for (const mesh of this.meshes) mesh.instanceMatrix.needsUpdate = true;
  }
}
