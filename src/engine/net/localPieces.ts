import type RAPIER from '@dimforge/rapier3d-compat';
import type { GamePiecePool } from '../gamepiece/pool';
import { collisionGroups, Group } from '../physics/world';
import { footprint } from '../robot/config';
import type { Robot } from '../robot/robot';
import type { ClientSync, HostPieceSample } from './clientSync';
import type { RobotNetState } from './protocol';
import { yawFromQuat } from '../coords';

/**
 * Pieces closer than this to the predicted robot's bumpers are simulated locally (m): far enough ahead that a robot at
 * full speed reaches none it hasn't taken over, close enough that only pieces it can touch soon diverge from the host.
 */
const ADOPT_GAP = 0.35;
/** ...and handed back to the host's snapshots once they are farther than this (m). */
const RELEASE_GAP = 0.7;
/** A piece this close to another robot's footprint circle is contested: the host decides where it goes (m). */
const CONTEST_ADOPT = 0.9;
const CONTEST_RELEASE = 0.6;
/** Only pieces on (or just above) the carpet are taken over; flying shots stay with the host (m above rest). */
const FLOOR_BAND = 0.12;
/** Only pieces moving slower than this on the host are taken over (m/s). */
const MAX_ADOPT_SPEED = 3;
/** Robot colliders only (for the overlap test against our own chassis). */
const ROBOT_ONLY_FILTER = collisionGroups(Group.PIECE, Group.ROBOT);
const NO_ROTATION = { x: 0, y: 0, z: 0, w: 1 };
/** Our robot is riding on pieces when its chassis is this high, the host's copy is flat below FLAT_Y (m). */
const BEACHED_Y = 0.015;
const FLAT_Y = 0.006;

export interface LocalPiecesTarget {
  readonly pool: GamePiecePool;
  readonly robots: Robot[];
  readonly clientSync: ClientSync;
}

/**
 * Client-side simulation of the game pieces around the driver's own predicted robot.
 *
 * Without it a client's world has no game pieces: the predicted robot drives straight through FUEL that beaches it on
 * the host, then gets dragged back one round trip later. Here, replica pieces within a couple of meters of the
 * predicted robot get live Rapier bodies seeded from where they are drawn, so the robot rides up on them, loses
 * traction from immediate contacts. These are collision proxies only: every visible piece follows the host,
 * because independently simulated piles diverge and visible hand-back would undo speculative pushes.
 *
 * - Pieces near another robot are contested and stay (or go back) on the host's snapshots, as do airborne and fast pieces.
 * - Pushed pieces remain local until both poses clear the moving robot and the host has had time to receive the push.
 *   When the robot is idle, pieces return to snapshots and chassis support height/tilt comes from the host.
 * - The host's piece state wins: a piece it marks held or out of play leaves local simulation at once.
 * - Pieces in the mouth of the running floor intake are the host's to take (captures aren't predicted: the host's intake
 *   rate, capacity and pile differ enough that a predicted capture was wrong about a third of the time, and a ball that
 *   vanishes and comes back reads worse than one swallowed a round trip late).
 * - Releasing a collision proxy never moves its visible piece.
 */
export class LocalPieces {
  /** Toggle for debugging / A-B comparison (`game.localPieces.enabled = false`, or `?nolocalfuel`). */
  enabled = true;
  adoptions = 0;
  corrections = 0;
  snaps = 0;
  /** Times the robot was beached here but not on the host, and let go of the pieces under it. */
  unbeached = 0;
  /** Times the host had the robot beached and we didn't, and we lifted it onto the pieces there. */
  lifted = 0;
  private readonly list: number[] = [];
  /** Local time when a piece was last within the prediction bubble (seconds). */
  private readonly nearAt: Float64Array;
  private readonly sample: HostPieceSample = { x: 0, y: 0, z: 0, t: 0, vx: 0, vy: 0, vz: 0 };
  private readonly radius: number;
  private readonly fp: { length: number; width: number };
  private strandedFor = 0;
  private liftFor = 0;
  private readonly overlapShapes = new Map<number, RAPIER.Ball>();
  /** How long our robot has been standing still (s). */
  private restFor = 0;
  /** Once idle, support height/tilt comes from authority instead of a second independently settling pile. */
  private restPose: RobotNetState | null = null;
  private lastMs = 0;

  constructor(
    private readonly target: LocalPiecesTarget,
    private readonly robot: Robot,
  ) {
    this.nearAt = new Float64Array(target.pool.count);
    this.radius = target.pool.radius;
    this.fp = footprint(robot.config);
  }

  /** Pieces currently simulated here. */
  get count(): number {
    return this.list.length;
  }

  /**
   * Once per client tick, before the predicted physics steps: take over pieces that came near, hand back the ones
   * that left or became contested. Idle support and released pieces follow the host.
   * `active` = the robot is being predicted (otherwise everything goes back to snapshots). `rtt` in seconds.
   */
  update(localMs: number, active: boolean, rtt: number): void {
    const dt = this.lastMs ? Math.min(0.1, Math.max(0, (localMs - this.lastMs) / 1000)) : 0;
    this.lastMs = localMs;
    this.restPose = null;
    const { pool, clientSync } = this.target;
    if (!active || !this.enabled) {
      this.releaseAll();
      return;
    }
    const own = this.robot.body.translation();
    const others = this.otherRobots();
    // Cheap plan-view prefilter around the robot before the exact bumper-gap test.
    const fp = this.fp;
    const reach = Math.hypot(fp.length, fp.width) / 2 + ADOPT_GAP + this.radius;
    const s = this.sample;

    // A robot standing still pushes nothing: once the host has caught up with it, pieces at rest near it (but not
    // touching it) go back to the host's exact poses. Simulating them here only lets small differences linger in a pile.
    const v = this.robot.body.linvel();
    const w = this.robot.body.angvel();
    const cmd = this.robot.lastCommand;
    const moving = Math.hypot(v.x, v.z) > 0.1 || Math.abs(w.y) > 0.2 || cmd.vx !== 0 || cmd.vy !== 0 || cmd.omega !== 0;
    this.restFor = moving ? 0 : this.restFor + dt;
    const resting = this.restFor > rtt + 0.25;

    // Beached here on pieces the host doesn't have under us (the pile settled differently there): once the host has
    // had a round trip to beach us too and hasn't, let go of the pieces under the chassis so the robot drops back
    // onto the carpet where the host has it, instead of staying stuck until the pose correction drags it off.
    const hostSelf = clientSync.latest.get(this.robot.id);
    // An idle chassis needs no speculative contacts. Two independently settled support piles can disagree forever;
    // release the pieces and hold the host's support height/tilt after each step, rather than falling and lifting.
    if (resting && hostSelf) {
      this.restPose = hostSelf;
      this.releaseAll();
      return;
    }
    this.strandedFor = hostSelf && own.y > BEACHED_Y && hostSelf.y < FLAT_Y ? this.strandedFor + dt : 0;
    const stranded = this.strandedFor > rtt + 0.1;
    if (stranded) {
      this.strandedFor = 0;
      this.unbeached++;
    }

    // The reverse: the host has us up on pieces and we're flat on the carpet (the pile settled differently here, or we
    // drove over pieces before taking them over). The pieces under us are drawn inside the chassis, the "driving
    // through FUEL" look. After a round trip, lift the robot to the host's height and tilt: the pieces under it no
    // longer overlap the chassis, are taken over below, and it rests on them as the host has it.
    // Only over pieces: the host's robot may also be up on field structure (a BUMP) we have already driven off.
    this.liftFor = hostSelf && hostSelf.y > BEACHED_Y && own.y < FLAT_Y ? this.liftFor + dt : 0;
    if (hostSelf && this.liftFor > rtt + 0.1 && this.piecesUnder()) {
      this.liftFor = 0;
      this.lifted++;
      const b = this.robot.body;
      b.setTranslation({ x: own.x, y: hostSelf.y, z: own.z }, true);
      if (hostSelf.rot) {
        // Host tilt, our heading.
        const [hx, hy, hz, hw] = hostSelf.rot;
        const r = b.rotation();
        const dYaw = Math.atan2(2 * (r.w * r.y + r.x * r.z), 1 - 2 * (r.y * r.y + r.z * r.z)) - Math.atan2(2 * (hw * hy + hx * hz), 1 - 2 * (hy * hy + hz * hz));
        const sy = Math.sin(dYaw / 2), cy = Math.cos(dYaw / 2);
        // q = yaw(dYaw) * host
        b.setRotation({ x: cy * hx + sy * hz, y: cy * hy + sy * hw, z: cy * hz - sy * hx, w: cy * hw - sy * hy }, true);
      }
      const lv = b.linvel();
      b.setLinvel({ x: lv.x, y: 0, z: lv.z }, true);
    }

    // Hand back pieces that have cleared the robot. Never pose a still-local body toward delayed authority:
    // it may lie behind the moving bumper and pull the ball back through the chassis.
    for (let k = this.list.length - 1; k >= 0; k--) {
      const i = this.list[k];
      if (pool.state[i] !== 'field' || !pool.isLocal(i)) {
        this.drop(k);
        continue;
      }
      const p = pool.position(i);
      clientSync.hostPiece(i, s);
      const gap = this.gap(p);
      if (gap <= RELEASE_GAP) this.nearAt[i] = localMs / 1000;
      // The host receives our input a one-way trip later and its rendered pieces trail by another trip plus
      // interpolation delay. Releasing as soon as a pushed ball leaves the bubble pulls it back to its pre-push pose.
      const caughtUp = localMs / 1000 - this.nearAt[i] > rtt + clientSync.delay + 0.1;
      const hostGap = this.gap(s);
      // Foam the host crushes and squeezes out from under the chassis: never something to ride up on here either.
      const crushed = pool.specAt(i).crushedUnderRobots && this.under(p) && this.robot.toLocal(p).h < this.robot.config.bumperBottom + this.radius;
      if ((gap > RELEASE_GAP && caughtUp && hostGap > RELEASE_GAP) || contested(others, p, CONTEST_RELEASE) || ((stranded || crushed) && this.under(p)) || this.inMouth(p)) {
        this.drop(k);
        continue;
      }
    }

    if (resting) return;
    for (let i = 0; i < pool.count; i++) {
      if (pool.state[i] !== 'field' || pool.isLocal(i)) continue;
      clientSync.hostPiece(i, s);
      if (Math.hypot(s.x - own.x, s.z - own.z) > reach) continue;
      if (s.y > pool.restHeight(i) + FLOOR_BAND || Math.hypot(s.vx, s.vy, s.vz) > MAX_ADOPT_SPEED) continue;
      if (contested(others, s, CONTEST_ADOPT)) continue;
      // Start where drawn, so taking a piece over does not move it.
      const p = pool.replicaPosition(i);
      if (this.gap(p) > ADOPT_GAP) continue;
      // Already inside our chassis, here or on the host (we drove into it before it was ours, a correction moved us,
      // or our pose differs from the host's by a few cm): adopting would fling it out. It stays a snapshot replica
      // until we have driven clear of it.
      if (this.overlapsOwn(p, 0.005) || this.overlapsOwn(s, 0.03) || this.inMouth(p)) continue;
      pool.adoptLocal(i, { x: p.x, y: p.y, z: p.z }, { x: s.vx, y: s.vy, z: s.vz });
      this.list.push(i);
      this.nearAt[i] = localMs / 1000;
      this.adoptions++;
    }
  }

  /** Before each predicted physics step: render-interpolation poses of the local pieces. */
  beforeStep(): void {
    const pool = this.target.pool;
    for (const i of this.list) pool.capturePrevPoseOf(i);
  }

  /** After each predicted physics step: air/ground damping of the local pieces. */
  afterStep(): void {
    const pool = this.target.pool;
    for (const i of this.list) pool.updateDampingOf(i);
    const pose = this.restPose;
    if (pose) {
      const b = this.robot.body;
      const p = b.translation();
      b.setTranslation({ x: p.x, y: pose.y, z: p.z }, true);
      if (pose.rot) {
        const [hx, hy, hz, hw] = pose.rot;
        const dYaw = yawFromQuat(b.rotation()) - yawFromQuat({ x: hx, y: hy, z: hz, w: hw });
        const sy = Math.sin(dYaw / 2), cy = Math.cos(dYaw / 2);
        b.setRotation({ x: cy * hx + sy * hz, y: cy * hy + sy * hw, z: cy * hz - sy * hx, w: cy * hw - sy * hy }, true);
      }
      const v = b.linvel(), w = b.angvel();
      b.setLinvel({ x: v.x, y: 0, z: v.z }, true);
      b.setAngvel({ x: 0, y: w.y, z: 0 }, true);
    }
  }

  /** Everything back to the host's snapshots (prediction stopped or snapped). */
  releaseAll(): void {
    for (let k = this.list.length - 1; k >= 0; k--) this.drop(k);
  }

  /** Remove a collision proxy; visible pieces already follow the host. */
  private drop(k: number): void {
    const i = this.list[k];
    const { pool } = this.target;
    const last = this.list.pop()!;
    if (k < this.list.length) this.list[k] = last;
    if (!pool.isLocal(i)) return;
    this.corrections++;
    pool.releaseLocal(i);
  }

  /** Plan-view distance from a piece's surface to the predicted robot's bumpers (0 when touching or inside). */
  private gap(p: { x: number; y: number; z: number }): number {
    const fp = this.fp;
    const { f, l } = this.robot.toLocal(p);
    return Math.max(0, Math.hypot(Math.max(0, Math.abs(f) - fp.length / 2), Math.max(0, Math.abs(l) - fp.width / 2)) - this.radius);
  }

  /**
   * A piece in the mouth of the running floor intake (with room left) is the host's to take. Simulated here it would
   * only be shoved ahead by the bumper until the host's capture arrives.
   */
  private inMouth(p: { x: number; y: number; z: number }): boolean {
    const r = this.robot;
    return r.lastCommand.intake && r.config.intake.ground !== false && r.held.length < r.hopperCapacity && r.groundMouthContains(p, this.radius);
  }

  /** Does the host have a piece on the carpet under the predicted robot's chassis? */
  private piecesUnder(): boolean {
    const { pool, clientSync } = this.target;
    const own = this.robot.body.translation();
    const reach = Math.hypot(this.fp.length, this.fp.width) / 2;
    const s = this.sample;
    for (let i = 0; i < pool.count; i++) {
      if (pool.state[i] !== 'field') continue;
      clientSync.hostPiece(i, s);
      if (Math.hypot(s.x - own.x, s.z - own.z) < reach && s.y < pool.restHeight(i) + 0.05 && this.under(s)) return true;
    }
    return false;
  }

  /** Is a piece under the predicted robot's chassis (inside its footprint)? */
  private under(p: { x: number; y: number; z: number }): boolean {
    const { f, l } = this.robot.toLocal(p);
    return Math.abs(f) < this.fp.length / 2 && Math.abs(l) < this.fp.width / 2;
  }

  /**
   * Does a piece here overlap our robot's colliders by more than `depth` (m)? Exact chassis geometry: a piece under
   * the robot, below its bumpers, doesn't overlap a beached robot.
   */
  private overlapsOwn(p: { x: number; y: number; z: number }, depth: number): boolean {
    const pool = this.target.pool;
    let shape = this.overlapShapes.get(depth);
    if (!shape) {
      shape = new pool.physics.R.Ball(Math.max(0.005, pool.colliderRadius - depth));
      this.overlapShapes.set(depth, shape);
    }
    const body = this.robot.body;
    return pool.physics.world.intersectionWithShape(p, NO_ROTATION, shape, undefined, ROBOT_ONLY_FILTER, undefined, undefined, (c) => c.parent() === body) !== null;
  }

  private readonly others: { x: number; z: number; reach: number }[] = [];
  private otherRobots(): { x: number; z: number; reach: number }[] {
    const out = this.others;
    out.length = 0;
    for (const r of this.target.robots) {
      if (r === this.robot) continue;
      const t = r.body.translation();
      out.push({ x: t.x, z: t.z, reach: halfDiagonal(r) });
    }
    return out;
  }
}

function halfDiagonal(r: Robot): number {
  const fp = footprint(r.config);
  return Math.hypot(fp.length, fp.width) / 2;
}

function contested(others: { x: number; z: number; reach: number }[], p: { x: number; z: number }, margin: number): boolean {
  for (const o of others) if (Math.hypot(p.x - o.x, p.z - o.z) < o.reach + margin) return true;
  return false;
}
