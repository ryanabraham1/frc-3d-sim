import type { GamePiecePool, PieceState } from '../gamepiece/pool';
import type { MatchClock } from '../match/clock';
import type { Scoreboard } from '../match/scoreboard';
import type { Robot, RobotCommand } from '../robot/robot';
import type { MatchResults, SeasonRules } from '../core/season';
import { wrapAngle } from '../units';
import type { NetClient } from './netClient';
import { decodeSnapshot, packCommand, type ClientMsg, type NetGameState, type RobotNetState, type Snapshot } from './protocol';

const STATES: PieceState[] = ['field', 'held', 'reserve'];
/** Render this far behind the newest host time so there are usually two snapshots to blend. */
export const INTERP_DELAY = 0.1;
/** Nominal snapshot spacing (host sends at ~30 Hz). */
const SNAP_DT = 1 / 30;

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

  private offset: number | null = null;
  private readonly robotSnaps: { t: number; robots: Map<number, RobotNetState> }[] = [];
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
    if (!this.gotKeyframe && !s.meta.key) return null; // wait for a full picture
    this.bytesReceived += buf.byteLength;
    this.snapshots++;
    const sample = s.time - localMs / 1000;
    if (this.offset === null || Math.abs(sample - this.offset) > 0.5 || s.meta.key) this.offset = sample;
    else this.offset += (sample - this.offset) * 0.05;

    const { pool, clock, score, rules } = this.target;
    const m = s.meta;
    this.netState = m.st;
    this.countdown = m.cd;
    clock.restore(m.clock);
    if (m.score) score.restore(m.score);
    if (m.rules !== undefined && rules.applyNetState) rules.applyNetState(m.rules);
    for (const [i, x, y, z, w] of m.rotations ?? []) {
      if (i >= 0 && i < pool.count) pool.bodies[i].setRotation({ x, y, z, w }, false);
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
      if (st === 'field' && pool.state[i] !== 'field') fresh.add(i);
      pool.applyReplicaState(i, st, owner, tag);
    }
    for (let k = 0; k < s.pieceIdx.length; k++) {
      const i = s.pieceIdx[k];
      if (i >= pool.count) continue;
      const j = i * 3;
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
   * Pose the replica world for this frame. `skipRobot` = a robot rendered by client prediction instead.
   */
  interpolate(localMs: number, skipRobot: number | null = null): void {
    if (this.offset === null || !this.robotSnaps.length) return;
    const rt = this.hostNow(localMs) - INTERP_DELAY;

    const snaps = this.robotSnaps;
    let j = -1;
    for (let i = snaps.length - 1; i >= 0; i--) {
      if (snaps[i].t <= rt) {
        j = i;
        break;
      }
    }
    const a = snaps[Math.max(0, j)];
    const b = j >= 0 && j < snaps.length - 1 ? snaps[j + 1] : a;
    const alpha = b === a ? 1 : Math.min(1, Math.max(0, (rt - a.t) / (b.t - a.t)));
    for (const [id, sb] of b.robots) {
      if (id === skipRobot) continue;
      const robot = this.robotsById.get(id);
      if (!robot) continue;
      const sa = a.robots.get(id) ?? sb;
      robot.applyNet(alpha >= 1 ? sb : lerpRobot(sa, sb, alpha));
    }

    const pool = this.target.pool;
    for (let i = 0; i < pool.count; i++) {
      if (pool.state[i] !== 'field') continue;
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
    }
  }

  /** Send the local driver's command: immediately on button changes, else ≤30 Hz, plus a 4 Hz keep-alive. */
  sendCommand(cmd: RobotCommand, localMs: number): number | null {
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
    turretYaw: a.turretYaw + wrapAngle(b.turretYaw - a.turretYaw) * k,
  };
}
