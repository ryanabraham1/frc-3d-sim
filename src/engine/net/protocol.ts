import type { Alliance } from '../coords';
import type { MatchResults, ToastKind } from '../core/season';
import type { ClockState } from '../match/clock';
import type { ScoreState } from '../match/scoreboard';
import type { RobotConfig } from '../robot/config';
import type { RobotCommand } from '../robot/robot';

/**
 * Game-level multiplayer protocol (carried inside relay `send`/`msg` envelopes, see relayProtocol.ts),
 * plus the binary snapshot codec the host streams to clients. Pure — unit tested in tests/net.test.ts.
 */

// ───────────────────────────── lobby / setup ─────────────────────────────

export type SlotId = 'red1' | 'red2' | 'red3' | 'blue1' | 'blue2' | 'blue3';
export const SLOTS: SlotId[] = ['red1', 'red2', 'red3', 'blue1', 'blue2', 'blue3'];

export const slotAlliance = (s: SlotId): Alliance => (s.startsWith('red') ? 'red' : 'blue');
export const slotStation = (s: SlotId): number => Number(s.slice(-1));
export const slotId = (a: Alliance, station: number): SlotId => `${a}${station}` as SlotId;
export const slotLabel = (s: SlotId): string => `${slotAlliance(s) === 'red' ? 'Red' : 'Blue'} ${slotStation(s)}`;

export interface LobbyPlayer {
  peerId: string;
  name: string;
  /** Driver station, or null = spectator. */
  slot: SlotId | null;
  team: number;
  host: boolean;
}

export interface LobbyState {
  room: string;
  hostId: string;
  seasonId: string;
  players: LobbyPlayer[];
  /** Human players act automatically for every alliance (otherwise drivers press H). */
  autoHumanPlayer: boolean;
  inMatch: boolean;
}

export interface RobotSetup {
  /** Index in MatchSetup.robots — also the Robot id. */
  id: number;
  slot: SlotId;
  alliance: Alliance;
  station: number;
  config: RobotConfig;
  autoRoutine: string;
  manualAuto: boolean;
  /** Relay peer id of the driver ('' in singleplayer). */
  peerId: string;
  name: string;
}

export interface MatchSetup {
  seasonId: string;
  seed: number;
  autoHumanPlayer: boolean;
  robots: RobotSetup[];
  /** Every peer taking part (drivers + spectators, incl. host). The host waits for each one's `ready`. */
  peers: string[];
}

// ───────────────────────────── messages ─────────────────────────────

/** [vx, vy, omega, flags, climbLevel (-1 = none)] */
export type PackedCommand = [number, number, number, number, number];

const F_INTAKE = 1;
const F_SHOOT = 2;
const F_PASS = 4;
const F_DESCEND = 8;
const r3 = (v: number) => Math.round(v * 1000) / 1000;

export function packCommand(c: RobotCommand): PackedCommand {
  const flags = (c.intake ? F_INTAKE : 0) | (c.shoot ? F_SHOOT : 0) | (c.pass ? F_PASS : 0) | (c.descend ? F_DESCEND : 0);
  return [r3(c.vx), r3(c.vy), r3(c.omega), flags, c.climb ?? -1];
}

export function unpackCommand(p: unknown): RobotCommand | null {
  if (!Array.isArray(p) || p.length !== 5 || !p.every((v) => typeof v === 'number' && Number.isFinite(v))) return null;
  const [vx, vy, omega, flags, climb] = p as PackedCommand;
  return {
    vx,
    vy,
    omega,
    intake: (flags & F_INTAKE) !== 0,
    shoot: (flags & F_SHOOT) !== 0,
    pass: (flags & F_PASS) !== 0,
    descend: (flags & F_DESCEND) !== 0,
    climb: climb >= 0 ? climb : null,
  };
}

export type ClientMsg =
  /** `slot` omitted = keep the current station; null = spectate. */
  | { t: 'lobby-set'; slot?: SlotId | null; robot: RobotConfig; autoRoutine: string; manualAuto: boolean }
  /** Client finished building its Game and can take snapshots. */
  | { t: 'ready' }
  | { t: 'cmd'; s: number; c: PackedCommand }
  /** Human-player button (e.g. open the CHUTE) for the sender's alliance. */
  | { t: 'hp' };

export type HostMsg =
  | { t: 'lobby'; lobby: LobbyState }
  | { t: 'start'; setup: MatchSetup }
  | { t: 'toast'; msg: string; kind: ToastKind; alliance?: Alliance }
  | { t: 'to-lobby' }
  | { t: 'notice'; message: string };

// ───────────────────────────── snapshots ─────────────────────────────

export const CLIMB_PHASES = ['none', 'align', 'rise', 'hanging', 'lower'] as const;

export interface RobotNetState {
  id: number;
  /** World (Three.js, y-up) position of the robot origin. */
  x: number;
  y: number;
  z: number;
  /** Field yaw (rad). */
  yaw: number;
  turretYaw: number;
  held: number;
  enabled: boolean;
  /** Index into CLIMB_PHASES. */
  climbPhase: number;
  climbLevel: number;
  climbSlot: number | null;
  climbProgress: number;
  /** Last client command sequence the host applied (for prediction/reconciliation). */
  cmdSeq: number;
}

/** [pieceIndex, state (0 field · 1 held · 2 reserve), owner robot id, tag] */
export type PieceStateEntry = [number, number, number, string | null];

export type NetGameState = 'waiting' | 'countdown' | 'running' | 'paused' | 'results';

export interface SnapshotMeta {
  st: NetGameState;
  /** Pre-match countdown remaining. */
  cd: number;
  clock: ClockState;
  /** Piece state changes since the previous snapshot (all pieces in a keyframe). */
  pieces?: PieceStateEntry[];
  /** Present when changed (always in a keyframe). */
  score?: ScoreState;
  rules?: unknown;
  results?: MatchResults;
  /** Keyframe: every field piece position is included. */
  key?: boolean;
}

export interface Snapshot {
  /** Host simulation time (s). */
  time: number;
  robots: RobotNetState[];
  /** Moved field pieces: indices + world positions (m), 3 per piece. */
  pieceIdx: number[];
  piecePos: number[];
  meta: SnapshotMeta;
}

export const SNAPSHOT_KIND = 1;
const ROBOT_BYTES = 1 + 5 * 4 + 6 + 4;
/** Piece positions are sent as int16 millimetres (±32.7 m covers any FRC field). */
export const PIECE_QUANTUM = 0.001;

export function quantize(v: number): number {
  return Math.max(-32767, Math.min(32767, Math.round(v / PIECE_QUANTUM)));
}

export function encodeSnapshot(s: Snapshot): ArrayBuffer {
  const metaBytes = new TextEncoder().encode(JSON.stringify(s.meta));
  const n = s.pieceIdx.length;
  const size = 1 + 8 + 1 + s.robots.length * ROBOT_BYTES + 2 + n * 8 + 4 + metaBytes.length;
  const buf = new ArrayBuffer(size);
  const v = new DataView(buf);
  let o = 0;
  v.setUint8(o, SNAPSHOT_KIND);
  o += 1;
  v.setFloat64(o, s.time, true);
  o += 8;
  v.setUint8(o, s.robots.length);
  o += 1;
  for (const r of s.robots) {
    v.setUint8(o, r.id);
    o += 1;
    for (const f of [r.x, r.y, r.z, r.yaw, r.turretYaw]) {
      v.setFloat32(o, f, true);
      o += 4;
    }
    v.setUint8(o++, Math.min(255, r.held));
    v.setUint8(o++, r.enabled ? 1 : 0);
    v.setUint8(o++, r.climbPhase);
    v.setUint8(o++, r.climbLevel);
    v.setInt8(o++, r.climbSlot ?? -1);
    v.setUint8(o++, Math.round(Math.max(0, Math.min(1, r.climbProgress)) * 255));
    v.setUint32(o, r.cmdSeq >>> 0, true);
    o += 4;
  }
  v.setUint16(o, n, true);
  o += 2;
  for (let i = 0; i < n; i++) {
    v.setUint16(o, s.pieceIdx[i], true);
    v.setInt16(o + 2, quantize(s.piecePos[i * 3]), true);
    v.setInt16(o + 4, quantize(s.piecePos[i * 3 + 1]), true);
    v.setInt16(o + 6, quantize(s.piecePos[i * 3 + 2]), true);
    o += 8;
  }
  v.setUint32(o, metaBytes.length, true);
  o += 4;
  new Uint8Array(buf, o).set(metaBytes);
  return buf;
}

export function decodeSnapshot(buf: ArrayBuffer): Snapshot | null {
  const v = new DataView(buf);
  if (buf.byteLength < 16 || v.getUint8(0) !== SNAPSHOT_KIND) return null;
  let o = 1;
  const time = v.getFloat64(o, true);
  o += 8;
  const nr = v.getUint8(o);
  o += 1;
  const robots: RobotNetState[] = [];
  for (let i = 0; i < nr; i++) {
    const id = v.getUint8(o);
    o += 1;
    const f: number[] = [];
    for (let k = 0; k < 5; k++, o += 4) f.push(v.getFloat32(o, true));
    const held = v.getUint8(o++);
    const enabled = v.getUint8(o++) === 1;
    const climbPhase = v.getUint8(o++);
    const climbLevel = v.getUint8(o++);
    const slot = v.getInt8(o++);
    const climbProgress = v.getUint8(o++) / 255;
    const cmdSeq = v.getUint32(o, true);
    o += 4;
    robots.push({ id, x: f[0], y: f[1], z: f[2], yaw: f[3], turretYaw: f[4], held, enabled, climbPhase, climbLevel, climbSlot: slot < 0 ? null : slot, climbProgress, cmdSeq });
  }
  const n = v.getUint16(o, true);
  o += 2;
  const pieceIdx: number[] = new Array(n);
  const piecePos: number[] = new Array(n * 3);
  for (let i = 0; i < n; i++) {
    pieceIdx[i] = v.getUint16(o, true);
    piecePos[i * 3] = v.getInt16(o + 2, true) * PIECE_QUANTUM;
    piecePos[i * 3 + 1] = v.getInt16(o + 4, true) * PIECE_QUANTUM;
    piecePos[i * 3 + 2] = v.getInt16(o + 6, true) * PIECE_QUANTUM;
    o += 8;
  }
  const len = v.getUint32(o, true);
  o += 4;
  const meta = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, o, len))) as SnapshotMeta;
  return { time, robots, pieceIdx, piecePos, meta };
}
