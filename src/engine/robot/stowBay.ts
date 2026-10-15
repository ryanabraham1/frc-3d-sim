import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { GROUPS } from '../physics/world';
import { GamePiecePool } from '../gamepiece/pool';
import type { Robot } from './robot';
import { clearFuelOutline, clearFuelKeepouts, clearHopperChamfer, type HopperChamfer, type FuelKeepout } from './fuelKeepouts';

/** Box (robot frame: x forward, y up, z right) a FUEL hopper holds its balls in. */
export interface Cavity { min: THREE.Vector3; max: THREE.Vector3; open: boolean; keepouts?: readonly FuelKeepout[]; chamfer?:HopperChamfer; outline?:readonly [number,number][] }

const WALL = 0.08; // thickness of each wall slab (outside the cavity): thick, so a sloshing load can't punch through a step
/** Damping (1/s) of a held ball's horizontal motion relative to the chassis. */
const RELATIVE_DAMPING = 0.6;
/** Most a held ball is moved out of a mechanism envelope in one step (m). */
const KEEPOUT_STEP = 0.04;
/** How far a held ball may sink into a hopper face before it is put back on it (m). */
const SKIN = 0.004;
/** Intake roller pull speed (m/s) and the time after which a ball that never made it in is dropped straight inside. */
const PULL = 4.5;
const FEED_TIMEOUT = 1.2;
/** Surface speed of a driven hopper floor (roller floor / indexer belts) carrying FUEL to the indexer (m/s) [EST]. */
const FLOOR_SPEED = 1.2;
/** Rim speed of a dye rotor / spindexer floor (m/s) [EST: a ~0.3 m plate at ~150 rpm]. */
const ROTOR_SPEED = 6;
/** Rim speed of a dye rotor turning slowly backwards while idle to agitate the load (m/s) [EST]. */
const AGITATE_SPEED = 0.5;
/** How long one "wants to fire" keeps the floor rollers running (s): covers the gaps between shots. */
const FEED_HOLD = 0.25;
/** Compliant intake tread: how far past the rigid roller a ball is still gripped (m). */
const GRIP = 0.015;
/** A ball the intake has let go of that is not in the hopper by then is a field ball again (s). */
const LOOSE_AFTER = 0.25;

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
 * - Shooting: the indexer takes a ball at its entry first, otherwise draws the nearest held ball directly from the
 *   hopper. The driven floor still moves the pile, but no intake folding or agitation policy is needed to empty it.
 */
export class StowBay {
  /** Held pieces that are inside the cavity. */
  readonly stowed = new Set<number>();
  /** Balls held in this hopper: the live (simulated) ones plus the buried lower layers. */
  get count(): number { return this.stowed.size + this.buried.size; }
  /** Any ball in this hopper at all, including ones still on their way in from the intake. */
  get occupied(): boolean { return this.count + this.feeding.size > 0; }
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
  /** When the chassis was last jolted or turning (see update). */
  private calmSince = 0;
  private lastVel = new THREE.Vector3();
  /** Simulated balls per hopper above which the deepest full layer is buried, and below which a layer is woken. */
  static ACTIVE_MAX = 26;
  static ACTIVE_MIN = 8;
  /** Balls being pulled in: elapsed time, the model's intake lane (robot frame) and the waypoint they are heading for. */
  private readonly feeding = new Map<number, { t: number; pts: THREE.Vector3[]; k: number; loose: number }>();
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

  private time = 0;
  private feedUntil = -1;
  /** The robot wants to fire: run the floor rollers toward the indexer for a moment. */
  demandFeed(): void { this.feedUntil = this.time + FEED_HOLD; }
  get feedingIndexer(): boolean { return this.time < this.feedUntil; }

  /** Indexer entry (robot frame): the model's feed path start, else just over the floor at the launcher end of the hopper. */
  private entry(cav: Cavity, out: THREE.Vector3): THREE.Vector3 {
    const e = this.robot.feedEntry(0);
    if (e) return out.copy(e);
    const r = this.radius * this.ballScale;
    return out.set(cav.max.x - r, cav.min.y + this.floorLift + r, (cav.min.z + cav.max.z) / 2);
  }

  /**
   * A ball the indexer has: at its entry (within a ball and a half of it along the robot, across the whole width for a
   * wide feeder, within two balls across for a single lane) and low enough to be on the entry rather than on the pile.
   * Generic robots without a drawn feed path take it anywhere along the front of the floor.
   */
  private atEntry(p: THREE.Vector3, entry: THREE.Vector3): boolean {
    const r = this.radius;
    // Low enough: on the entry, or on the floor at it (a feed path may start a little above the floor balls).
    const floor = (this.cavity?.min.y ?? -Infinity) + this.floorLift + r;
    if (Math.abs(p.x - entry.x) > r * 1.6 || p.y > Math.max(entry.y, floor) + r * 0.8) return false;
    // A wide feeder (dumper) takes balls across the whole hopper; so does a generic robot with no drawn feed path (a
    // full-width roller indexer along the front of the floor).
    const wide = (this.robot.config.launcher.exits ?? 1) > 1 || !this.robot.feedEntry(0);
    return wide || Math.abs(p.z - entry.z) < r * 2.2;
  }

  private get radius(): number { return this.pool.colliderRadius; }
  // Netted hoppers hold their load at the packing their model declares (`mech.packRadius`: 4414's binder capacity needs
  // the foam squashed to FUEL_PACK_RADIUS), otherwise at full size so the load fills the net; the drawn balls stay full size.
  private get ballScale(): number {
    const c = this.robot.config;
    if (c.hopperExpansion?.mechanism === 'telescoping' || !c.hopperExpansion) return GamePiecePool.STOWED_SCALE;
    return this.robot.packRadius ?? 1;
  }
  /** Collider radius of the balls in this hopper (m). */
  get ballRadius(): number { return this.radius * this.ballScale; }

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
    if (!cav) { this.pool.setStowed(i, GROUPS.stowed, this.ballScale); this.stowed.add(i); return; }
    if (body.isEnabled()) {
      // Captured on the field: carry on from there, pulled in by the rollers.
      this.stats.captured++;
      const from = this.toLocal(body.translation(), new THREE.Vector3());
      const pts = [from, ...this.robot.intakePath(from)];
      this.feeding.set(i, { t: 0, pts, k: 1, loose: 0 });
      this.pool.setStowed(i, GROUPS.feeding, this.ballScale);
    } else {
      this.dropIn(i, cav);
    }
  }

  /**
   * Preloads / scripted loads: close-pack the cavity (hexagonal layers, no overlaps) and let gravity settle it.
   * Slots past what fits continue upward, so an over-full load is simply a heap above the rim.
   */
  private dropIn(i: number, cav: Cavity): void {
    const rc = this.radius * this.ballScale, d = rc * 2.01;
    const row = d * Math.sqrt(3) / 2, layerH = d * Math.sqrt(2 / 3);
    const w = cav.max.x - cav.min.x - 2 * rc, l = cav.max.z - cav.min.z - 2 * rc;
    const perRow = Math.max(1, Math.floor(w / d) + 1), rows = Math.max(1, Math.floor(l / row) + 1);
    const perLayer = perRow * rows;
    // Packed from the indexer's end, the way a team stages a preload: the first balls sit at the entry.
    const flip = this.entry(cav, this.w).x > (cav.min.x + cav.max.x) / 2;
    let slot = 0, valid=0;
    // Skip mechanism space while packing; never preload a ball inside the shooter.
    for (;;) {
    const layer = Math.floor(slot / perLayer), k = slot % perLayer;
    // Across the width first (a whole row at the indexer end), then back along the robot: the first balls a wide drum
    // takes span its width instead of one corner.
    const j = k % rows, c = Math.floor(k / rows);
    // Alternate row/layer offsets (A-B-A stacking); shifts are trimmed so every ball stays inside the walls.
    const shiftX = (((j + layer) % 2) * 0.5) * d, shiftZ = (layer % 2) * row / 3;
    this.v.set(
      Math.min(cav.min.x + rc + c * d + shiftX, cav.max.x - rc),
      cav.min.y + this.floorLift + rc + layer * layerH,
      Math.min(cav.min.z + rc + j * row + shiftZ, cav.max.z - rc),
    );
    if (flip) this.v.x = cav.min.x + cav.max.x - this.v.x;
    const probe = this.v.clone();
    if (!clearFuelKeepouts(probe, rc, cav.keepouts ?? []) && !clearHopperChamfer(probe,rc,cav.chamfer) && !clearFuelOutline(probe,rc,cav.outline) && valid++===this.stowed.size) break;
    slot++;
    }
    this.place(i, this.v);
    this.stowed.add(i);
    this.pool.setStowed(i, GROUPS.stowed, this.ballScale);
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
    this.staging.delete(i);
    this.pool.drawnElsewhere.delete(i);
    this.stowed.delete(i);
    this.feeding.delete(i);
    if (this.buried.delete(i) && !this.buried.size) this.floorLift = 0;
  }

  /** Stop simulating the hopper: every ball stays held (just a count again) and its body is switched off. */
  park(): void {
    this.clearStaging();
    for (const i of [...this.stowed, ...this.buried.keys(), ...this.feeding.keys()]) this.pool.parkHeld(i);
    this.stowed.clear();
    this.buried.clear();
    this.feeding.clear();
    this.floorLift = 0;
    for (const w of this.walls) this.robot.physics.world.removeCollider(w, false);
    this.walls = [];
    if (this.cad) for (const c of this.cad) this.robot.physics.world.removeCollider(c.collider, false);
    this.cad = null;
  }

  /** Release every held ball back to the reserve (robot reset). */
  clear(): void {
    this.clearStaging();
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
    const r = this.radius * this.ballScale;
    this.frame();
    if (this.stowed.size > StowBay.ACTIVE_MAX + 6) {
      const rows = [...this.stowed].filter(i => !this.staging.has(i)).map(i => ({ i, y: this.toLocal(this.pool.bodies[i].translation(), this.v).y })).sort((a, b) => a.y - b.y);
      const need = rows.length - StowBay.ACTIVE_MAX;
      if (need <= 0) return;
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
    const r = this.radius * this.ballScale;
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

  /** Robot-frame position of hopper ball `i` (null when it isn't one). */
  localOf(i: number): THREE.Vector3 | null {
    if (this.buried.has(i)) return this.buried.get(i)!.clone();
    if (!this.stowed.has(i)) return null;
    this.frame();
    return this.toLocal(this.pool.bodies[i].translation(), new THREE.Vector3());
  }

  /** Robot-frame positions of the balls in the hopper (the net drapes over them). */
  forEachLocal(cb: (x: number, y: number, z: number) => void): void {
    for (const l of this.buried.values()) cb(l.x, l.y, l.z);
    if (!this.stowed.size) return;
    this.frame();
    const p = new THREE.Vector3();
    for (const i of this.stowed) {
      if (this.staging.has(i)) continue;
      this.toLocal(this.pool.bodies[i].translation(), p);
      cb(p.x, p.y, p.z);
    }
  }

  /** Stable ball identities currently drawn by the indexer instead of by the pool. */
  private readonly staging = new Set<number>();

  /** Move one conserved ball into the conveyor, keeping the handoff at its actual settled position. */
  takeForFeed(entry: THREE.Vector3): { position: THREE.Vector3; release(position: THREE.Vector3): void } | null {
    if (this.stowed.size <= this.staging.size && this.buried.size) this.wakeLayer();
    this.frame();
    const idx = this.nearestForFeed(entry);
    if (idx < 0) return null;
    const position = this.toLocal(this.pool.bodies[idx].translation(), new THREE.Vector3());
    this.staging.add(idx);
    this.pool.drawnElsewhere.add(idx);
    // Conveyor motion is bounded animation; the hidden duplicate does not need ball-to-ball physics.
    this.pool.bodies[idx].setEnabled(false);
    return { position, release: local => {
      if (!this.staging.delete(idx)) return; // Already launched or released by the pool.
      this.pool.drawnElsewhere.delete(idx);
      this.pool.bodies[idx].setEnabled(true);
      this.place(idx, local);
    } };
  }

  /** The indexer has nothing in flight: any ball still claimed for it goes back to being a hopper ball where it is. */
  releaseStaged(): void {
    if (!this.staging.size) return;
    for (const i of this.staging) {
      this.pool.drawnElsewhere.delete(i);
      if (this.stowed.has(i)) this.pool.bodies[i].setEnabled(true);
    }
    this.staging.clear();
  }

  private clearStaging(): void {
    for (const i of this.staging) this.pool.drawnElsewhere.delete(i);
    this.staging.clear();
  }

  /** Prefer a ball at the entry, otherwise draw the nearest unstaged ball from anywhere in the hopper. */
  private nearestForFeed(entry: THREE.Vector3): number {
    let best = -1, distance = Infinity, atEntry = false;
    const p = new THREE.Vector3();
    for (const i of this.stowed) {
      if (this.staging.has(i)) continue;
      this.toLocal(this.pool.bodies[i].translation(), p);
      const ready = this.atEntry(p, entry), d = p.distanceToSquared(entry);
      if ((ready && !atEntry) || (ready === atEntry && d < distance)) {
        best = i; distance = d; atEntry = ready;
      }
    }
    return best;
  }

  /** Consume the lead conveyor ball, otherwise draw directly from the hopper; -1 only when it is empty. */
  pickForLaunch(_exit: THREE.Vector3): number {
    const staged = this.staging.values().next().value;
    if (staged !== undefined) return staged;
    if (!this.stowed.size && this.buried.size) this.wakeLayer(true);
    this.frame();
    const cav = this.cavity ?? this.robot.fuelCavity();
    return cav ? this.nearestForFeed(this.entry(cav, new THREE.Vector3())) : -1;
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
    this.time += dt;
    this.carryTeleport();
    const cav = this.robot.fuelCavity();
    if (!cav) return;
    this.cavity = cav;
    this.syncWalls(cav);
    this.syncCad(cav);
    this.carryBuried();
    // A hit, a hard start or stop, or a turn sloshes the whole pile: wake the buried layers at once, and don't bury
    // again until the chassis has been calm for a while (burying mid-slosh makes balls pop back in at stale spots).
    {
      const v = this.robot.body.linvel(), w = this.robot.body.angvel();
      const jolt = Math.hypot(v.x - this.lastVel.x, v.z - this.lastVel.z) / Math.max(dt, 1e-3) > 3 || Math.abs(w.y) > 0.8;
      this.lastVel.set(v.x, v.y, v.z);
      if (jolt) { this.calmSince = this.time; if (this.buried.size) this.wakeLayer(true); }
    }
    if (++this.lastCheck >= 10) {
      this.lastCheck = 0;
      // A dye rotor keeps its load moving (agitating or feeding), so nothing in it is ever buried.
      if (this.time - this.calmSince > 1.5 && !this.feedingIndexer && !this.robot.floorRotor()) this.rebalance();
    }
    // Feeding moves the bottom of the pile (the balls on the floor rollers and at the indexer): it all has to be live.
    if (this.feedingIndexer && this.buried.size) this.wakeLayer(true);
    if (this.robot.capturesByContact) { this.frame(); this.captureByContact(); }
    if (!this.stowed.size && !this.feeding.size) return;
    this.frame();
    const r = this.radius, p = new THREE.Vector3(), target = new THREE.Vector3(), vel = new THREE.Vector3();
    // Balls being pulled in by the intake rollers along the model's own intake lane.
    // Models with roller hooks: the drawn rollers carry the ball. Others: the intake lane does, but only while the ball is
    // still on it (knocked off it, it is on its own).
    const rollers = this.robot.intakeRollers(), hooks = !!this.robot.hasRollerHooks, byContact = true;
    for (const [i, f] of this.feeding) {
      const body = this.pool.bodies[i];
      this.toLocal(body.translation(), p);
      const within = p.x > cav.min.x + r * 0.6 && p.x < cav.max.x - r * 0.6 && Math.abs(p.z - (cav.min.z + cav.max.z) / 2) < (cav.max.z - cav.min.z) / 2 - r * 0.6
        && p.y > cav.min.y && p.y < cav.max.y + (cav.open ? 3 * r : 0);
      // Rollers carry a ball only while it touches one that is running (models with roller hooks); otherwise the
      // intake lane stands in for them up to the stow point.
      const gripped = hooks ? this.touchesRoller(p, rollers, r) : f.k < f.pts.length - 1 && this.onLane(p, f.pts, f.k, r);
      if (within && (byContact ? !gripped || p.y < cav.max.y : f.k >= f.pts.length - 1)) {
        this.feeding.delete(i);
        this.stowed.add(i);
        this.pool.setStowed(i, GROUPS.stowed, this.ballScale);
        continue;
      }
      if (byContact) {
        // Let go outside the hopper (it fell back off the rollers, or they stopped): an ordinary field ball where it is.
        f.loose = gripped ? 0 : f.loose + dt;
        if (f.loose > LOOSE_AFTER || f.t > FEED_TIMEOUT * 3) { this.feeding.delete(i); this.dropOut(i); continue; }
        f.t += dt;
        if (!gripped) continue; // momentum and gravity only
      } else if (f.t > FEED_TIMEOUT) {
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
    this.dampRelative(dt);
    if (this.feedingIndexer) this.driveFloor(cav);
    else if (this.robot.floorRotor()) this.driveFloor(cav, true);
    // A ball that is over a wall's top edge (open hopper) is an ordinary field ball again. A ball that is merely outside
    // the walls below the rim was left there by a wall that moved in (retracting extension, lowered roof): it is pushed
    // back inside, never dropped.
    this.contain(cav, p, r);
  }

  /**
   * The driven floor carries the balls lying on it toward the indexer entry at roller surface speed (friction: their
   * horizontal velocity relative to the chassis eases toward it). Balls on the pile above, or on an undriven part of the
   * floor, are left alone.
   */
  private driveFloor(cav: Cavity, agitate = false): void {
    if (!this.stowed.size) return;
    const r = this.radius * this.ballScale, floor = cav.min.y + this.floorLift;
    const wide = (this.robot.config.launcher.exits ?? 1) > 1 || !this.robot.feedEntry(0);
    // A single-lane feeder with no declared floor is a spindexer / rotor hopper (the REBUILT single-lane pattern): its
    // floor turns about the hopper centre.
    const entry = this.entry(cav, new THREE.Vector3()), span = this.robot.drivenFloorSpan();
    const rotor = this.robot.floorRotor() ?? (!wide && !span ? { x: (cav.min.x + cav.max.x) / 2, z: (cav.min.z + cav.max.z) / 2, radius: Math.max(cav.max.x - cav.min.x, cav.max.z - cav.min.z) / 2 } : null);
    const lo = span ? span[0] - r : -Infinity, hi = span ? span[1] + r : Infinity;
    const p = new THREE.Vector3(), rel = new THREE.Vector3(), want = new THREE.Vector3();
    const lin = this.robot.body.linvel(), base = new THREE.Vector3(lin.x, lin.y, lin.z).applyQuaternion(this.qi);
    // While feeding, the intake rollers keep turning too: a ball resting on one (on a folded intake) is rolled on in.
    const rollers = agitate || !this.robot.hasRollerHooks ? [] : this.robot.intakeRollers().map(k => ({ ...k, on: true }));
    for (const i of this.stowed) {
      if (this.staging.has(i)) continue;
      const body = this.pool.bodies[i];
      this.toLocal(body.translation(), p);
      if ((p.y > floor + r * 1.35 || p.x < lo || p.x > hi) && !(rollers.length && this.touchesRoller(p, rollers, this.radius))) continue;
      // A roller floor drives straight along the robot toward the entry line of a wide feeder, toward the lane of a
      // single one (converging every ball on one point only wedges the floor layer).
      // Real rollers are never perfectly square: a slight skew (alternating per ball) lets a ball pushed head-on into a
      // post slide round it instead of balancing there.
      want.set(entry.x - p.x, 0, wide ? Math.abs(entry.x - p.x) * (i % 2 ? 0.15 : -0.15) : entry.z - p.z);
      const d = want.length();
      if (d < r * 0.5) continue;
      want.divideScalar(d);
      // A dye rotor carries the balls on it round its centre (the spiral fin walks them toward the throat as they go), so
      // a ball behind the centre column comes round to the throat instead of being shoved into the column.
      const onRotor = !!rotor && Math.hypot(p.x - rotor.x, p.z - rotor.z) < rotor.radius + r;
      if (onRotor && rotor) {
        const tx = -(p.z - rotor.z), tz = p.x - rotor.x, tl = Math.hypot(tx, tz) || 1;
        // Near the throat the fin's spiral funnels the ball into it.
        const pull = d < 0.3 ? 1.6 : 0.5;
        want.x = want.x * pull + tx / tl; want.z = want.z * pull + tz / tl;
        want.normalize();
      }
      want.multiplyScalar(onRotor ? ROTOR_SPEED * Math.min(1, Math.hypot(p.x - rotor!.x, p.z - rotor!.z) / rotor!.radius + 0.35) : FLOOR_SPEED);
      // Idle, a dye rotor turns slowly backwards to agitate the load (4414's binder): the pile levels instead of heaping.
      if (agitate) { if (!onRotor) continue; want.set(p.z - rotor!.z, 0, -(p.x - rotor!.x)).normalize().multiplyScalar(AGITATE_SPEED); }
      const v = body.linvel();
      rel.set(v.x, v.y, v.z).applyQuaternion(this.qi).sub(base);
      rel.x += (want.x - rel.x) * 0.3; rel.z += (want.z - rel.z) * 0.3;
      rel.add(base).applyQuaternion(this.q);
      body.setLinvel({ x: rel.x, y: rel.y, z: rel.z }, true);
    }
  }

  /** Still riding the intake lane: within a ball and a bit of the segment it is heading along (robot frame). */
  private onLane(p: THREE.Vector3, pts: THREE.Vector3[], k: number, r: number): boolean {
    const a = pts[Math.max(0, k - 1)], b = pts[Math.min(k, pts.length - 1)], ab = new THREE.Vector3().subVectors(b, a);
    const t = THREE.MathUtils.clamp(new THREE.Vector3().subVectors(p, a).dot(ab) / Math.max(1e-6, ab.lengthSq()), 0, 1);
    return p.distanceTo(a.clone().addScaledVector(ab, t)) < r * 1.6;
  }

  /** Rolling resistance of foam FUEL in the hopper: its motion relative to the chassis dies away (not its motion with it). */
  private dampRelative(dt: number): void {
    const lin = this.robot.body.linvel(), k = Math.exp(-RELATIVE_DAMPING * dt);
    for (const i of this.stowed) {
      if (this.staging.has(i)) continue;
      const b = this.pool.bodies[i];
      if (b.isSleeping()) continue;
      const v = b.linvel();
      b.setLinvel({ x: lin.x + (v.x - lin.x) * k, y: v.y, z: lin.z + (v.z - lin.z) * k }, false);
    }
  }

  /** Within grip of a running intake roller (robot frame). */
  private touchesRoller(p: THREE.Vector3, rollers: ReturnType<Robot['intakeRollers']>, r: number): boolean {
    const d = new THREE.Vector3();
    for (const roller of rollers) {
      if (!roller.on) continue;
      d.copy(p).sub(roller.c);
      const along = d.dot(roller.u);
      if (Math.abs(along) > roller.length / 2 + r * 0.3) continue;
      d.addScaledVector(roller.u, -THREE.MathUtils.clamp(along, -roller.length / 2, roller.length / 2));
      if (d.length() < roller.radius + r + GRIP) return true;
    }
    return false;
  }

  /** Field FUEL touching a running capture roller comes in, where it is and moving as it is. */
  private captureByContact(): void {
    const robot = this.robot;
    if (!robot.enabled || !robot.lastCommand.intake || robot.intakeRoom <= 0) return;
    const rollers = robot.intakeRollers().filter(k => k.capture && k.on);
    if (!rollers.length) return;
    const t = robot.body.translation(), r = this.radius, p = new THREE.Vector3();
    for (let i = 0; i < this.pool.count && robot.intakeRoom > 0; i++) {
      if (this.pool.state[i] !== 'field' || robot.justLaunched(i)) continue;
      const b = this.pool.bodies[i].translation();
      if (Math.abs(b.x - t.x) > 1.2 || Math.abs(b.z - t.z) > 1.2) continue;
      if (!this.touchesRoller(this.toLocal(b, p), rollers, r)) continue;
      robot.noteCapture(b);
      this.pool.hold(i, robot.id);
      robot.held.push(i);
    }
  }

  /** A ball the intake dropped outside the hopper: back on the field, same body, same motion. */
  private dropOut(i: number): void {
    const k = this.robot.held.lastIndexOf(i);
    if (k >= 0) this.robot.held.splice(k, 1);
    this.pool.releaseToField(i);
    this.robot.noteLaunch(i);
  }

  /** Called once per rendered frame, after the physics steps: undo any pop through a wall before it is drawn. */
  settle(): void {
    if (!this.stowed.size) return;
    this.cavity = this.robot.fuelCavity();
    if (this.cavity) { this.frame(); this.contain(this.cavity, new THREE.Vector3(), this.radius); }
  }

  private contain(cav: Cavity, p: THREE.Vector3, r: number): void {
    const cx = (cav.min.x + cav.max.x) / 2, cz = (cav.min.z + cav.max.z) / 2;
    const rs = r * this.ballScale; // the whole ball stays inside the side walls
    const hx = (cav.max.x - cav.min.x) / 2 - rs, hz = (cav.max.z - cav.min.z) / 2 - rs;
    const ceilingAt = this.robot.hopperCeilingFn(), floorAt = this.robot.hopperFloorFn();
    for (const i of [...this.stowed]) {
      if (this.staging.has(i)) continue;
      const body = this.pool.bodies[i];
      this.toLocal(body.translation(), p);
      const beyondLip = p.x < cav.min.x-r*.2 || p.x > cav.max.x+r*.2 || p.z < cav.min.z-r*.2 || p.z > cav.max.z+r*.2;
      // Firm faces (as rebuilt.firstroboticsim does): any ball more than a 4 mm skin into a side wall, the floor or a
      // roof is put back on the face.
      const outX = Math.abs(p.x - cx) > hx + SKIN, outZ = Math.abs(p.z - cz) > hz + SKIN;
      // The bins' own roof over this spot (a net's dome tied low at the rim, a sloped or stepped roof) caps a covered hopper.
      const roof = cav.open ? Infinity : Math.min(cav.max.y, ceilingAt(p.x, p.z));
      const floor = Math.max(cav.min.y + this.floorLift, floorAt(p.x, p.z)), outY = p.y < floor + rs - SKIN || p.y > (cav.open ? cav.max.y + 0.6 : roof - rs + SKIN); // covered: the whole ball stays under the roof / net
      const clipped=clearHopperChamfer(p,rs,cav.chamfer)||clearFuelOutline(p,rs,cav.outline);
      // A ball in a mechanism envelope leaves it by the nearest side (the smallest move). Never more than KEEPOUT_STEP
      // at once: a jump to the envelope's far side, with the pile pressing back, showed as a shake.
      const beforeKeepout = this.v.copy(p);
      const kept = clearFuelKeepouts(p, rs, cav.keepouts ?? [], cav);
      if (kept) {
        const dx = p.x - beforeKeepout.x, dz = p.z - beforeKeepout.z, m = Math.hypot(dx, dz);
        if (m > KEEPOUT_STEP) { p.x = beforeKeepout.x + dx * KEEPOUT_STEP / m; p.z = beforeKeepout.z + dz * KEEPOUT_STEP / m; }
      }
      const blocked = kept || clipped;
      const inverted = 1-2*(this.q.x*this.q.x+this.q.z*this.q.z)<.2;
      const escaping = cav.open && ((beyondLip && p.y>cav.max.y-r*.5) || (inverted && p.y>cav.max.y+r*.5));
      if (!outX && !outZ && !outY && !blocked && !escaping) continue;
      if (escaping) {
        this.stats.released++;
        this.stowed.delete(i);
        const held = this.robot.held.lastIndexOf(i);
        if (held >= 0) this.robot.held.splice(held, 1);
        this.pool.releaseToField(i);
        this.robot.noteLaunch(i);
        continue;
      }
      const old = p.clone();
      p.set(cx + THREE.MathUtils.clamp(p.x - cx, -hx, hx), THREE.MathUtils.clamp(p.y, Math.min(floor + rs, roof - rs), cav.open ? Infinity : roof - rs), cz + THREE.MathUtils.clamp(p.z - cz, -hz, hz));
      const lin = this.robot.body.linvel();
      this.toWorld(p, this.v);
      body.setTranslation({ x: this.v.x, y: this.v.y, z: this.v.z }, true);
      // Only the motion into the faces it was put back on stops (relative to the chassis); the rest of the slosh stays.
      const v = body.linvel(), rel = this.w.set(v.x - lin.x, v.y - lin.y, v.z - lin.z).applyQuaternion(this.qi);
      const push = old.sub(p); // from the face back to where the ball had got to: the outward direction per axis
      if (push.x * rel.x > 0) rel.x = 0;
      if (push.y * rel.y > 0) rel.y = 0;
      if (push.z * rel.z > 0) rel.z = 0;
      rel.applyQuaternion(this.q);
      body.setLinvel({ x: lin.x + rel.x, y: lin.y + rel.y, z: lin.z + rel.z }, true);
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
      // Nets are soft roofs handled by the cavity (their hull would be a solid dome).
      for (let q: THREE.Object3D | null = mesh; q && q !== visual; q = q.parent) {
        if (q.userData.flowToken || q.userData.fuelNoContact || /net|fabric|mesh-roof/i.test(q.name)) return;
      }
      g.computeBoundingBox();
      const rel = new THREE.Matrix4().multiplyMatrices(inv, mesh.matrixWorld);
      const bounds = g.boundingBox!.clone().applyMatrix4(rel);
      if (!bounds.intersectsBox(zone)) return;
      const centre = bounds.getCenter(new THREE.Vector3());
      candidates.push({ mesh, rel, d: centre.distanceTo(zone.getCenter(new THREE.Vector3())), tris: g.index ? g.index.count / 3 : pos.count / 3 });
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
      const dims = [size.x, size.y, size.z].sort((a, b) => a - b);
      if (dims[2] > StowBay.MAX_PART || dims[0] < 0.012) continue;
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

  /** Robot-frame matrix of `o` from its nodes' live transforms (cached matrices are stale wherever nothing renders). */
  private relative(o: THREE.Object3D): THREE.Matrix4 {
    const m = new THREE.Matrix4(), t = new THREE.Matrix4();
    for (let p: THREE.Object3D | null = o; p && p !== this.robot.visual; p = p.parent) m.premultiply(p.matrixAutoUpdate ? t.compose(p.position, p.quaternion, p.scale) : p.matrix);
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
