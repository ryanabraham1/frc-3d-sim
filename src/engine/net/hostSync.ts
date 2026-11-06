import type { Robot, RobotCommand } from '../robot/robot';
import type { NetClient } from './netClient';
import { unpackCommand, type ClientMsg, type HostMsg, type MatchSetup } from './protocol';
import { SnapshotEncoder, type SnapshotSource } from './snapshotEncoder';

/**
 * Skip a snapshot while this much is still queued on the socket (slow uplink) — deltas stay queued for the
 * next one. Everything queued here is latency every client sees, so allow roughly one keyframe.
 */
const MAX_BUFFERED = 16 * 1024;
/** Four keep-alives may be missed before a driver goes idle. */
export const COMMAND_TIMEOUT_MS = 1000;

/** What the host sync reads from the running Game. */
export type HostSyncSource = SnapshotSource;

/** The simulation worker, when the match runs there: what the page's HostSync hears goes on to it (see HostStream). */
export interface HostSimLink {
  command(robotId: number, cmd: RobotCommand, seq: number): void;
  /** Forget one robot's command, or everyone's. */
  dropCommands(robotId?: number): void;
  requestKeyframe(): void;
}

export interface HostSyncHooks {
  /** A client pressed its human-player button. */
  humanPlayer(robot: Robot | null, peerId: string, button: number): void;
  /** Everyone expected is ready (or timed out). */
  allReady(): void;
  peerLeft(peerId: string, robot: Robot | null): void;
}

/**
 * Host side of a networked match, on the page (the network lives here): collects client commands, tracks readiness, and
 * streams snapshots (robots every time; only moved pieces; piece state/score/rules only when changed). When the match
 * runs in the simulation worker, `link` carries commands there and encoded snapshots come back through `sendEncoded`.
 */
export class HostSync {
  private readonly cmds = new Map<number, { cmd: RobotCommand; seq: number; at: number }>();
  private readonly waitingFor: Set<string>;
  private readonly encoder: SnapshotEncoder;
  /** Set while the match runs in the simulation worker. */
  link: HostSimLink | null = null;
  private readyFired = false;
  private readonly offs: (() => void)[] = [];
  private readyTimer: ReturnType<typeof setTimeout>;
  /** Peers whose connection dropped (and hasn't come back): the only ones the match may start without. */
  private readonly lost = new Set<string>();
  private readonly waitStarted = performance.now();
  bytesSent = 0;

  constructor(
    private readonly client: NetClient,
    private readonly setup: MatchSetup,
    private readonly src: HostSyncSource,
    private readonly hooks: HostSyncHooks,
    readyTimeoutMs = 20000,
    /** Even a connected peer that never finishes loading is left behind after this long. */
    private readonly readyHardCapMs = 120000,
  ) {
    this.encoder = new SnapshotEncoder(src);
    this.waitingFor = new Set(setup.peers.filter((p) => p !== client.peerId));
    this.offs.push(client.on('msg', ({ from, data }) => this.onMsg(from, data as ClientMsg)));
    this.offs.push(client.on('peer-left', ({ peerId }) => this.onPeerLeft(peerId)));
    // A dropped driver's robot goes idle at once; when they resume they get a full keyframe.
    this.offs.push(client.on('peer-lost', ({ peerId }) => this.onPeerLost(peerId)));
    this.offs.push(client.on('peer-back', ({ peerId }) => { this.lost.delete(peerId); this.requestKeyframe(); }));
    this.offs.push(client.on('reconnecting', () => { this.cmds.clear(); this.link?.dropCommands(); }));
    this.offs.push(client.on('reconnected', () => this.requestKeyframe()));
    this.readyTimer = setTimeout(() => this.readyTimeout(), readyTimeoutMs);
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
    this.encoder.requestKeyframe();
    this.link?.requestKeyframe();
  }

  private onMsg(from: string, m: ClientMsg): void {
    if (!m || typeof m !== 'object') return;
    switch (m.t) {
      case 'ready':
        this.requestKeyframe();
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
        this.link?.command(r.id, cmd, seq);
        break;
      }
      case 'hp':
        this.hooks.humanPlayer(this.robotForPeer(from), from, Number(m.n) || 1);
        break;
      case 'resync':
        this.requestKeyframe();
        break;
    }
  }

  private dropCommand(robot: Robot | null): void {
    if (!robot) return;
    this.cmds.delete(robot.id);
    this.link?.dropCommands(robot.id);
  }

  private onPeerLost(peerId: string): void {
    this.lost.add(peerId);
    this.dropCommand(this.robotForPeer(peerId));
  }

  private onPeerLeft(peerId: string): void {
    const robot = this.robotForPeer(peerId);
    this.dropCommand(robot);
    this.waitingFor.delete(peerId);
    this.hooks.peerLeft(peerId, robot);
    this.checkReady();
  }

  /**
   * Waited `readyTimeoutMs`: start without the peers whose connection dropped, but keep waiting for anyone still connected
   * and loading (a slow machine still compiling shaders): starting without them left their robot frozen or lagging.
   */
  private readyTimeout(): void {
    if (this.readyFired) return;
    for (const p of this.lost) this.waitingFor.delete(p);
    if (this.waitingFor.size && performance.now() - this.waitStarted < this.readyHardCapMs) {
      this.readyTimer = setTimeout(() => this.readyTimeout(), 1000);
      return;
    }
    this.fireReady();
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

  /** Is the link taking snapshots right now? (A skip keeps pending deltas for the next one.) */
  get linkClear(): boolean {
    return this.client.connected && this.client.relaySnapshotBacklog <= MAX_BUFFERED;
  }

  /** Build + send one snapshot. `time` = host sim time (s). */
  sendSnapshot(time: number): void {
    if (!this.linkClear) return;
    this.sendEncoded(this.encoder.encode(time, (id) => this.cmds.get(id)?.seq ?? 0));
  }

  /** Send a snapshot that is already encoded (by the simulation worker). */
  sendEncoded(buf: ArrayBuffer): void {
    this.bytesSent += buf.byteLength;
    this.client.sendBinary(buf);
  }

  dispose(): void {
    clearTimeout(this.readyTimer);
    for (const off of this.offs) off();
  }
}
