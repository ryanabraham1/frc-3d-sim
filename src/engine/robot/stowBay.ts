import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { GROUPS } from '../physics/world';
import { GamePiecePool } from '../gamepiece/pool';
import type { Robot } from './robot';

/** Box (robot frame: x forward, y up, z right) a FUEL hopper holds its balls in. */
export interface Cavity { min: THREE.Vector3; max: THREE.Vector3; open: boolean }

const WALL = 0.05; // half-thickness of each wall slab (outside the cavity)
/** Intake roller pull speed (m/s) and the time after which a ball that never made it in is dropped straight inside. */
const PULL = 4.5;
const FEED_TIMEOUT = 1.2;

/**
 * Keeps a robot's held FUEL as the very same Rapier bodies that roll on the field (the pool's own pieces, drawn by the
 * pool's own mesh) instead of a separate particle pile.
 *
 * - Walls: a floor, four sides and (for a covered / netted hopper) a roof, attached to the chassis body in a group only
 *   held pieces touch. They follow the hopper's live bounds (deployed extensions, lifted roof), and the chassis' real
 *   acceleration, tilt and impacts move the pile through ordinary contacts.
 * - Intake: a captured ball is not hidden or animated. It keeps its position and is pulled toward the hopper mouth at
 *   roller speed (passing the wall, still bumping the balls already inside) until it is inside, then it is just a ball
 *   in a box. The count is therefore correct the instant a ball is captured.
 * - Overflow: an uncovered hopper has no roof, so a ball that rolls over a wall's top edge simply keeps being the same
 *   body; once past the wall it is released to the field with the velocity it already has. Nothing is spawned.
 * - Shooting: the ball closest to the launcher is the one that leaves.
 */
export class StowBay {
  /** Held pieces that are inside the cavity. */
  readonly stowed = new Set<number>();
  /** Balls held in this hopper: the live (simulated) ones plus the buried lower layers. */
  get count(): number { return this.stowed.size + this.buried.size; }
  /** Balls in the buried lower layers (not simulated). */
  get buriedCount(): number { return this.buried.size; }
  /**
   * Balls in the lower layers of a deep pile. They are not simulated: their bodies are switched off and ride the chassis
   * rigidly at the spot they settled in (robot frame), while the floor is raised under the balls that are still live.
   * Ball-to-ball contacts are the whole cost of a full hopper, and nothing below the top layers can move anyway.
   */
  private readonly buried = new Map<number, THREE.Vector3>();
  /** How far the floor slab is raised over the cavity floor to stand in for the buried layers (m). */
  private floorLift = 0;
  private lastCheck = 0;
  private lastVel = new THREE.Vector3();
  /** Simulated balls per hopper above which the deepest full layer is buried, and below which a layer is woken. */
  static ACTIVE_MAX = 26;
  static ACTIVE_MIN = 8;
  /** Balls being pulled in: elapsed time, the model's intake lane (robot frame) and the waypoint they are heading for. */
  private readonly feeding = new Map<number, { t: number; pts: THREE.Vector3[]; k: number }>();
  /** The model's own meshes in the hopper region as static trimesh colliders (re-posed when their node moves). */
  private cad: { mesh: THREE.Mesh; built: THREE.Matrix4; inverse: THREE.Matrix4; now: THREE.Matrix4; collider: RAPIER.Collider }[] | null = null;
  private tick = 0;
  private lastPos = new THREE.Vector3();
  private lastQuat = new THREE.Quaternion();
  private hasLast = false;
  /** Triangles across all model colliders: a CAD robot has hundreds of thousands, only those near the hopper are used. */
  static readonly TRIANGLE_BUDGET = 120000;
  static MAX_HULLS = 48;
  static MAX_PART = 0.32;
  trianglesInUse = 0;
  /** Diagnostics: balls released over the rim / out of the cavity, intake pulls that timed out. */
  readonly stats = { released: 0, timeouts: 0, captured: 0 };
  /** Experiment switches (benchmarks). */
  static useCad = true;
  private walls: RAPIER.Collider[] = [];
  private key = '';
  private cavity: Cavity | null = null;
  private readonly q = new THREE.Quaternion();
  private readonly qi = new THREE.Quaternion();
  private readonly v = new THREE.Vector3();
  private readonly w = new THREE.Vector3();

  constructor(private readonly robot: Robot, private readonly pool: GamePiecePool) {}

  private get radius(): number { return this.pool.colliderRadius; }

  private frame(): THREE.Vector3 {
    const t = this.robot.body.translation(), r = this.robot.body.rotation();
    this.q.set(r.x, r.y, r.z, r.w);
    this.qi.copy(this.q).invert();
    return this.w.set(t.x, t.y, t.z);
  }

  private toLocal(p: { x: number; y: number; z: number }, out: THREE.Vector3): THREE.Vector3 {
    const t = this.robot.body.translation();
    return out.set(p.x - t.x, p.y - t.y, p.z - t.z).applyQuaternion(this.qi);
  }

  private toWorld(local: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
    const t = this.robot.body.translation();
    return out.copy(local).applyQuaternion(this.q).add(t as unknown as THREE.Vector3);
  }

  /** A piece was handed to this robot (captured by the intake, or loaded as a preload). */
  accept(i: number): void {
    const body = this.pool.bodies[i];
    this.frame();
    if (!this.cavity) this.cavity = this.robot.fuelCavity();
    const cav = this.cavity;
    if (!cav) { this.pool.setStowed(i, GROUPS.stowed); this.stowed.add(i); return; }
    if (body.isEnabled()) {
      // Captured on the field: carry on from there, pulled in by the rollers.
      this.stats.captured++;
      const from = this.toLocal(body.translation(), new THREE.Vector3());
      const pts = [from, ...this.robot.intakePath(from)];
      this.feeding.set(i, { t: 0, pts, k: 1 });
      this.pool.setStowed(i, GROUPS.feeding);
    } else {
      this.dropIn(i, cav);
    }
  }

  /**
   * Preloads / scripted loads: close-pack the cavity (hexagonal layers, no overlaps) and let gravity settle it.
   * Slots past what fits continue upward, so an over-full load is simply a heap above the rim.
   */
  private dropIn(i: number, cav: Cavity): void {
    const rc = this.radius * GamePiecePool.STOWED_SCALE, d = rc * 2.01;
    const row = d * Math.sqrt(3) / 2, layerH = d * Math.sqrt(2 / 3);
    const w = cav.max.x - cav.min.x - 2 * rc, l = cav.max.z - cav.min.z - 2 * rc;
    const perRow = Math.max(1, Math.floor(w / d) + 1), rows = Math.max(1, Math.floor(l / row) + 1);
    const perLayer = perRow * rows;
    const slot = this.stowed.size;
    const layer = Math.floor(slot / perLayer), k = slot % perLayer;
    const j = Math.floor(k / perRow), c = k % perRow;
    // Alternate row/layer offsets (A-B-A stacking); shifts are trimmed so every ball stays inside the walls.
    const shiftX = (((j + layer) % 2) * 0.5) * d, shiftZ = (layer % 2) * row / 3;
    this.v.set(
      Math.min(cav.min.x + rc + c * d + shiftX, cav.max.x - rc),
      cav.min.y + this.floorLift + rc + layer * layerH,
      Math.min(cav.min.z + rc + j * row + shiftZ, cav.max.z - rc),
    );
    this.place(i, this.v);
    this.stowed.add(i);
    this.pool.setStowed(i, GROUPS.stowed);
  }

  private place(i: number, local: THREE.Vector3): void {
    const body = this.pool.bodies[i];
    this.frame();
    const world = this.toWorld(local, new THREE.Vector3());
    const lin = this.robot.body.linvel();
    body.setTranslation({ x: world.x, y: world.y, z: world.z }, true);
    body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
    body.setLinvel({ x: lin.x, y: lin.y, z: lin.z }, true);
    body.setAngvel({ x: 0, y: 0, z: 0 }, true);
  }

  forget(i: number): void {
    this.stowed.delete(i);
    this.feeding.delete(i);
    if (this.buried.delete(i) && !this.buried.size) this.floorLift = 0;
  }

  /** Release every held ball back to the reserve (robot reset). */
  clear(): void {
    for (const i of [...this.stowed, ...this.buried.keys(), ...this.feeding.keys()]) this.pool.reserve(i);
    this.stowed.clear();
    this.buried.clear();
    this.floorLift = 0;
    this.feeding.clear();
  }

  /**
   * Bury the lowest full layer(s) of a deep pile, or wake the top buried layer when the live pile has been used up.
   * Called every few steps, never while the chassis is being thrown around.
   */
  private rebalance(): void {
    const r = this.radius * GamePiecePool.STOWED_SCALE;
    this.frame();
    if (this.stowed.size > StowBay.ACTIVE_MAX + 6) {
      const rows = [...this.stowed].map(i => ({ i, y: this.toLocal(this.pool.bodies[i].translation(), this.v).y })).sort((a, b) => a.y - b.y);
      const need = this.stowed.size - StowBay.ACTIVE_MAX;
      // Cut at a layer boundary: everything within half a ball of the n-th lowest goes, so no half-buried layer is left.
      const cut = rows[need - 1].y + r * 0.5;
      const gone = rows.filter(row => row.y <= cut);
      if (this.stowed.size - gone.length < StowBay.ACTIVE_MIN + 4) return;
      for (const { i } of gone) {
        const body = this.pool.bodies[i];
        this.buried.set(i, this.toLocal(body.translation(), new THREE.Vector3()));
        this.stowed.delete(i);
        body.setLinvel({ x: 0, y: 0, z: 0 }, false);
        body.setEnabled(false);
      }
      this.floorLift = Math.max(this.floorLift, this.buriedTop() + r * 0.7 - (this.cavity?.min.y ?? 0));
    } else if (this.stowed.size < StowBay.ACTIVE_MIN && this.buried.size) {
      this.wakeLayer();
    }
  }

  /** Local height of the highest buried ball centre. */
  private buriedTop(): number {
    let top = -Infinity;
    for (const l of this.buried.values()) top = Math.max(top, l.y);
    return top;
  }

  /** Switch the top buried layer back on, where it is, and lower the floor under it. */
  private wakeLayer(all = false): void {
    if (!this.buried.size) return;
    const r = this.radius * GamePiecePool.STOWED_SCALE;
    const top = this.buriedTop(), lin = this.robot.body.linvel();
    this.frame();
    for (const [i, local] of [...this.buried]) {
      if (!all && local.y < top - r * 0.5) continue;
      this.buried.delete(i);
      const world = this.toWorld(local, this.v), body = this.pool.bodies[i];
      body.setEnabled(true);
      body.setTranslation({ x: world.x, y: world.y, z: world.z }, true);
      body.setLinvel({ x: lin.x, y: lin.y, z: lin.z }, true);
      body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      this.stowed.add(i);
    }
    this.floorLift = this.buried.size ? this.buriedTop() + r * 0.7 - (this.cavity?.min.y ?? 0) : 0;
  }

  /** The buried layers move with the chassis exactly (their bodies are off, so nothing else moves them). */
  private carryBuried(): void {
    if (!this.buried.size) return;
    this.frame();
    for (const [i, local] of this.buried) {
      const w = this.toWorld(local, this.v);
      this.pool.bodies[i].setTranslation({ x: w.x, y: w.y, z: w.z }, false);
    }
  }

  /** Robot-frame positions of the balls in the hopper (the net drapes over them). */
  forEachLocal(cb: (x: number, y: number, z: number) => void): void {
    for (const l of this.buried.values()) cb(l.x, l.y, l.z);
    if (!this.stowed.size) return;
    this.frame();
    const p = new THREE.Vector3();
    for (const i of this.stowed) {
      this.toLocal(this.pool.bodies[i].translation(), p);
      cb(p.x, p.y, p.z);
    }
  }

  /** The ball nearest the launcher exit (robot frame): the one that gets shot. -1 when none is inside. */
  pickForLaunch(exit: THREE.Vector3): number {
    if (!this.stowed.size && this.buried.size) this.wakeLayer(true);
    this.frame();
    let best = -1, d = Infinity;
    const p = new THREE.Vector3();
    for (const i of this.stowed) {
      this.toLocal(this.pool.bodies[i].translation(), p);
      const dist = p.distanceToSquared(exit);
      if (dist < d) { d = dist; best = i; }
    }
    return best;
  }

  /**
   * The chassis was moved without stepping the world (respawn, scripted placement, kinematic climb jump): carry every held
   * ball with it, at the same spot in the hopper, so none is left behind to be mistaken for a spill.
   */
  private carryTeleport(): void {
    const t = this.robot.body.translation(), r = this.robot.body.rotation();
    const pos = new THREE.Vector3(t.x, t.y, t.z), quat = new THREE.Quaternion(r.x, r.y, r.z, r.w);
    if (this.hasLast && (pos.distanceTo(this.lastPos) > 0.3 || this.lastQuat.angleTo(quat) > 0.6) && (this.stowed.size || this.feeding.size)) {
      const inv = this.lastQuat.clone().invert(), p = new THREE.Vector3(), lin = this.robot.body.linvel();
      for (const i of [...this.stowed, ...this.feeding.keys()]) {
        const body = this.pool.bodies[i], b = body.translation();
        p.set(b.x - this.lastPos.x, b.y - this.lastPos.y, b.z - this.lastPos.z).applyQuaternion(inv).applyQuaternion(quat).add(pos);
        body.setTranslation({ x: p.x, y: p.y, z: p.z }, true);
        body.setLinvel({ x: lin.x, y: lin.y, z: lin.z }, true);
        body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      }
    }
    this.lastPos.copy(pos); this.lastQuat.copy(quat); this.hasLast = true;
  }

  /** Once per physics step, before the world steps. */
  update(dt: number): void {
    this.carryTeleport();
    const cav = this.robot.fuelCavity();
    if (!cav) return;
    this.cavity = cav;
    this.syncWalls(cav);
    this.syncCad(cav);
    this.carryBuried();
    if (++this.lastCheck >= 10) {
      this.lastCheck = 0;
      // Rebalance only while the chassis is calm: a hit or a hard turn should slosh the whole pile.
      const v = this.robot.body.linvel(), calm = Math.hypot(v.x - this.lastVel.x, v.z - this.lastVel.z) < 0.5;
      this.lastVel.set(v.x, v.y, v.z);
      if (calm || !this.buried.size) this.rebalance();
    }
    if (!this.stowed.size && !this.feeding.size) return;
    this.frame();
    const r = this.radius, p = new THREE.Vector3(), target = new THREE.Vector3(), vel = new THREE.Vector3();
    // Balls being pulled in by the intake rollers along the model's own intake lane.
    for (const [i, f] of this.feeding) {
      const body = this.pool.bodies[i];
      this.toLocal(body.translation(), p);
      const inside = p.x > cav.min.x + r * 0.6 && p.x < cav.max.x - r * 0.6 && Math.abs(p.z - (cav.min.z + cav.max.z) / 2) < (cav.max.z - cav.min.z) / 2 - r * 0.6
        && p.y > cav.min.y && p.y < cav.max.y + (cav.open ? 3 * r : 0) && f.k >= f.pts.length - 1;
      if (inside) {
        this.feeding.delete(i);
        this.stowed.add(i);
        this.pool.setStowed(i, GROUPS.stowed);
        continue;
      }
      if (f.t > FEED_TIMEOUT) {
        this.stats.timeouts++;
        this.feeding.delete(i);
        this.dropIn(i, cav);
        continue;
      }
      f.t += dt;
      while (f.k < f.pts.length - 1 && p.distanceTo(f.pts[f.k]) < r * 1.3) f.k++;
      target.copy(f.pts[Math.min(f.k, f.pts.length - 1)]);
      if (f.pts.length < 2) this.mouth(cav, p, target);
      vel.copy(target).sub(p);
      const dist = vel.length();
      vel.multiplyScalar(dist > 1e-6 ? Math.min(PULL, dist / Math.max(dt, 1e-3)) / dist : 0).applyQuaternion(this.q);
      const lin = this.robot.body.linvel();
      body.setLinvel({ x: lin.x + vel.x, y: lin.y + vel.y + 9.81 * dt, z: lin.z + vel.z }, true);
    }
    // A ball that is over a wall's top edge (open hopper) is an ordinary field ball again. A ball that is merely outside
    // the walls below the rim was left there by a wall that moved in (retracting extension, lowered roof): it is pushed
    // back inside, never dropped.
    this.contain(cav, p, r);
  }

  /** Called once per rendered frame, after the physics steps: undo any pop through a wall before it is drawn. */
  settle(): void {
    if (this.cavity && this.stowed.size) { this.frame(); this.contain(this.cavity, new THREE.Vector3(), this.radius); }
  }

  private contain(cav: Cavity, p: THREE.Vector3, r: number): void {
    const cx = (cav.min.x + cav.max.x) / 2, cz = (cav.min.z + cav.max.z) / 2;
    const hx = (cav.max.x - cav.min.x) / 2 - r, hz = (cav.max.z - cav.min.z) / 2 - r;
    for (const i of [...this.stowed]) {
      const body = this.pool.bodies[i];
      this.toLocal(body.translation(), p);
      const outX = Math.abs(p.x - cx) > hx + r * 1.05, outZ = Math.abs(p.z - cz) > hz + r * 1.05;
      const floor = cav.min.y + this.floorLift, outY = p.y < floor - 0.02 || p.y > cav.max.y + (cav.open ? 0.6 : 0.02);
      if (!outX && !outZ && !outY) continue;
      if (cav.open && (outX || outZ) && p.y > cav.max.y - r * 0.5) {
        this.stats.released++;
        this.stowed.delete(i);
        const held = this.robot.held.lastIndexOf(i);
        if (held >= 0) this.robot.held.splice(held, 1);
        this.pool.releaseToField(i);
        this.robot.noteLaunch(i);
        continue;
      }
      p.set(cx + THREE.MathUtils.clamp(p.x - cx, -hx, hx), THREE.MathUtils.clamp(p.y, floor + r, Math.max(floor + r, cav.max.y - r)), cz + THREE.MathUtils.clamp(p.z - cz, -hz, hz));
      const lin = this.robot.body.linvel();
      this.toWorld(p, this.v);
      body.setTranslation({ x: this.v.x, y: this.v.y, z: this.v.z }, true);
      body.setLinvel({ x: lin.x, y: lin.y, z: lin.z }, true);
    }
  }

  /** Where the intake delivers a ball: just inside the mouth, resting on top of whatever is already there. */
  private mouth(cav: Cavity, from: THREE.Vector3, out: THREE.Vector3): void {
    const r = this.radius, side = this.robot.fuelIntakeSide();
    const x = side > 0 ? cav.max.x - r * 1.4 : cav.min.x + r * 1.4;
    const zHalf = (cav.max.z - cav.min.z) / 2 - r * 1.2, zc = (cav.min.z + cav.max.z) / 2;
    const z = THREE.MathUtils.clamp(from.z, zc - zHalf, zc + zHalf);
    let y = cav.min.y + this.floorLift + r * 1.2;
    const p = new THREE.Vector3();
    for (const i of this.stowed) {
      this.toLocal(this.pool.bodies[i].translation(), p);
      if (Math.hypot(p.x - x, p.z - z) < r * 2) y = Math.max(y, p.y + r * 1.6);
    }
    out.set(x, Math.min(y, cav.max.y + (cav.open ? r : -r)), z);
  }

  /**
   * Static trimesh colliders from the robot model's visible meshes that reach the hopper region (CAD rails, plates,
   * feeders, shooter, and the recreated models' panels). Held balls collide with exactly the geometry that is drawn.
   */
  private buildCad(cav: Cavity): void {
    this.cad = [];
    const robot = this.robot, visual = robot.visual, R = robot.physics.R, world = robot.physics.world;
    visual.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(visual.matrixWorld).invert();
    const zone = new THREE.Box3(cav.min.clone().subScalar(0.1), cav.max.clone().addScalar(0.1));
    const candidates: { mesh: THREE.Mesh; rel: THREE.Matrix4; d: number; tris: number }[] = [];
    visual.traverseVisible(o => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh || (mesh as THREE.InstancedMesh).isInstancedMesh || mesh.userData.flowToken || mesh.userData.fuelNoContact) return;
      const g = mesh.geometry, pos = g.getAttribute('position');
      if (!pos) return;
      for (let q: THREE.Object3D | null = mesh; q && q !== visual; q = q.parent) if (q.userData.flowToken || q.userData.fuelNoContact) return;
      g.computeBoundingBox();
      const rel = new THREE.Matrix4().multiplyMatrices(inv, mesh.matrixWorld);
      const bounds = g.boundingBox!.clone().applyMatrix4(rel);
      if (!bounds.intersectsBox(zone)) return;
      candidates.push({ mesh, rel, d: bounds.getCenter(new THREE.Vector3()).distanceTo(zone.getCenter(new THREE.Vector3())), tris: g.index ? g.index.count / 3 : pos.count / 3 });
    });
    candidates.sort((a, b) => a.d - b.d);
    // Convex hulls of the compact parts only (pillars, rollers, brackets, shooter pods): a hull costs a few contact tests,
    // a CAD trimesh costs thousands. Large panels are covered by the cavity walls. Hollow shapes never get a hull.
    let count = 0;
    const v = new THREE.Vector3(), size = new THREE.Vector3();
    for (const c of candidates) {
      if (count >= StowBay.MAX_HULLS) break;
      const g = c.mesh.geometry, pos = g.getAttribute('position');
      g.boundingBox!.clone().applyMatrix4(c.rel).getSize(size);
      if (Math.max(size.x, size.y, size.z) > StowBay.MAX_PART || Math.min(size.x, size.y, size.z) < 0.012) continue;
      const stride = Math.max(1, Math.floor(pos.count / 160));
      const points: number[] = [];
      for (let k = 0; k < pos.count; k += stride) { v.fromBufferAttribute(pos, k).applyMatrix4(c.rel); points.push(v.x, v.y, v.z); }
      const desc = R.ColliderDesc.convexHull(new Float32Array(points));
      if (!desc) continue;
      const collider = world.createCollider(desc.setMass(0).setFriction(0.45).setRestitution(0.15).setCollisionGroups(GROUPS.stowWall), robot.body);
      this.cad.push({ mesh: c.mesh, built: c.rel.clone(), inverse: c.rel.clone().invert(), now: c.rel.clone(), collider });
      count++;
    }
    const budget = StowBay.TRIANGLE_BUDGET - count;
    this.trianglesInUse = StowBay.TRIANGLE_BUDGET - budget;
  }

  /** Re-pose model colliders whose node moved (deployed intake, lifted frame, turret). */
  private syncCad(cav: Cavity): void {
    if (!StowBay.useCad) return;
    if (!this.cad) { this.buildCad(cav); return; }
    if (++this.tick % 3) return;
    const delta = new THREE.Matrix4(), pos = new THREE.Vector3(), quat = new THREE.Quaternion(), scale = new THREE.Vector3();
    for (const c of this.cad) {
      const m = this.relative(c.mesh);
      if (!m.elements.some((e, k) => Math.abs(e - c.now.elements[k]) > 1e-5)) continue;
      c.now.copy(m);
      delta.multiplyMatrices(m, c.inverse).decompose(pos, quat, scale);
      c.collider.setTranslationWrtParent({ x: pos.x, y: pos.y, z: pos.z });
      c.collider.setRotationWrtParent({ x: quat.x, y: quat.y, z: quat.z, w: quat.w });
    }
  }

  private relative(o: THREE.Object3D): THREE.Matrix4 {
    const m = o.matrix.clone();
    for (let p = o.parent; p && p !== this.robot.visual; p = p.parent) m.premultiply(p.matrix);
    return m;
  }

  /** Floor, sides and roof follow the live hopper bounds. */
  private syncWalls(cav: Cavity): void {
    const key = [cav.min.x, cav.min.y, cav.min.z, cav.max.x, cav.max.y, cav.max.z, cav.open ? 1 : 0, this.floorLift].map(n => n.toFixed(4)).join(',');
    if (key === this.key) return;
    this.key = key;
    const R = this.robot.physics.R, world = this.robot.physics.world;
    const sx = (cav.max.x - cav.min.x) / 2, sy = (cav.max.y - cav.min.y) / 2, sz = (cav.max.z - cav.min.z) / 2;
    const cx = (cav.min.x + cav.max.x) / 2, cy = (cav.min.y + cav.max.y) / 2, cz = (cav.min.z + cav.max.z) / 2;
    // Side slabs span from just under the floor up to the rim, so an open hopper's wall top is exactly cav.max.y.
    const wy = sy + WALL / 2, wcy = cy - WALL / 2;
    const slabs = [
      { h: [sx + WALL, WALL / 2, sz + WALL], at: [cx, cav.min.y + this.floorLift - WALL / 2, cz] },
      { h: [WALL / 2, wy, sz + WALL], at: [cav.min.x - WALL / 2, wcy, cz] },
      { h: [WALL / 2, wy, sz + WALL], at: [cav.max.x + WALL / 2, wcy, cz] },
      { h: [sx + WALL, wy, WALL / 2], at: [cx, wcy, cav.min.z - WALL / 2] },
      { h: [sx + WALL, wy, WALL / 2], at: [cx, wcy, cav.max.z + WALL / 2] },
      { h: [sx + WALL, WALL / 2, sz + WALL], at: [cx, cav.max.y + WALL / 2, cz] },
    ];
    slabs.forEach((s, k) => {
      let collider = this.walls[k];
      if (!collider) {
        collider = world.createCollider(R.ColliderDesc.cuboid(s.h[0], s.h[1], s.h[2]).setMass(0).setFriction(0.5).setRestitution(0.12).setCollisionGroups(GROUPS.stowWall), this.robot.body);
        this.walls[k] = collider;
      }
      collider.setShape(new R.Cuboid(s.h[0], s.h[1], s.h[2]));
      collider.setTranslationWrtParent({ x: s.at[0], y: s.at[1], z: s.at[2] });
      collider.setEnabled(k !== 5 || !cav.open);
    });
  }
}
