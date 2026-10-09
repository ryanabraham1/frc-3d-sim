import type { GamePiecePool, PieceState } from '../gamepiece/pool';
import type { MatchClock } from '../match/clock';
import type { Scoreboard } from '../match/scoreboard';
import type { Robot, RobotCommand } from '../robot/robot';
import type { MatchResults, SeasonRules } from '../core/season';
import { wrapAngle } from '../units';
import type { NetClient } from './netClient';
import { decodeSnapshot, packCommand, type ClientMsg, type NetGameState, type RobotNetState, type Snapshot } from './protocol';

const STATES: PieceState[] = ['field', 'held', 'reserve'];
/** Starting render delay behind the newest host time, so there are usually two snapshots to blend. */
export const INTERP_DELAY = 0.075;
/** The render delay adapts to measured arrival jitter within these bounds (s). */
export const MIN_INTERP_DELAY = 0.05;
export const MAX_INTERP_DELAY = 0.35;
/** Nominal snapshot spacing (host sends at ~30 Hz). */
const SNAP_DT = 1 / 30;
/** When snapshots run late, keep robots moving on their last velocity for at most this long (s). */
const MAX_EXTRAPOLATE = 0.1;
/** Minimum spacing between keyframe requests after missed snapshots (ms). */
const RESYNC_EVERY_MS = 1000;
/** Host-clock estimate: largest step one snapshot may move it (s), so a burst of late packets can't drag
 * the render time backwards. */
const MAX_OFFSET_STEP = 0.1;
/** Packets this much later than the estimate, this many times in a row, mean the latency really changed:
 * re-anchor instead of creeping there. */
const LATE_RESET = 0.5;
const LATE_RESET_RUN = 15;

interface RobotSnap {
  t: number;
  robots: Map<number, RobotNetState>;
}

export interface ClientSyncTarget {
  readonly pool: GamePiecePool;
  readonly robots: Robot[];
  readonly clock: MatchClock;
  readonly score: Scoreboard;
  readonly rules: SeasonRules;
}

/**
 * Client side of a networked match: applies host snapshots to a replica world (no physics stepping),
 * interpolates robots and pieces ~100 ms in the past, and rate-limits outgoing commands.
 */
export class ClientSync {
  netState: NetGameState = 'waiting';
  countdown = 0;
  results: MatchResults | null = null;
  /** Newest raw (non-interpolated) robot states, by id. */
  readonly latest = new Map<number, RobotNetState>();
  latestTime = 0;
  gotKeyframe = false;
  bytesReceived = 0;
  snapshots = 0;
  lastReceivedAt = -Infinity;
  /** Snapshots that never arrived (sequence gaps). */
  missed = 0;
  /** Current render delay behind host time (s); adapts to network jitter. */
  delay = INTERP_DELAY;
  /** Smoothed arrival jitter (s). */
  jitter = 0;

  private offset: number | null = null;
  /** Consecutive snapshots that arrived more than LATE_RESET behind the clock estimate. */
  private lateRun = 0;
  private lastSeq = -1;
  private lastResyncAt = -Infinity;
  private needsKeyframe = true;
  /** Last full rules state (rules patches are merged into it). */
  private rulesState: Record<string, unknown> | null = null;
  /** Pieces whose replica pose already sits at their newest sample (nothing to interpolate). */
  private readonly settled: Uint8Array;
  private readonly robotSnaps: RobotSnap[] = [];
  private readonly pt0: Float64Array;
  private readonly pt1: Float64Array;
  private readonly pp0: Float32Array;
  private readonly pp1: Float32Array;
  private readonly robotsById = new Map<number, Robot>();
  private seq = 0;
  private lastSentAt = -Infinity;
  private lastKey = '';
  private lastButtons = '';

  constructor(
    private readonly client: NetClient,
    private readonly target: ClientSyncTarget,
  ) {
    const n = target.pool.count;
    this.pt0 = new Float64Array(n);
    this.pt1 = new Float64Array(n);
    this.pp0 = new Float32Array(n * 3);
    this.pp1 = new Float32Array(n * 3);
    this.settled = new Uint8Array(n);
    for (const r of target.robots) this.robotsById.set(r.id, r);
  }

  /** Sequence number of the last command sent. */
  get commandSeq(): number {
    return this.seq;
  }

  /** Estimated current host sim time. */
  hostNow(localMs: number): number {
    return this.offset === null ? 0 : localMs / 1000 + this.offset;
  }

  onBinary(buf: ArrayBuffer, localMs: number): Snapshot | null {
    const s = decodeSnapshot(buf);
    if (!s) return null;
    // Relay and direct packets can overlap during a transport switch. Never roll state backward.
    if (s.seq <= this.lastSeq) return null;
    if (!this.gotKeyframe && !s.meta.key) {
      this.needsKeyframe = true;
      this.requestResync(localMs);
      return null;
    }
    this.bytesReceived += buf.byteLength;
    this.snapshots++;
    this.lastReceivedAt = localMs;
    // Snapshots go missing (the relay and the direct link drop frames for peers that fall behind). Every
    // value in a snapshot is absolute (piece poses and states, rules keys), so later ones still apply; only
    // what changed in the lost frame and not since is stale, and a keyframe fills that in. Freezing the
    // pieces until the keyframe arrived (a round trip, after a cascade of dropped keyframes on a slow
    // link) made every lost packet a visible hitch.
    const gap = this.lastSeq >= 0 && s.seq !== this.lastSeq + 1 && !s.meta.key;
    if (gap) {
      this.missed += Math.max(1, s.seq - this.lastSeq - 1);
      this.needsKeyframe = true;
    }
    if (s.meta.key) this.needsKeyframe = false;
    this.requestResync(localMs);
    this.lastSeq = s.seq;
    this.updateClock(s.time, localMs);
    // Enough delay for two snapshots plus the arrival jitter; eased so the view never jumps.
    const want = Math.min(MAX_INTERP_DELAY, Math.max(MIN_INTERP_DELAY, SNAP_DT * 1.5 + this.jitter * 2.5));
    this.delay += (want - this.delay) * 0.05;

    const { pool, clock, score, rules } = this.target;
    const m = s.meta;
    this.netState = m.st;
    this.countdown = m.cd;
    if (m.clock) clock.restore(m.clock);
    if (m.score) score.restore(m.score);
    if (rules.applyNetState) {
      if (m.rules !== undefined) {
        this.rulesState = m.rules && typeof m.rules === 'object' && !Array.isArray(m.rules) ? { ...(m.rules as Record<string, unknown>) } : null;
        rules.applyNetState(m.rules);
      } else if (m.rulesPatch && this.rulesState) {
        Object.assign(this.rulesState, m.rulesPatch);
        rules.applyNetState(this.rulesState);
      }
    }
    for (const [i, x, y, z, w] of m.rotations ?? []) {
      if (i >= 0 && i < pool.count) {
        pool.setReplicaRotation(i, x, y, z, w);
        this.settled[i] = 0;
      }
    }
    this.results = m.results ?? (m.st === 'results' ? this.results : null);

    const fresh = new Set<number>();
    if (m.key) {
      this.gotKeyframe = true;
      for (let i = 0; i < pool.count; i++) fresh.add(i);
    }
    for (const [i, code, owner, tag] of m.pieces ?? []) {
      if (i < 0 || i >= pool.count) continue;
      const st = STATES[code] ?? 'reserve';
      // After a gap the piece may have left the field and come back in between: place it, don't slide it.
      if (st === 'field' && (gap || pool.state[i] !== 'field')) fresh.add(i);
      this.settled[i] = 0;
      pool.applyReplicaState(i, st, owner, tag);
    }
    for (let k = 0; k < s.pieceIdx.length; k++) {
      const i = s.pieceIdx[k];
      if (i >= pool.count) continue;
      const j = i * 3;
      this.settled[i] = 0;
      if (fresh.has(i)) {
        this.pt0[i] = this.pt1[i] = s.time;
        for (let d = 0; d < 3; d++) this.pp0[j + d] = this.pp1[j + d] = s.piecePos[k * 3 + d];
        continue;
      }
      const stale = s.time - this.pt1[i] > 3 * SNAP_DT;
      this.pt0[i] = stale ? s.time - SNAP_DT : this.pt1[i];
      this.pt1[i] = s.time;
      for (let d = 0; d < 3; d++) {
        this.pp0[j + d] = this.pp1[j + d];
        this.pp1[j + d] = s.piecePos[k * 3 + d];
      }
    }

    const last = this.robotSnaps[this.robotSnaps.length - 1];
    if (last && s.time < last.t) this.robotSnaps.length = 0; // host clock restarted
    const map = new Map<number, RobotNetState>();
    for (const r of s.robots) {
      map.set(r.id, r);
      this.latest.set(r.id, r);
    }
    this.latestTime = s.time;
    this.robotSnaps.push({ t: s.time, robots: map });
    if (this.robotSnaps.length > 16) this.robotSnaps.shift();
    return s;
  }

  /**
   * Track the host clock (offset from local time) from snapshot arrivals. Late packets (a stall, then a
   * burst) move the estimate by at most MAX_OFFSET_STEP each: re-anchoring on one of them rewound every
   * robot by the length of the stall and then fast-forwarded it again.
   */
  private updateClock(hostTime: number, localMs: number): void {
    const sample = hostTime - localMs / 1000;
    const err = this.offset === null ? 0 : sample - this.offset;
    this.lateRun = err < -LATE_RESET ? this.lateRun + 1 : 0;
    // First snapshot, host clock restarted, packets now arrive much sooner, or latency stayed much higher.
    if (this.offset === null || hostTime < this.latestTime - 1 || err > LATE_RESET || this.lateRun >= LATE_RESET_RUN) {
      this.offset = sample;
      this.jitter = 0;
      this.lateRun = 0;
      return;
    }
    this.offset += Math.max(-MAX_OFFSET_STEP, Math.min(MAX_OFFSET_STEP, err)) * 0.05;
    this.jitter += (Math.min(Math.abs(err), MAX_INTERP_DELAY) - this.jitter) * 0.05;
  }

  /**
   * Pose the replica world for this frame. `skipRobot` = a robot rendered by client prediction instead.
   */
  interpolate(localMs: number, skipRobot: number | null = null): void {
    this.requestResync(localMs);
    if (this.offset === null || !this.robotSnaps.length) return;
    const rt = this.hostNow(localMs) - this.delay;

    const snaps = this.robotSnaps;
    let j = -1;
    for (let i = snaps.length - 1; i >= 0; i--) {
      if (snaps[i].t <= rt) {
        j = i;
        break;
      }
    }
    const newest = snaps.length - 1;
    if (j === newest && newest > 0 && rt > snaps[newest].t) {
      // Ran past the newest snapshot (a late packet): carry robots along their last motion briefly
      // instead of freezing them and then jumping.
      const a = snaps[newest - 1];
      const b = snaps[newest];
      const k = b.t > a.t ? 1 + Math.min(rt - b.t, MAX_EXTRAPOLATE) / (b.t - a.t) : 1;
      this.poseRobots(a, b, k, skipRobot);
    } else {
      const a = snaps[Math.max(0, j)];
      const b = j >= 0 && j < newest ? snaps[j + 1] : a;
      const alpha = b === a ? 1 : Math.min(1, Math.max(0, (rt - a.t) / (b.t - a.t)));
      this.poseRobots(a, b, alpha, skipRobot);
    }

    const pool = this.target.pool;
    const settled = this.settled;
    for (let i = 0; i < pool.count; i++) {
      if (pool.state[i] !== 'field' || settled[i]) continue;
      const t0 = this.pt0[i];
      const t1 = this.pt1[i];
      const k = t1 > t0 ? Math.min(1, Math.max(0, (rt - t0) / (t1 - t0))) : 1;
      const j3 = i * 3;
      pool.setReplicaPosition(
        i,
        this.pp0[j3] + (this.pp1[j3] - this.pp0[j3]) * k,
        this.pp0[j3 + 1] + (this.pp1[j3 + 1] - this.pp0[j3 + 1]) * k,
        this.pp0[j3 + 2] + (this.pp1[j3 + 2] - this.pp0[j3 + 2]) * k,
      );
      // At rest on its newest sample: nothing more to do until the next update for this piece.
      if (k >= 1) settled[i] = 1;
    }
  }

  private requestResync(localMs: number): void {
    if (!this.needsKeyframe || localMs - this.lastResyncAt < RESYNC_EVERY_MS) return;
    this.lastResyncAt = localMs;
    this.client.send({ t: 'resync' } satisfies ClientMsg);
  }

  private poseRobots(a: RobotSnap, b: RobotSnap, k: number, skipRobot: number | null): void {
    for (const [id, sb] of b.robots) {
      if (id === skipRobot) continue;
      const robot = this.robotsById.get(id);
      if (!robot) continue;
      const sa = a.robots.get(id) ?? sb;
      robot.applyNet(k === 1 ? sb : lerpRobot(sa, sb, k));
    }
  }

  /** Send the local driver's command: immediately on button changes, else ≤30 Hz, plus a 4 Hz keep-alive. */
  sendCommand(cmd: RobotCommand, localMs: number): number | null {
    if (!this.client.connected || this.client.buffered > 16 * 1024) return null;
    const packed = packCommand(cmd);
    const key = packed.join(',');
    const buttons = `${packed[3]},${packed[4]},${packed[5] ?? ''}`;
    const since = localMs - this.lastSentAt;
    if (buttons === this.lastButtons && !(key !== this.lastKey && since >= 33) && since < 250) return null;
    this.lastKey = key;
    this.lastButtons = buttons;
    this.lastSentAt = localMs;
    const msg: ClientMsg = { t: 'cmd', s: ++this.seq, c: packed };
    this.client.send(msg);
    return this.seq;
  }
}

export function lerpRobot(a: RobotNetState, b: RobotNetState, k: number): RobotNetState {
  return {
    ...b,
    x: a.x + (b.x - a.x) * k,
    y: a.y + (b.y - a.y) * k,
    z: a.z + (b.z - a.z) * k,
    yaw: a.yaw + wrapAngle(b.yaw - a.yaw) * k,
    rot: a.rot && b.rot ? nlerpQuat(a.rot, b.rot, k) : b.rot,
    turretYaw: a.turretYaw + wrapAngle(b.turretYaw - a.turretYaw) * k,
  };
}

/** Normalized quaternion blend (shortest way round) — plenty for 30 Hz snapshots. */
export function nlerpQuat(a: [number, number, number, number], b: [number, number, number, number], k: number): [number, number, number, number] {
  const sign = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3] < 0 ? -1 : 1;
  const q = a.map((v, i) => v + (sign * b[i] - v) * k) as [number, number, number, number];
  const n = Math.hypot(...q) || 1;
  return q.map((v) => v / n) as [number, number, number, number];
}
