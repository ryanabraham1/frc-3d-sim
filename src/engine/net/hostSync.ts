import type { GamePiecePool, PieceState } from '../gamepiece/pool';
import type { MatchClock } from '../match/clock';
import type { Scoreboard } from '../match/scoreboard';
import type { Robot, RobotCommand } from '../robot/robot';
import type { MatchResults, SeasonRules } from '../core/season';
import type { NetClient } from './netClient';
import {
  encodeSnapshot,
  quantize,
  quantizeRot,
  CLOCK_EVERY,
  ROT_QUANTUM,
  unpackCommand,
  type ClientMsg,
  type HostMsg,
  type MatchSetup,
  type NetGameState,
  type PieceStateEntry,
  type SnapshotMeta,
} from './protocol';

const STATE_CODE: Record<PieceState, number> = { field: 0, held: 1, reserve: 2 };
/**
 * Skip a snapshot while this much is still queued on the socket (slow uplink) — deltas stay queued for the
 * next one. Everything queued here is latency every client sees, so allow roughly one keyframe.
 */
const MAX_BUFFERED = 16 * 1024;
/** Four keep-alives may be missed before a driver goes idle. */
export const COMMAND_TIMEOUT_MS = 1000;

/** What the host sync reads from the running Game. */
export interface HostSyncSource {
  readonly pool: GamePiecePool;
  readonly robots: Robot[];
  readonly clock: MatchClock;
  readonly score: Scoreboard;
  readonly rules: SeasonRules;
  readonly netState: NetGameState;
  readonly countdownLeft: number;
  readonly lastResults: MatchResults | null;
}

export interface HostSyncHooks {
  /** A client pressed its human-player button. */
  humanPlayer(robot: Robot | null, peerId: string, button: number): void;
  /** Everyone expected is ready (or timed out). */
  allReady(): void;
  peerLeft(peerId: string, robot: Robot | null): void;
}

/**
 * Host side of a networked match: collects client commands, tracks readiness, and streams snapshots
 * (robots every time; only moved pieces; piece state/score/rules only when changed).
 */
export class HostSync {
  private readonly cmds = new Map<number, { cmd: RobotCommand; seq: number; at: number }>();
  private readonly waitingFor: Set<string>;
  private readonly lastQ: Int16Array;
  private readonly lastRot: Int16Array;
  private lastScore = '';
  private lastRules = '';
  /** JSON of each top-level rules key as last sent (for `rulesPatch`). */
  private readonly lastRulesKeys = new Map<string, string>();
  private seq = 0;
  private lastClockPhase = '';
  private forceKey = true;
  private readyFired = false;
  private readonly offs: (() => void)[] = [];
  private readonly readyTimer: ReturnType<typeof setTimeout>;
  bytesSent = 0;

  constructor(
    private readonly client: NetClient,
    private readonly setup: MatchSetup,
    private readonly src: HostSyncSource,
    private readonly hooks: HostSyncHooks,
    readyTimeoutMs = 20000,
  ) {
    this.lastQ = new Int16Array(src.pool.count * 3).fill(-32768);
    this.lastRot = new Int16Array(src.pool.count * 4).fill(-32768);
    this.waitingFor = new Set(setup.peers.filter((p) => p !== client.peerId));
    this.offs.push(client.on('msg', ({ from, data }) => this.onMsg(from, data as ClientMsg)));
    this.offs.push(client.on('peer-left', ({ peerId }) => this.onPeerLeft(peerId)));
    // A dropped driver's robot goes idle at once; when they resume they get a full keyframe.
    this.offs.push(client.on('peer-lost', ({ peerId }) => this.onPeerLost(peerId)));
    this.offs.push(client.on('peer-back', () => (this.forceKey = true)));
    this.offs.push(client.on('reconnecting', () => this.cmds.clear()));
    this.offs.push(client.on('reconnected', () => (this.forceKey = true)));
    this.readyTimer = setTimeout(() => this.fireReady(), readyTimeoutMs);
    queueMicrotask(() => this.checkReady());
  }

  /** Latest command from a remote robot's driver (null if none / disconnected). */
  command(robotId: number): RobotCommand | null {
    const latest = this.cmds.get(robotId);
    if (!latest || !this.client.connected || performance.now() - latest.at > COMMAND_TIMEOUT_MS) return null;
    return latest.cmd;
  }

  send(msg: HostMsg, to?: string): void {
    this.client.send(msg, to);
  }

  robotForPeer(peerId: string): Robot | null {
    const s = this.setup.robots.find((r) => r.peerId === peerId);
    return s ? (this.src.robots.find((r) => r.id === s.id) ?? null) : null;
  }

  peerForRobot(robot: Robot): string | null {
    return this.setup.robots.find((r) => r.id === robot.id)?.peerId ?? null;
  }

  /** Force the next snapshot to carry everything (e.g. a client just (re)built its world). */
  requestKeyframe(): void {
    this.forceKey = true;
  }

  private onMsg(from: string, m: ClientMsg): void {
    if (!m || typeof m !== 'object') return;
    switch (m.t) {
      case 'ready':
        this.forceKey = true;
        this.waitingFor.delete(from);
        this.checkReady();
        break;
      case 'cmd': {
        const r = this.setup.robots.find((x) => x.peerId === from);
        const cmd = unpackCommand(m.c);
        if (!r || !cmd) return;
        const prev = this.cmds.get(r.id);
        const seq = Number(m.s) || 0;
        if (prev && seq <= prev.seq) return; // stale
        this.cmds.set(r.id, { cmd, seq, at: performance.now() });
        break;
      }
      case 'hp':
        this.hooks.humanPlayer(this.robotForPeer(from), from, Number(m.n) || 1);
        break;
      case 'resync':
        this.forceKey = true;
        break;
    }
  }

  private onPeerLost(peerId: string): void {
    const robot = this.robotForPeer(peerId);
    if (robot) this.cmds.delete(robot.id);
  }

  private onPeerLeft(peerId: string): void {
    const robot = this.robotForPeer(peerId);
    if (robot) this.cmds.delete(robot.id);
    this.waitingFor.delete(peerId);
    this.hooks.peerLeft(peerId, robot);
    this.checkReady();
  }

  private checkReady(): void {
    if (this.waitingFor.size === 0) this.fireReady();
  }

  private fireReady(): void {
    if (this.readyFired) return;
    this.readyFired = true;
    clearTimeout(this.readyTimer);
    this.hooks.allReady();
  }

  /** Build + send one snapshot. `time` = host sim time (s). */
  sendSnapshot(time: number): void {
    if (!this.client.connected || this.client.buffered > MAX_BUFFERED) return;
    const { pool, robots, score, rules, clock } = this.src;
    const key = this.forceKey;
    this.forceKey = false;

    const changed = pool.takeChanges();
    const changedSet = key ? null : new Set(changed);
    const pieces: PieceStateEntry[] = [];
    const list = key ? Array.from({ length: pool.count }, (_, i) => i) : changed;
    for (const i of list) pieces.push([i, STATE_CODE[pool.state[i]], pool.owner[i], pool.tag[i]]);

    const pieceIdx: number[] = [];
    const piecePos: number[] = [];
    const rotations: [number, number, number, number, number][] = [];
    const { lastQ, lastRot } = this;
    for (let i = 0; i < pool.count; i++) {
      if (pool.state[i] !== 'field') continue;
      const body = pool.bodies[i];
      const fresh = key || changedSet!.has(i);
      // Every field piece is compared with what was last sent (never skipped as "asleep": that flag is not
      // proof a body hasn't moved), so clients always see pieces where the host has them.
      const p = body.translation();
      const qx = quantize(p.x);
      const qy = quantize(p.y);
      const qz = quantize(p.z);
      const k = i * 3;
      let moved = fresh || lastQ[k] !== qx || lastQ[k + 1] !== qy || lastQ[k + 2] !== qz;
      let rot: [number, number, number, number, number] | null = null;
      if (pool.specAt(i).shape === 'tube') {
        // Tubes (not round) also need their orientation — but only when it changed.
        const q = body.rotation();
        const r = i * 4;
        const a = quantizeRot(q.x);
        const b = quantizeRot(q.y);
        const c = quantizeRot(q.z);
        const d = quantizeRot(q.w);
        if (fresh || lastRot[r] !== a || lastRot[r + 1] !== b || lastRot[r + 2] !== c || lastRot[r + 3] !== d) {
          lastRot[r] = a;
          lastRot[r + 1] = b;
          lastRot[r + 2] = c;
          lastRot[r + 3] = d;
          rot = [i, a * ROT_QUANTUM, b * ROT_QUANTUM, c * ROT_QUANTUM, d * ROT_QUANTUM];
          moved = true;
        }
      }
      if (!moved) continue;
      lastQ[k] = qx;
      lastQ[k + 1] = qy;
      lastQ[k + 2] = qz;
      pieceIdx.push(i);
      piecePos.push(p.x, p.y, p.z);
      if (rot) rotations.push(rot);
    }

    const meta: SnapshotMeta = { st: this.src.netState, cd: this.src.countdownLeft };
    const ck = clock.snapshot();
    const phase = `${ck.i}:${ck.s}:${ck.f}`;
    if (key || phase !== this.lastClockPhase || (this.seq + 1) % CLOCK_EVERY === 0) {
      meta.clock = { ...ck, ep: Math.round(ck.ep * 1000) / 1000, e: Math.round(ck.e * 1000) / 1000 };
      this.lastClockPhase = phase;
    }
    if (rotations.length) meta.rotations = rotations;
    if (key) meta.key = true;
    if (pieces.length) meta.pieces = pieces;
    const sc = score.snapshot();
    const scJson = JSON.stringify(sc);
    if (key || scJson !== this.lastScore) {
      meta.score = sc;
      this.lastScore = scJson;
    }
    if (rules.netState) this.addRules(meta, rules.netState(), key);
    if (this.src.netState === 'results' && this.src.lastResults) meta.results = this.src.lastResults;

    const buf = encodeSnapshot({
      seq: ++this.seq,
      time,
      robots: robots.map((r) => r.netState(this.cmds.get(r.id)?.seq ?? 0)),
      pieceIdx,
      piecePos,
      meta,
    });
    this.bytesSent += buf.byteLength;
    this.client.sendBinary(buf);
  }

  /**
   * Season rules state: a plain object is diffed per top-level key so a constantly-changing field (e.g. a
   * swinging cage) doesn't resend the rest (e.g. every scored piece) 30 times a second.
   */
  private addRules(meta: SnapshotMeta, rs: unknown, key: boolean): void {
    if (!rs || typeof rs !== 'object' || Array.isArray(rs)) {
      const json = JSON.stringify(rs);
      if (key || json !== this.lastRules) meta.rules = rs;
      this.lastRules = json;
      return;
    }
    const patch: Record<string, unknown> = {};
    let changed = false;
    for (const [k, v] of Object.entries(rs)) {
      const json = JSON.stringify(v);
      if (key || this.lastRulesKeys.get(k) !== json) {
        patch[k] = v;
        this.lastRulesKeys.set(k, json);
        changed = true;
      }
    }
    if (key) meta.rules = rs;
    else if (changed) meta.rulesPatch = patch;
  }

  dispose(): void {
    clearTimeout(this.readyTimer);
    for (const off of this.offs) off();
  }
}
