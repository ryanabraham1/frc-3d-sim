import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { collisionGroups, Group } from '../physics/world';
import type { GamePiecePool } from '../gamepiece/pool';
import type { Robot } from './robot';
import type { HopperMechanism, MechRoller } from './models';
import { spawnClearance } from './spawnClearance';
import { clearFuelKeepouts, clearFuelOutline, clearHopperChamfer } from './fuelKeepouts';

/**
 * PHYSICAL HOPPER — the FUEL inside one robot, simulated in that robot's own frame.
 *
 * Each robot with mechanism hooks (`RobotModel.mech`) gets a small Rapier world whose origin rides the chassis. In it:
 * - Every visible mesh of the robot model (the CAD for CAD robots, the drawn parts for the others) is a trimesh
 *   collider, one kinematic body per scene-graph node, re-posed from the model every step. Walls are therefore static
 *   in this frame: a ball can't lag behind an accelerating chassis or be pushed through a panel by it. The intake
 *   folding in, a hopper sliding shut or a dye rotor turning move their colliders, and those push the balls.
 * - The chassis' motion enters as the fictitious forces of a non-inertial frame: gravity minus the chassis
 *   acceleration (uniform), plus centrifugal, Euler and Coriolis terms per ball. A hard stop sloshes the load.
 * - The carpet is a moving plane under the robot, so a ball lying in the intake mouth is dragged along the floor.
 * - Rollers (`mech.rollers`) are driven surfaces: a ball touching a running roller is gripped (compliant wheels) and
 *   pulled toward the roller's surface speed. Intake rollers run with the intake command, indexer/feeder rollers while
 *   the robot fires.
 * - Capture is by contact only: a field ball that touches a running intake roller moves into this world at the same
 *   pose and velocity and the rollers carry it in. Nothing is swallowed from a zone.
 * - Launch only at the shooter: while firing, a ball whose centre reaches the flywheel contact (`mech.shooter`) is the
 *   one that leaves; the robot's existing launch path gives it its shot velocity. The fire rate is whatever the
 *   mechanism delivers, capped at the configured rate.
 * - A ball that leaves the robot (over a rim, out of the intake mouth onto the carpet) becomes a field ball again with
 *   its current world velocity.
 *
 * Held balls stay pool pieces (state 'held', drawn by the pool from their body pose); their field bodies are disabled
 * and posed from this world after every step (`pose()`), so the simulation worker ships them like any other piece.
 */

const CELL = 0.006;          // vertex clustering for collider meshes (m): finer than a ball can feel
const SPIN_TELEPORT = 0.2;   // rad / step: faster rotations of undriven parts (flywheels, decorative wheels) are not imparted
const GRIP = 0.012;          // compliant roller tread: contact reach beyond the rigid radius (m)
const TRACTION = 0.45;       // fraction of the slip removed per step while touching a running roller
const WAKE_G = 0.6;          // change in apparent gravity (m/s²) that wakes a resting load
const MAX_ACCEL = 45;        // a single-step velocity jump beyond this (m/s²) is a teleport or a solver spike: ignored
const STOWED_SCALE = 0.95;   // foam FUEL compresses a little in a packed hopper

interface Part {
  node: THREE.Object3D;
  body: RAPIER.RigidBody;
  inverse: THREE.Matrix4;
  last: THREE.Matrix4;
  drive: boolean;
  /** A powered shaft: the drawn roller spins in place, so contact friction drives the ball at its surface speed. */
  roller?: Roller;
  /** Robot-frame axis point the shaft's collider is built about (at build time). */
  axisAt?: THREE.Vector3;
}

interface Roller extends MechRoller {
  radius: number;
  length: number;
  /** Robot-frame axis point / unit direction, refreshed each step. */
  c: THREE.Vector3;
  u: THREE.Vector3;
  /** Sign that makes `speed` right-handed about `u` (fixed at build). */
  sign: number;
  on: boolean;
  /**
   * true: the node is the shaft itself, drawn as a rigid roller that spins in place (a feeder floor). false: the roller
   * rides an arm and grips with a compliant tread that squashes the foam ball (intakes pinch FUEL between rollers).
   */
  spin: boolean;
}

export class MechHopper {
  static debug = false;
  readonly world: RAPIER.World;
  private readonly R: typeof RAPIER;
  private readonly mech: HopperMechanism;
  private parts: Part[] = [];
  private built = false;
  private carpet!: RAPIER.RigidBody;
  private readonly balls = new Map<number, RAPIER.RigidBody>();
  private readonly rollers: Roller[] = [];
  /** Balls that touched the flywheel while the robot was firing, nearest first. */
  private readonly atShooter: number[] = [];
  /** Body handle (field world) → pool index, for contact capture queries. */
  private handleToIndex: Map<number, number> | null = null;
  private incoming = -1;
  private readonly frozen = new Map<THREE.Object3D, THREE.Quaternion>();
  private readonly ignore = new Set<THREE.Object3D>();
  private readonly lastV = new THREE.Vector3();
  private readonly lastW = new THREE.Vector3();
  private hasLast = false;
  private readonly wakeG = new THREE.Vector3(0, -9.81, 0);
  private feedUntil = -1;
  private time = 0;
  private readonly radius: number;
  /** Robot-frame box a held ball may occupy; past it the ball is a field ball again. */
  private readonly envelope = new THREE.Box3();
  /** Diagnostics. */
  readonly stats = { captured: 0, launched: 0, released: 0, triangles: 0, parts: 0, buildMs: 0 };
  // scratch
  private readonly q = new THREE.Quaternion();
  private readonly qi = new THREE.Quaternion();
  /** Chassis rotation and its inverse (set by `chassis()`). */
  private readonly cq = new THREE.Quaternion();
  private readonly cqi = new THREE.Quaternion();
  private readonly t = new THREE.Vector3();
  private readonly m = new THREE.Matrix4();
  private readonly v1 = new THREE.Vector3();
  private readonly v2 = new THREE.Vector3();
  private readonly v3 = new THREE.Vector3();

  constructor(private readonly robot: Robot, private readonly pool: GamePiecePool, mech: HopperMechanism) {
    this.R = robot.physics.R;
    this.mech = mech;
    this.world = new this.R.World({ x: 0, y: -9.81, z: 0 });
    this.world.timestep = robot.physics.dt;
    this.world.integrationParameters.normalizedPredictionDistance = 0.01;
    this.radius = pool.colliderRadius * STOWED_SCALE;
    for (const o of mech.ignore ?? []) this.ignore.add(o);
    const c = robot.config, reach = Math.max(0.1, c.intake.reach ?? 0.3) + 0.2;
    this.envelope.set(
      new THREE.Vector3(-(c.frameLength / 2 + c.bumperThickness) - reach, -0.3, -(c.frameWidth / 2 + c.bumperThickness) - 0.12),
      new THREE.Vector3(c.frameLength / 2 + c.bumperThickness + reach, Math.max(c.height, c.hopperExpansion?.fullHeight ?? 0) + 0.45, c.frameWidth / 2 + c.bumperThickness + 0.12),
    );
    // A roller whose node is the spinning shaft itself (axis through the node's origin) is a rigid spinning collider; its
    // drawn spin is not a motion of the collider. Rollers placed off the node's origin ride a moving part (an intake arm).
    for (const r of mech.rollers) {
      const spin = !r.at || r.at.every(v => Math.abs(v) < 1e-6);
      this.rollers.push({ ...r, radius: r.radius ?? 0, length: r.length ?? 0, c: new THREE.Vector3(), u: new THREE.Vector3(), sign: 1, on: false, spin });
      if (spin) this.frozen.set(r.node, r.node.quaternion.clone());
    }
  }

  get count(): number { return this.balls.size; }
  /** Held balls in this hopper (pool indices). */
  indices(): IterableIterator<number> { return this.balls.keys(); }

  // ───────────────────────── geometry ─────────────────────────

  /** Robot-frame matrix of `o`, with declared rollers' own spin held at its build pose. */
  private rel(o: THREE.Object3D, out: THREE.Matrix4): THREE.Matrix4 {
    out.identity();
    const visual = this.robot.visual;
    for (let p: THREE.Object3D | null = o; p && p !== visual; p = p.parent) {
      this.m.compose(p.position, this.frozen.get(p) ?? p.quaternion, p.scale);
      out.premultiply(this.m);
    }
    return out;
  }

  private skipped(o: THREE.Object3D): boolean {
    for (let p: THREE.Object3D | null = o; p && p !== this.robot.visual; p = p.parent) {
      if (this.ignore.has(p) || p.userData.flowToken || p.userData.fuelNoContact || !p.visible) return true;
      if (p.name === 'stretching-hopper-net' || p.name === 'ground-intake-guide') return true;
    }
    return false;
  }

  private build(): void {
    const started = globalThis.performance?.now?.() ?? Date.now();
    this.built = true;
    const R = this.R, world = this.world, robot = this.robot;
    // Roller handedness: `speed` is defined right-handed about the axis as it points in the robot frame at build time.
    for (const r of this.rollers) {
      this.rollerFrame(r);
      r.sign = 1;
      if (!r.radius || !r.length) this.measureRoller(r);
    }
    const soft = this.rollers.filter(r => !r.spin);
    /** A drawn triangle of a compliant roller's tread: the roller's own soft contact replaces it. */
    const tread = (p: THREE.Vector3): boolean => soft.some(r => {
      const d = this.v1.copy(p).sub(r.c), along = d.dot(r.u);
      return Math.abs(along) <= r.length / 2 + 0.01 && d.addScaledVector(r.u, -along).length() <= r.radius + 0.006;
    });
    const groups = new Map<THREE.Object3D, THREE.Mesh[]>();
    robot.visual.traverse(o => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh || (mesh as THREE.InstancedMesh).isInstancedMesh || (mesh as unknown as THREE.LineSegments).isLineSegments) return;
      if (!mesh.geometry?.getAttribute('position') || this.skipped(mesh)) return;
      const node = mesh.parent ?? robot.visual;
      let list = groups.get(node);
      if (!list) groups.set(node, list = []);
      list.push(mesh);
    });
    const interest = this.envelope.clone();
    const relNode = new THREE.Matrix4(), relMesh = new THREE.Matrix4(), local = new THREE.Matrix4();
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), box = new THREE.Box3();
    const drive = new Set(this.mech.drive ?? []);
    for (const [node, meshes] of groups) {
      if (node === robot.visual) relNode.identity(); else this.rel(node, relNode);
      const cells = new Map<number, number>(), verts: number[] = [], tris: number[] = [];
      const vid = (p: THREE.Vector3): number => {
        const ix = Math.round(p.x / CELL) + 512, iy = Math.round(p.y / CELL) + 512, iz = Math.round(p.z / CELL) + 512;
        const key = ix + iy * 1024 + iz * 1048576;
        let id = cells.get(key);
        if (id === undefined) {
          id = verts.length / 3;
          verts.push((ix - 512) * CELL, (iy - 512) * CELL, (iz - 512) * CELL);
          cells.set(key, id);
        }
        return id;
      };
      for (const mesh of meshes) {
        local.compose(mesh.position, this.frozen.get(mesh) ?? mesh.quaternion, mesh.scale);
        relMesh.multiplyMatrices(relNode, local);
        const pos = mesh.geometry.getAttribute('position') as THREE.BufferAttribute, index = mesh.geometry.index;
        const n = index ? index.count : pos.count;
        for (let k = 0; k + 2 < n; k += 3) {
          const ia = index ? index.getX(k) : k, ib = index ? index.getX(k + 1) : k + 1, ic = index ? index.getX(k + 2) : k + 2;
          a.fromBufferAttribute(pos, ia).applyMatrix4(relMesh);
          b.fromBufferAttribute(pos, ib).applyMatrix4(relMesh);
          c.fromBufferAttribute(pos, ic).applyMatrix4(relMesh);
          box.makeEmpty().expandByPoint(a).expandByPoint(b).expandByPoint(c);
          if (!box.intersectsBox(interest)) continue;
          if (soft.length && tread(a) && tread(b) && tread(c)) continue;
          const A = vid(a), B = vid(b), C = vid(c);
          if (A === B || B === C || A === C) continue;
          tris.push(A, B, C);
        }
      }
      if (!tris.length) continue;
      const roller = this.rollers.find(r => r.spin && (r.node === node || isAncestor(r.node, node)));
      // A spinning shaft's collider is built about its own axis point, so the body turns in place.
      if (roller) for (let k = 0; k < verts.length; k += 3) { verts[k] -= roller.c.x; verts[k + 1] -= roller.c.y; verts[k + 2] -= roller.c.z; }
      const body = world.createRigidBody(roller ? R.RigidBodyDesc.kinematicVelocityBased() : R.RigidBodyDesc.kinematicPositionBased());
      // Powered surfaces (roller treads, a rotor's textured plate) grip; plain structure is smooth sheet and tube.
      const grips = !!roller || drive.has(node) || [...drive].some(d => isAncestor(d, node));
      const slick = (this.mech.slick ?? []).some(o => o === node || isAncestor(o, node));
      const desc = R.ColliderDesc.trimesh(new Float32Array(verts), new Uint32Array(tris))
        .setFriction(slick ? 0.02 : grips ? 1.2 : 0.35).setFrictionCombineRule(slick ? R.CoefficientCombineRule.Min : R.CoefficientCombineRule.Average).setRestitution(0.2).setCollisionGroups(collisionGroups(Group.STOW_WALL, Group.STOWED));
      world.createCollider(desc, body);
      this.stats.triangles += tris.length / 3;
      this.parts.push({ node, body, inverse: relNode.clone().invert(), last: relNode.clone(), drive: drive.has(node) || [...drive].some(d => isAncestor(d, node)), roller, axisAt: roller?.c.clone() });
    }
    this.stats.parts = this.parts.length;
    // The carpet: a plane that moves under the robot.
    this.carpet = world.createRigidBody(R.RigidBodyDesc.kinematicVelocityBased());
    world.createCollider(R.ColliderDesc.cuboid(2.5, 0.05, 2.5).setTranslation(0, -0.05, 0).setFriction(0.8).setRestitution(0.3)
      .setCollisionGroups(collisionGroups(Group.STOW_WALL, Group.STOWED)), this.carpet);
    // A stretching net can't stretch past full: there it is a hard lid (the net itself is drawn by the Robot).
    const net = this.mech.net;
    if (net) {
      const lid = world.createRigidBody(R.RigidBodyDesc.fixed()), g = collisionGroups(Group.STOW_WALL, Group.STOWED);
      const e = this.envelope;
      world.createCollider(R.ColliderDesc.cuboid((e.max.x - e.min.x) / 2, 0.05, (e.max.z - e.min.z) / 2)
        .setTranslation((e.max.x + e.min.x) / 2, net.full + 0.05, (e.max.z + e.min.z) / 2)
        .setFriction(0.3).setRestitution(0.1).setCollisionGroups(g), lid);
      // The net is tied along the rim: above the rigid walls its edges still close the hopper.
      if (net.area) {
        const [x0, z0] = net.area.min, [x1, z1] = net.area.max, h = (net.full - net.rim) / 2 + 0.03, y = (net.full + net.rim) / 2 - 0.03;
        const slab = (hx: number, hz: number, x: number, z: number) => world.createCollider(R.ColliderDesc.cuboid(hx, h, hz)
          .setTranslation(x, y, z).setFriction(0.3).setRestitution(0.1).setCollisionGroups(g), lid);
        slab(0.03, (z1 - z0) / 2 + 0.06, x0 - 0.03, (z0 + z1) / 2);
        slab(0.03, (z1 - z0) / 2 + 0.06, x1 + 0.03, (z0 + z1) / 2);
        slab((x1 - x0) / 2 + 0.06, 0.03, (x0 + x1) / 2, z0 - 0.03);
        slab((x1 - x0) / 2 + 0.06, 0.03, (x0 + x1) / 2, z1 + 0.03);
      }
    }
    this.syncCarpet();
    world.step(); // build the broad phase so the first placements can query the colliders
    this.stats.buildMs = (globalThis.performance?.now?.() ?? Date.now()) - started;
  }

  /** Tread radius and length of a drawn roller: its node's geometry within 4.5 cm of the axis. */
  private measureRoller(r: Roller): void {
    let radius = 0, lo = Infinity, hi = -Infinity;
    const p = new THREE.Vector3(), d = new THREE.Vector3(), rel = new THREE.Matrix4();
    r.node.traverse(o => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh || !mesh.visible || (mesh as THREE.InstancedMesh).isInstancedMesh) return;
      const pos = mesh.geometry.getAttribute('position') as THREE.BufferAttribute, index = mesh.geometry.index;
      if (!pos) return;
      this.rel(mesh, rel);
      const n = index ? index.count : pos.count;
      for (let k = 0; k < n; k++) {
        p.fromBufferAttribute(pos, index ? index.getX(k) : k).applyMatrix4(rel);
        d.copy(p).sub(r.c);
        const along = d.dot(r.u), radial = d.addScaledVector(r.u, -along).length();
        if (radial > 0.045) continue;
        radius = Math.max(radius, radial);
        lo = Math.min(lo, along); hi = Math.max(hi, along);
      }
    });
    if (!r.radius) r.radius = radius || 0.025;
    if (!r.length) {
      r.length = hi > lo ? hi - lo : 0.5;
      // Re-centre on the drawn tread.
      if (hi > lo) {
        const mid = (lo + hi) / 2, inv = this.rel(r.node, new THREE.Matrix4()).invert();
        const at = new THREE.Vector3(...(r.at ?? [0, 0, 0])).applyMatrix4(this.rel(r.node, new THREE.Matrix4())).addScaledVector(r.u, mid).applyMatrix4(inv);
        r.at = [at.x, at.y, at.z];
        this.rollerFrame(r);
      }
    }
  }

  private rollerFrame(r: Roller): void {
    this.rel(r.node, this.m2);
    const at = r.at ?? [0, 0, 0];
    r.c.set(at[0], at[1], at[2]).applyMatrix4(this.m2);
    r.u.set(r.axis === 'x' ? 1 : 0, r.axis === 'y' ? 1 : 0, r.axis === 'z' || !r.axis ? 1 : 0).transformDirection(this.m2);
  }
  private readonly m2 = new THREE.Matrix4();
  private readonly m3 = new THREE.Matrix4();

  /** Move every part's collider to where its node is drawn now. */
  private syncParts(): void {
    const p = this.v1, s = this.v2;
    let wakeDrive = false;
    for (const part of this.parts) {
      const now = this.rel(part.node, this.m3);
      if (part.roller) { this.spinPart(part, now); continue; }
      const e = now.elements, l = part.last.elements;
      let same = true;
      for (let k = 0; k < 16; k++) if (Math.abs(e[k] - l[k]) > 1e-7) { same = false; break; }
      if (same) { if (part.body.isMoving()) this.holdPose(part); continue; }
      this.m.multiplyMatrices(now, part.inverse).decompose(p, this.q, s);
      // A fast-spinning part that isn't a declared drive (flywheel, motor, gear) is re-posed without imparting velocity.
      const prevQ = this.qi.setFromRotationMatrix(this.m.multiplyMatrices(part.last, part.inverse));
      const spin = prevQ.angleTo(this.q);
      part.last.copy(now);
      if (spin <= SPIN_TELEPORT || part.drive) this.epoch++;
      // A turning drive (a dye rotor's floor) must keep the balls resting on it awake.
      if (part.drive) wakeDrive = true;
      if (spin > SPIN_TELEPORT && !part.drive) {
        part.body.setTranslation({ x: p.x, y: p.y, z: p.z }, false);
        part.body.setRotation({ x: this.q.x, y: this.q.y, z: this.q.z, w: this.q.w }, false);
      }
      part.body.setNextKinematicTranslation({ x: p.x, y: p.y, z: p.z });
      part.body.setNextKinematicRotation({ x: this.q.x, y: this.q.y, z: this.q.z, w: this.q.w });
    }
    if (wakeDrive) for (const b of this.balls.values()) if (b.isSleeping()) b.wakeUp();
  }

  /** A powered shaft: posed where it is drawn (spin removed), turning about its own axis at the roller's speed. */
  private spinPart(part: Part, now: THREE.Matrix4): void {
    const r = part.roller!, s = this.v2;
    this.m.multiplyMatrices(now, part.inverse).decompose(this.v1, this.q, s);
    part.body.setTranslation({ x: r.c.x, y: r.c.y, z: r.c.z }, false);
    part.body.setRotation({ x: this.q.x, y: this.q.y, z: this.q.z, w: this.q.w }, false);
    const w = this.v2.copy(r.u).multiplyScalar(r.on ? (r.speed * r.sign) / Math.max(0.005, r.radius) : 0);
    part.body.setLinvel({ x: 0, y: 0, z: 0 }, r.on);
    part.body.setAngvel({ x: w.x, y: w.y, z: w.z }, r.on);
  }

  private holdPose(part: Part): void {
    const t = part.body.translation(), r = part.body.rotation();
    part.body.setNextKinematicTranslation(t);
    part.body.setNextKinematicRotation(r);
  }

  /** The carpet plane in the robot frame, moving as the field moves past the chassis. */
  private syncCarpet(): void {
    const body = this.robot.body, t = body.translation(), r = body.rotation();
    const qi = new THREE.Quaternion(r.x, r.y, r.z, r.w).invert();
    const n = this.v1.set(0, 1, 0).applyQuaternion(qi);
    const p0 = this.v2.set(0, -t.y, 0).applyQuaternion(qi);
    const qc = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), n);
    this.carpet.setTranslation({ x: p0.x, y: p0.y, z: p0.z }, false);
    this.carpet.setRotation({ x: qc.x, y: qc.y, z: qc.z, w: qc.w }, false);
    const v = body.linvel(), w = body.angvel();
    const vl = this.v3.set(v.x, v.y, v.z).applyQuaternion(qi);
    const wl = new THREE.Vector3(w.x, w.y, w.z).applyQuaternion(qi);
    const vc = wl.clone().cross(p0).add(vl).negate();
    this.carpet.setLinvel({ x: vc.x, y: vc.y, z: vc.z }, false);
    this.carpet.setAngvel({ x: -wl.x, y: -wl.y, z: -wl.z }, false);
  }

  // ───────────────────────── frames ─────────────────────────

  private chassis(): void {
    const r = this.robot.body.rotation(), t = this.robot.body.translation();
    this.cq.set(r.x, r.y, r.z, r.w);
    this.cqi.copy(this.cq).invert();
    this.t.set(t.x, t.y, t.z);
  }
  private toLocal(p: { x: number; y: number; z: number }, out: THREE.Vector3): THREE.Vector3 {
    return out.set(p.x - this.t.x, p.y - this.t.y, p.z - this.t.z).applyQuaternion(this.cqi);
  }
  private toWorld(p: { x: number; y: number; z: number }, out: THREE.Vector3): THREE.Vector3 {
    return out.set(p.x, p.y, p.z).applyQuaternion(this.cq).add(this.t);
  }
  /** World velocity of a robot-frame point moving at `vRel` in the robot frame. */
  private worldVelocity(local: THREE.Vector3, vRel: { x: number; y: number; z: number }, out: THREE.Vector3): THREE.Vector3 {
    const v = this.robot.body.linvel(), w = this.robot.body.angvel();
    const arm = this.v3.copy(local).applyQuaternion(this.cq);
    out.set(vRel.x, vRel.y, vRel.z).applyQuaternion(this.cq);
    return out.add(new THREE.Vector3(w.x, w.y, w.z).cross(arm)).add(v as THREE.Vector3);
  }

  // ───────────────────────── pieces in / out ─────────────────────────

  private addBall(i: number, local: THREE.Vector3, vRel: THREE.Vector3): void {
    const spec = this.pool.specAt(i);
    const body = this.world.createRigidBody(this.R.RigidBodyDesc.dynamic()
      .setTranslation(local.x, local.y, local.z).setLinvel(vRel.x, vRel.y, vRel.z)
      .setLinearDamping(0.15).setAngularDamping(0.4).setCcdEnabled(true).setCanSleep(true));
    this.world.createCollider(this.R.ColliderDesc.ball(this.radius).setMass(spec.mass).setFriction(spec.friction ?? 0.6)
      .setRestitution(Math.min(0.35, spec.restitution ?? 0.3)).setCollisionGroups(collisionGroups(Group.STOWED, Group.STOWED | Group.STOW_WALL)), body);
    this.balls.set(i, body);
    // Held piece: drawn by the pool from its (disabled) field body, which follows this world.
    this.pool.carryHeld(i);
  }

  private removeBall(i: number): RAPIER.RigidBody | undefined {
    const body = this.balls.get(i);
    if (!body) return undefined;
    this.balls.delete(i);
    const k = this.atShooter.indexOf(i);
    if (k >= 0) this.atShooter.splice(k, 1);
    this.world.removeRigidBody(body);
    return body;
  }

  /** The pool handed this robot a piece: a preload / scripted load (a capture is added by `capture`). */
  accept(i: number): void {
    if (i === this.incoming || this.balls.has(i)) return;
    if (!this.built) this.build();
    this.addBall(i, this.freeSlot(), new THREE.Vector3());
  }

  /** The pool took the piece back (launched, reset, scored): forget it. */
  forget(i: number): void {
    this.removeBall(i);
  }

  /** Every held ball back to the reserve (robot reset). */
  clear(): void {
    for (const i of [...this.balls.keys()]) { this.removeBall(i); this.pool.reserve(i); }
  }

  /** Stop simulating: the balls stay held (a count again), drawn by the particle pile. */
  park(): void {
    for (const i of [...this.balls.keys()]) { this.removeBall(i); this.pool.parkHeld(i); }
  }

  dispose(): void {
    this.world.free();
  }

  /** Candidate spots (robot frame) that clear the drawn hopper, lowest first; rebuilt when a part has moved. */
  private slots: THREE.Vector3[] | null = null;
  private slotEpoch = -1;
  private epoch = 0;

  /**
   * A preload / scripted load goes in the lowest spot of the drawn FUEL bin that clears every collider and every other
   * ball (a 2.5 cm lattice tested against the actual model geometry). A hopper with no room left gets the spot with the
   * most clearance and the solver settles it.
   */
  private freeSlot(): THREE.Vector3 {
    const r = this.radius, d2 = (r * 2.01) ** 2;
    if (!this.slots || this.slotEpoch !== this.epoch) {
      this.slotEpoch = this.epoch;
      const cav = this.robot.fuelCavity();
      const min = cav?.min ?? new THREE.Vector3(-0.2, 0.15, -0.2), max = cav?.max ?? new THREE.Vector3(0.2, 0.5, 0.2);
      const top = Math.min(max.y, this.mech.net ? this.mech.net.full : max.y) - r;
      const shape = new this.R.Ball(r * 1.01), rot = { x: 0, y: 0, z: 0, w: 1 }, p = new THREE.Vector3();
      this.slots = [];
      const step = 0.025;
      for (let y = min.y - 0.05 + r; y <= top; y += step) for (let x = min.x + r; x <= max.x - r; x += step) for (let z = min.z + r; z <= max.z - r; z += step) {
        p.set(x, y, z);
        if (!this.robot.fuelPlacementFits(p, r)) continue;
        if (cav && (clearFuelKeepouts(p, r, cav.keepouts ?? [], cav) || clearHopperChamfer(p, r, cav.chamfer) || clearFuelOutline(p, r, cav.outline))) continue;
        let hit = false;
        this.world.intersectionsWithShape(p, rot, shape, () => { hit = true; return false; }, undefined, collisionGroups(Group.STOWED, Group.STOW_WALL));
        if (hit) continue;
        // Something must be under it within the hopper (a floor, a roller), or it is outside the drawn bin.
        const below = this.world.castShape(p, rot, { x: 0, y: -1, z: 0 }, shape, 0, 0.4, true, undefined, collisionGroups(Group.STOWED, Group.STOW_WALL), undefined, this.carpet);
        if (!below) continue;
        this.slots.push(p.clone());
      }
    }
    const held = [...this.balls.values()].map(b => b.translation());
    let best: THREE.Vector3 | null = null, bestGap = -Infinity;
    for (const p of this.slots) {
      let gap = Infinity;
      for (const h of held) gap = Math.min(gap, (h.x - p.x) ** 2 + (h.y - p.y) ** 2 + (h.z - p.z) ** 2);
      if (gap >= d2) return p.clone();
      if (gap > bestGap) { bestGap = gap; best = p; }
    }
    return best ? best.clone() : new THREE.Vector3(0, this.robot.config.height, 0);
  }

  /** Field balls touching a running capture roller come in, at the same pose and velocity. */
  private capture(): void {
    const robot = this.robot;
    if (!robot.enabled || !robot.lastCommand.intake || robot.intakeRoom <= 0) return;
    const field = robot.physics.world, R = this.R;
    if (!this.handleToIndex) {
      this.handleToIndex = new Map();
      this.pool.bodies.forEach((b, i) => this.handleToIndex!.set(b.handle, i));
    }
    const hits: number[] = [];
    for (const r of this.rollers) {
      if (!r.on || !r.capture) continue;
      const centre = this.toWorld(r.c, new THREE.Vector3());
      const dir = this.v1.copy(r.u).applyQuaternion(this.cq);
      const rot = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
      // A capsule grows a hemispherical tread beyond both shaft ends. Use the finite cylinder so a ball beside an
      // axle end cannot be captured before it actually touches the roller's compliant surface.
      const shape = new R.Cylinder(r.length / 2, r.radius + GRIP * 0.5);
      field.intersectionsWithShape(centre, rot, shape, c => {
        const parent = c.parent();
        const i = parent ? this.handleToIndex!.get(parent.handle) : undefined;
        if (i !== undefined && !hits.includes(i)) hits.push(i);
        return true;
      }, undefined, collisionGroups(Group.ALL, Group.PIECE));
    }
    for (const i of hits) {
      if (robot.intakeRoom <= 0) break;
      if (this.pool.state[i] !== 'field' || robot.justLaunched(i)) continue;
      const fb = this.pool.bodies[i], p = this.toLocal(fb.translation(), new THREE.Vector3());
      const v = fb.linvel(), w = robot.body.angvel(), bv = robot.body.linvel();
      // Relative velocity in the robot frame: v_rel = Rᵀ(v − v_chassis − ω × arm).
      const arm = new THREE.Vector3(fb.translation().x - this.t.x, fb.translation().y - this.t.y, fb.translation().z - this.t.z);
      const vr = new THREE.Vector3(v.x - bv.x, v.y - bv.y, v.z - bv.z).sub(new THREE.Vector3(w.x, w.y, w.z).cross(arm)).applyQuaternion(this.cqi);
      this.incoming = i;
      this.pool.hold(i, robot.id);
      this.incoming = -1;
      robot.held.push(i);
      this.addBall(i, p, vr);
      this.stats.captured++;
    }
  }

  /** A ball that has left the robot is a field ball again, where it is and moving as it is. */
  private release(i: number): void {
    const body = this.balls.get(i)!;
    if (MechHopper.debug) console.log('[mech] release', i, JSON.stringify(body.translation()), JSON.stringify(body.linvel()));
    const local = this.v2.copy(body.translation() as THREE.Vector3);
    const vRel = body.linvel();
    const pos = this.toWorld(local, new THREE.Vector3());
    const vel = this.worldVelocity(local, vRel, new THREE.Vector3());
    this.removeBall(i);
    const k = this.robot.held.lastIndexOf(i);
    if (k >= 0) this.robot.held.splice(k, 1);
    this.pool.placeWorld(i, pos, vel);
    this.pool.releaseGhost(i, () => spawnClearance(this.robot, this.pool.position(i), this.pool.colliderRadius, this.pool.colliderHalfHeight) > 0.02, 1);
    this.robot.noteLaunch(i);
    this.stats.released++;
  }

  // ───────────────────────── shooting ─────────────────────────

  /** The robot wants to fire this step (aimed and ready): run the indexer. */
  demandFeed(): void { this.feedUntil = this.time + 0.12; }
  get feeding(): boolean { return this.time < this.feedUntil; }

  /** The ball at the flywheel, taken out of this world, or -1 if none has reached it. */
  takeShot(): number {
    while (this.atShooter.length) {
      const i = this.atShooter.shift()!;
      if (!this.balls.has(i)) continue;
      this.removeBall(i);
      this.stats.launched++;
      return i;
    }
    return -1;
  }

  // ───────────────────────── step ─────────────────────────

  /** Once per physics step, before the field world steps (Robot.tick). */
  update(dt: number): void {
    if (!this.built) this.build();
    this.time += dt;
    this.chassis();
    const robot = this.robot;
    const intaking = robot.enabled && robot.lastCommand.intake && robot.intakeRoom > 0;
    const feeding = robot.enabled && this.feeding;
    for (const r of this.rollers) {
      r.on = r.run === 'both' ? intaking || feeding : r.run === 'intake' ? intaking : feeding;
      this.rollerFrame(r);
    }
    this.syncParts();
    this.syncCarpet();
    this.capture();
    if (this.balls.size) {
      this.fictitious(dt);
      this.drive();
      this.rotorDrive(dt);
      this.net(dt);
    }
    this.world.step();
    this.afterStep();
    this.pose();
  }

  /** Apparent gravity and the rotating-frame terms. */
  private fictitious(dt: number): void {
    const body = this.robot.body, v = body.linvel(), w = body.angvel();
    const vNow = new THREE.Vector3(v.x, v.y, v.z), wNow = new THREE.Vector3(w.x, w.y, w.z);
    const a = vNow.clone().sub(this.lastV).divideScalar(dt), alpha = wNow.clone().sub(this.lastW).divideScalar(dt);
    if (!this.hasLast || a.length() > MAX_ACCEL) a.set(0, 0, 0);
    if (!this.hasLast || alpha.length() > 4 * MAX_ACCEL) alpha.set(0, 0, 0);
    this.lastV.copy(vNow); this.lastW.copy(wNow); this.hasLast = true;
    const g = new THREE.Vector3(0, -9.81, 0).sub(a).applyQuaternion(this.cqi);
    this.world.gravity = { x: g.x, y: g.y, z: g.z };
    const wl = wNow.applyQuaternion(this.cqi), al = alpha.applyQuaternion(this.cqi);
    const spin = wl.lengthSq() * 0.35 + al.length() * 0.35;
    const wake = g.distanceTo(this.wakeG) > WAKE_G || spin > WAKE_G;
    if (wake) this.wakeG.copy(g);
    if (wl.lengthSq() < 0.04 && al.lengthSq() < 1 && !wake) return;
    const p = this.v1, dv = this.v2, tmp = this.v3, vel = new THREE.Vector3();
    for (const b of this.balls.values()) {
      if (wake) b.wakeUp();
      else if (b.isSleeping()) continue;
      const t = b.translation(), lv = b.linvel();
      p.set(t.x, t.y, t.z);
      // −ω×(ω×r) − α×r − 2ω×v
      dv.copy(wl).cross(tmp.copy(wl).cross(p)).negate();
      dv.sub(tmp.copy(al).cross(p));
      dv.sub(tmp.copy(wl).cross(vel.set(lv.x, lv.y, lv.z)).multiplyScalar(2));
      b.setLinvel({ x: lv.x + dv.x * dt, y: lv.y + dv.y * dt, z: lv.z + dv.z * dt }, false);
    }
  }

  /**
   * Compliant intake rollers (soft contact): the foam ball may squash into the tread by up to `GRIP`; a running roller
   * pinches it and pulls its surface toward the roller's surface speed, a stopped one holds it like a braked wheel.
   * (Rigid feeder shafts drive through ordinary contact friction instead: see spinPart.)
   */
  private drive(): void {
    const rb = this.radius, p = this.v1, n = this.v2, s = this.v3, vt = new THREE.Vector3();
    for (const r of this.rollers) {
      if (r.spin && !(r.grip && r.on)) continue;
      // A stopped tread is firm (the ball is only squashed while the roller pulls it through).
      const rest = r.spin || !r.on ? rb + r.radius : rb + r.radius - GRIP * 0.4, reach = rb + r.radius + (r.on ? GRIP : 0.004), half = r.length / 2;
      for (const b of this.balls.values()) {
        const t = b.translation();
        p.set(t.x - r.c.x, t.y - r.c.y, t.z - r.c.z);
        const along = p.dot(r.u);
        if (along < -half - rb * 0.3 || along > half + rb * 0.3) continue;
        n.copy(p).addScaledVector(r.u, -THREE.MathUtils.clamp(along, -half, half));
        const dist = n.length();
        if (dist > reach || dist < 1e-6) continue;
        // The compliant contact is also a braked wheel, but a settled ball needs no repeated wake-up impulse.
        if (!r.on && b.isSleeping() && dist >= rest - 0.002) continue;
        n.divideScalar(dist);
        // Surface velocity at the contact: speed · (u × n), right-handed about the axis.
        s.copy(r.u).cross(n).multiplyScalar(r.on ? r.speed * r.sign : 0);
        const lv = b.linvel();
        vt.set(lv.x, lv.y, lv.z);
        const vn = vt.dot(n);
        vt.addScaledVector(n, -vn);
        vt.lerp(s, r.on ? TRACTION : 0.25);
        // Normal: a spring out of the tread past its rest squash; a running roller also draws the ball onto it.
        const pen = rest - dist;
        const vnTarget = pen > 0 ? Math.min(r.on ? 2.5 : 4, pen * (r.on ? 60 : 150)) : r.on ? Math.max(-0.8, pen * 20) : Math.max(vn, 0);
        vt.addScaledVector(n, vn + (vnTarget - vn) * (r.on ? 0.6 : 0.9));
        b.setLinvel({ x: vt.x, y: vt.y, z: vt.z }, true);
      }
    }
  }

  private rotorLast: THREE.Quaternion | null = null;
  /**
   * Dye rotor as a driven surface: a ball resting on the turning plate is carried round with it (friction), and while
   * the robot feeds, the plate's spiral rib walks it inward to the throat like a screw conveyor.
   */
  private rotorDrive(dt: number): void {
    const rot = this.mech.rotor;
    if (!rot) return;
    const m = this.rel(rot.node, this.m2);
    const c = new THREE.Vector3().setFromMatrixPosition(m), q = new THREE.Quaternion().setFromRotationMatrix(m);
    const u = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
    let rate = 0;
    if (this.rotorLast) {
      const dq = this.rotorLast.clone().invert().premultiply(q);
      const angle = 2 * Math.acos(Math.min(1, Math.abs(dq.w)));
      const axis = new THREE.Vector3(dq.x, dq.y, dq.z);
      rate = (axis.dot(u) * Math.sign(dq.w) >= 0 ? 1 : -1) * angle / dt;
    }
    this.rotorLast = q;
    const feeding = this.robot.enabled && this.feeding, rb = this.radius;
    // A stationary plate already supports the load through its collider. Repeatedly setting resting velocities here
    // kept every ball awake indefinitely and prevented idle loads from settling.
    if (!feeding && Math.abs(rate) < 1e-5) return;
    let driven = 0;
    const p = new THREE.Vector3(), radial = new THREE.Vector3(), target = new THREE.Vector3(), v = new THREE.Vector3();
    for (const b of this.balls.values()) {
      const t = b.translation();
      p.set(t.x, t.y, t.z).sub(c);
      const h = p.dot(u);
      if (h < rot.top || h > rot.top + (rot.bladeHeight ?? 0) + rb + 0.012) continue;
      radial.copy(p).addScaledVector(u, -h);
      const r = radial.length();
      if (r > rot.radius) continue;
      target.copy(u).multiplyScalar(rate).cross(radial);
      if (feeding && r > 0.03) target.addScaledVector(radial, -rot.inward / r);
      const lv = b.linvel();
      v.set(lv.x, lv.y, lv.z);
      const vu = v.dot(u);
      v.addScaledVector(u, -vu).lerp(target, 0.3).addScaledVector(u, vu);
      b.setLinvel({ x: v.x, y: v.y, z: v.z }, true);
      driven++;
    }
    if (MechHopper.debug && Math.round(this.time / dt) % 90 === 0) console.log('[mech] rotor rate', rate.toFixed(2), 'driven', driven, 'c', c.toArray().map(x => x.toFixed(3)).join(), 'u', u.toArray().map(x => x.toFixed(2)).join());
  }

  /** A stretching net roof: soft above the slack rim, stiff past full stretch. Only moving balls feel it. */
  private net(dt: number): void {
    const net = this.mech.net;
    if (!net) return;
    const rb = this.radius;
    for (const b of this.balls.values()) {
      if (b.isSleeping()) continue;
      const t = b.translation();
      if (!net.inside(t.x, t.z)) continue;
      const over = t.y + rb - net.rim, past = t.y + rb - net.full;
      if (over <= 0) continue;
      const lv = b.linvel();
      let dv = -over * 45 * dt;
      if (past > 0) dv -= past * 900 * dt;
      if (lv.y > 0) dv -= lv.y * Math.min(1, 6 * dt);
      b.setLinvel({ x: lv.x, y: lv.y + dv, z: lv.z }, false);
    }
  }

  private afterStep(): void {
    const firing = this.robot.enabled && this.feeding;
    this.atShooter.length = 0;
    const out: number[] = [];
    const p = this.v1, c = this.v2, perim = this.perimeter();
    const shooters = this.shooterSegments();
    const near: { i: number; d: number }[] = [];
    for (const [i, b] of this.balls) {
      const t = b.translation();
      p.set(t.x, t.y, t.z);
      if (!this.envelope.containsPoint(p)) { out.push(i); continue; }
      // Lying on the carpet outside the bumpers, out of the intake's grip: no longer in the robot.
      if (Math.abs(p.x) > perim.x || Math.abs(p.z) > perim.z) {
        const ground = this.carpetHeight(p);
        if (p.y - ground < this.radius + 0.02 && !this.touchesRunningRoller(p)) { out.push(i); continue; }
      }
      if (firing) for (const sh of shooters) {
        if (sh.gate && !sh.gate(p.x, p.y, p.z)) continue;
        c.copy(p).sub(sh.at);
        const along = THREE.MathUtils.clamp(c.dot(sh.u), -sh.half, sh.half);
        const d = c.addScaledVector(sh.u, -along).length();
        if (d < sh.r) near.push({ i, d });
      }
    }
    for (const i of out) this.release(i);
    near.sort((x, y) => x.d - y.d);
    for (const n of near) this.atShooter.push(n.i);
  }

  private perimeter(): { x: number; z: number } {
    const c = this.robot.config;
    return { x: c.frameLength / 2 + c.bumperThickness, z: c.frameWidth / 2 + c.bumperThickness };
  }

  private carpetHeight(p: THREE.Vector3): number {
    const t = this.carpet.translation(), r = this.carpet.rotation();
    const n = new THREE.Vector3(0, 1, 0).applyQuaternion(new THREE.Quaternion(r.x, r.y, r.z, r.w));
    // Height of p above the plane, expressed as the plane's y under p (robot frame, nearly level).
    return p.y - (n.dot(new THREE.Vector3(p.x - t.x, p.y - t.y, p.z - t.z)) / Math.max(0.2, n.y));
  }

  private touchesRunningRoller(p: THREE.Vector3): boolean {
    for (const r of this.rollers) {
      if (!r.on) continue;
      const d = this.v3.copy(p).sub(r.c);
      const along = THREE.MathUtils.clamp(d.dot(r.u), -r.length / 2, r.length / 2);
      if (d.addScaledVector(r.u, -along).length() < this.radius + r.radius + GRIP) return true;
    }
    return false;
  }

  /** Pose the held balls' field bodies (drawn by the pool) from this world. Call after the chassis moved. */
  pose(): void {
    if (!this.balls.size) return;
    this.chassis();
    const w = this.v1, q = new THREE.Quaternion();
    for (const [i, b] of this.balls) {
      const t = b.translation(), r = b.rotation();
      this.toWorld(t, w);
      q.set(r.x, r.y, r.z, r.w).premultiply(this.cq);
      const fb = this.pool.bodies[i];
      fb.setTranslation({ x: w.x, y: w.y, z: w.z }, false);
      fb.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }, false);
    }
  }

  /** Robot-frame centres of the held balls (the net drapes over them). */
  forEachLocal(cb: (x: number, y: number, z: number) => void): void {
    for (const b of this.balls.values()) { const t = b.translation(); cb(t.x, t.y, t.z); }
  }

  /** Robot-frame position of held ball i (tests, diagnostics). */
  localOf(i: number): THREE.Vector3 | null {
    const b = this.balls.get(i);
    return b ? new THREE.Vector3().copy(b.translation() as THREE.Vector3) : null;
  }
  /** Robot-frame velocity of held ball i. */
  velocityOf(i: number): THREE.Vector3 | null {
    const b = this.balls.get(i);
    return b ? new THREE.Vector3().copy(b.linvel() as THREE.Vector3) : null;
  }
  get ballRadius(): number { return this.radius; }
  /** Tests: move held ball i to a robot-frame spot, at rest. */
  placeLocal(i: number, p: { x: number; y: number; z: number }): void {
    const b = this.balls.get(i);
    if (!b) return;
    b.setTranslation(p, true);
    b.setLinvel({ x: 0, y: 0, z: 0 }, true);
    b.setAngvel({ x: 0, y: 0, z: 0 }, true);
  }
  /** Diagnostics: what held ball i touches (part node names, 'ball', 'carpet'). */
  debugContacts(i: number): string[] {
    const b = this.balls.get(i);
    if (!b) return [];
    const out: string[] = [];
    this.world.contactPairsWith(b.collider(0), c => {
      let touching = false;
      let info = '';
      this.world.contactPair(b.collider(0), c, (m, flipped) => {
        for (let k = 0; k < m.numContacts(); k++) if (m.contactDist(k) < 0.002) { touching = true; const n = m.normal(); info = `n(${(flipped ? -1 : 1) * n.x | 0 ? '' : ''}${((flipped ? -1 : 1) * n.x).toFixed(2)},${((flipped ? -1 : 1) * n.y).toFixed(2)},${((flipped ? -1 : 1) * n.z).toFixed(2)})d${m.contactDist(k).toFixed(3)}`; }
      });
      if (!touching) return;
      const body = c.parent();
      const part = this.parts.find(p => p.body === body);
      out.push((part ? (part.node.name || `${part.node.parent?.name}/${part.node.type}`) : body === this.carpet ? 'carpet' : [...this.balls.values()].includes(body!) ? 'ball' : 'other') + info);
    });
    return out;
  }
  /** Diagnostics: every collider part, whether it drives FUEL, and its current velocities. */
  debugParts(): { name: string; drive: boolean; roller: boolean; lin: number; ang: number }[] {
    return this.parts.map(p => ({ name: p.node.name || p.node.parent?.name || p.node.type, drive: p.drive, roller: !!p.roller,
      lin: Math.hypot(p.body.linvel().x, p.body.linvel().y, p.body.linvel().z), ang: Math.hypot(p.body.angvel().x, p.body.angvel().y, p.body.angvel().z) }));
  }
  /** Robot-frame flywheel contact segments (current pose). */
  shooterSegments(): { at: THREE.Vector3; u: THREE.Vector3; half: number; r: number; gate?: (x: number, y: number, z: number) => boolean }[] {
    return this.mech.shooter.map(sh => {
      const m = this.rel(sh.node, new THREE.Matrix4());
      const u = new THREE.Vector3(sh.axis === 'x' ? 1 : 0, sh.axis === 'y' ? 1 : 0, sh.axis === 'z' ? 1 : 0);
      if (sh.axis) u.transformDirection(m);
      return { at: new THREE.Vector3(...sh.at).applyMatrix4(m), u, half: (sh.length ?? 0) / 2, r: sh.radius, gate: sh.gate };
    });
  }
  shooterPoints(): THREE.Vector3[] { return this.shooterSegments().map(s => s.at); }
  /** Robot-frame roller axes (current pose), for tests and debug drawing. */
  rollerAxes(): { c: THREE.Vector3; u: THREE.Vector3; radius: number; length: number; on: boolean; run: string }[] {
    return this.rollers.map(r => ({ c: r.c.clone(), u: r.u.clone(), radius: r.radius, length: r.length, on: r.on, run: r.run }));
  }
}

function isAncestor(a: THREE.Object3D, o: THREE.Object3D): boolean {
  for (let p: THREE.Object3D | null = o.parent; p; p = p.parent) if (p === a) return true;
  return false;
}
