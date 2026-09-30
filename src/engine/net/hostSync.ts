import type { GamePiecePool, PieceState } from '../gamepiece/pool';
import type { MatchClock } from '../match/clock';
import type { Scoreboard } from '../match/scoreboard';
import type { Robot, RobotCommand } from '../robot/robot';
import type { MatchResults, SeasonRules } from '../core/season';
import type { NetClient } from './netClient';
import {
  encodeSnapshot,
  quantize,
  unpackCommand,
  type ClientMsg,
  type HostMsg,
  type MatchSetup,
  type NetGameState,
  type PieceStateEntry,
  type SnapshotMeta,
} from './protocol';

const STATE_CODE: Record<PieceState, number> = { field: 0, held: 1, reserve: 2 };
/** Skip a snapshot if this much is still queued on the socket (slow uplink) — deltas stay queued. */
const MAX_BUFFERED = 512 * 1024;

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
  humanPlayer(robot: Robot | null, peerId: string): void;
  /** Everyone expected is ready (or timed out). */
  allReady(): void;
  peerLeft(peerId: string, robot: Robot | null): void;
}

/**
 * Host side of a networked match: collects client commands, tracks readiness, and streams snapshots
 * (robots every time; only moved pieces; piece state/score/rules only when changed).
 */
export class HostSync {
  private readonly cmds = new Map<number, { cmd: RobotCommand; seq: number }>();
  private readonly waitingFor: Set<string>;
  private readonly lastQ: Int16Array;
  private lastScore = '';
  private lastRules = '';
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
    this.waitingFor = new Set(setup.peers.filter((p) => p !== client.peerId));
    this.offs.push(client.on('msg', ({ from, data }) => this.onMsg(from, data as ClientMsg)));
    this.offs.push(client.on('peer-left', ({ peerId }) => this.onPeerLeft(peerId)));
    this.readyTimer = setTimeout(() => this.fireReady(), readyTimeoutMs);
    queueMicrotask(() => this.checkReady());
  }

  /** Latest command from a remote robot's driver (null if none / disconnected). */
  command(robotId: number): RobotCommand | null {
    return this.cmds.get(robotId)?.cmd ?? null;
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
        if (prev && seq < prev.seq) return; // stale
        this.cmds.set(r.id, { cmd, seq });
        break;
      }
      case 'hp':
        this.hooks.humanPlayer(this.robotForPeer(from), from);
        break;
    }
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
    if (this.client.buffered > MAX_BUFFERED) return;
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
    for (let i = 0; i < pool.count; i++) {
      if (pool.state[i] !== 'field') continue;
      const p = pool.position(i);
      const qx = quantize(p.x);
      const qy = quantize(p.y);
      const qz = quantize(p.z);
      const nonSphere = pool.specAt(i).shape === 'tube';
      const k = i * 3;
      if (!key && !changedSet!.has(i) && !nonSphere && this.lastQ[k] === qx && this.lastQ[k + 1] === qy && this.lastQ[k + 2] === qz) continue;
      this.lastQ[k] = qx;
      this.lastQ[k + 1] = qy;
      this.lastQ[k + 2] = qz;
      pieceIdx.push(i);
      piecePos.push(p.x, p.y, p.z);
      if (nonSphere) {
        const q = pool.bodies[i].rotation();
        rotations.push([i, q.x, q.y, q.z, q.w]);
      }
    }

    const meta: SnapshotMeta = { st: this.src.netState, cd: this.src.countdownLeft, clock: clock.snapshot() };
    if (rotations.length) meta.rotations = rotations;
    if (key) meta.key = true;
    if (pieces.length) meta.pieces = pieces;
    const sc = score.snapshot();
    const scJson = JSON.stringify(sc);
    if (key || scJson !== this.lastScore) {
      meta.score = sc;
      this.lastScore = scJson;
    }
    if (rules.netState) {
      const rs = rules.netState();
      const rsJson = JSON.stringify(rs);
      if (key || rsJson !== this.lastRules) {
        meta.rules = rs;
        this.lastRules = rsJson;
      }
    }
    if (this.src.netState === 'results' && this.src.lastResults) meta.results = this.src.lastResults;

    const buf = encodeSnapshot({
      time,
      robots: robots.map((r) => r.netState(this.cmds.get(r.id)?.seq ?? 0)),
      pieceIdx,
      piecePos,
      meta,
    });
    this.bytesSent += buf.byteLength;
    this.client.sendBinary(buf);
  }

  dispose(): void {
    clearTimeout(this.readyTimer);
    for (const off of this.offs) off();
  }
}
