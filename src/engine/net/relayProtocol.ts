/**
 * Relay envelope protocol. The relay (server/relay.ts) is game-agnostic: it manages rooms and peer ids
 * and fans messages out. Text frames are these JSON envelopes; binary frames are opaque and may only be
 * sent by the room host (forwarded to every other peer). Shared by the server and the browser client.
 */

import { isBadText } from './nameFilter.ts';
import type { Outcome, RankedMode, Team } from './ranked';

export const RELAY_PATH = '/ws';
export const MAX_PEERS_PER_ROOM = 12;
export const MAX_FRAME_BYTES = 256 * 1024;
/** The relay drops host binary frames (snapshots) for a peer with more than this still queued to it. */
export const MAX_BINARY_BACKLOG = 16 * 1024;
/** Room code alphabet: no I/O/0/1 to avoid confusion when read aloud. */
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
export const ROOM_CODE_LENGTH = 4;
/** How long a dropped connection keeps its place in the room before the relay gives it up (ms). */
export const RECONNECT_GRACE_MS = 30_000;
/** Close code a client uses for a deliberate leave (anything else counts as a dropped connection). */
export const CLOSE_LEAVE = 4000;
export const MAX_TITLE_LENGTH = 32;
/** Most public rooms returned by one `list`. */
export const MAX_LISTED_ROOMS = 40;

export type RoomVisibility = 'public' | 'private';
/** What the room is doing: `lobby` rooms can be joined freely, the others are listed as in progress. */
export type RoomState = 'lobby' | 'placing' | 'match';

/** Room details the host publishes so the public list stays accurate (the relay never reads game data). */
export interface RoomMeta {
  visibility?: RoomVisibility;
  title?: string;
  /** Display label of the selected game, e.g. "2026 REBUILT". */
  season?: string;
  /** Seated drivers (not spectators). */
  drivers?: number;
  /** Driver stations in this game. */
  seats?: number;
  state?: RoomState;
  bots?: boolean;
}

export interface RoomListing {
  code: string;
  title: string;
  host: string;
  season: string;
  /** Everyone in the room, spectators included. */
  players: number;
  max: number;
  drivers: number;
  seats: number;
  state: RoomState;
  bots: boolean;
}

export type RelayRequest =
  /** `client` is a per-tab id: a new join from the same tab replaces any ghost the old page left behind. */
  | { op: 'create'; name: string; meta?: RoomMeta; client?: string }
  | { op: 'join'; room: string; name: string; client?: string }
  /** Give up a seat I couldn't tell the relay about (I left while reconnecting). */
  | { op: 'forget'; room: string; token: string }
  /** Resume the same peer id; its token can also supersede a half-open socket. */
  | { op: 'rejoin'; room: string; token: string }
  /** Ask for the public room list. */
  | { op: 'list' }
  /** WebRTC signaling, restricted to the room's host/client links. */
  | { op: 'signal'; to: string; data: unknown }
  /** Host: skip relay snapshots for peers currently receiving direct snapshots. */
  | { op: 'snapshot-route'; exclude: string[] }
  /** Host only: opaque recovery checkpoint, retained in memory for a replacement host. */
  | { op: 'checkpoint'; data: unknown }
  /** Transport heartbeat detects half-open browser connections before a seat expires. */
  | { op: 'ping'; id: number }
  /** Host only: update what the public list shows (and flip public/private). */
  | { op: 'meta'; meta: RoomMeta }
  /** Host only: remove a peer from the room; they cannot return while it exists. */
  | { op: 'kick'; peerId: string }
  /** Join the ranked queue. `secret` is the device's private key; the relay only stores its hash. */
  | { op: 'queue'; mode: RankedMode; name: string; secret: string }
  | { op: 'unqueue' }
  /** Fetch this player's ratings (registers them on first use). */
  | { op: 'profile'; name: string; secret: string }
  /** The season's single leaderboard (one rating covers every mode). */
  | { op: 'leaderboard'; secret?: string }
  /** Ranked room member: the result as they saw it. The relay needs the host and the other drivers to agree. */
  | { op: 'result'; winner: Outcome; red: number; blue: number }
  /** Client → always delivered to host. Host → `to` peer, or every client when omitted. */
  | { op: 'send'; data: unknown; to?: string };

export interface ModeSummary {
  games: number;
  wins: number;
  losses: number;
  draws: number;
}

export interface RatingSummary {
  rating: number;
  games: number;
  wins: number;
  losses: number;
  draws: number;
  peak: number;
  /** Record in each mode (the rating is shared). */
  modes: Record<RankedMode, ModeSummary>;
}

export interface LeaderEntry extends Omit<RatingSummary, 'modes'> {
  name: string;
  /** This row is the requesting player. */
  me?: boolean;
}

export interface RankedRosterEntry {
  peerId: string;
  name: string;
  team: Team;
  rating: number;
  games: number;
}

export type RelayEvent =
  | { op: 'created'; room: string; peerId: string; token: string }
  | { op: 'joined'; room: string; peerId: string; hostId: string; token: string; resumed?: boolean }
  | { op: 'rooms'; rooms: RoomListing[] }
  | { op: 'queued'; mode: RankedMode; waiting: number }
  /** Periodic queue size while searching. */
  | { op: 'queue-status'; mode: RankedMode; waiting: number }
  | { op: 'unqueued'; reason: string }
  /** A ranked match was formed and this peer is already seated in its room (the host is `hostId`). */
  | { op: 'matched'; room: string; peerId: string; hostId: string; token: string; mode: RankedMode; team: Team; roster: RankedRosterEntry[] }
  | { op: 'profile'; persistent: boolean; name: string; season: string; rating: RatingSummary; /** Place on the season leaderboard (null until I've played). */ standing: { rank: number; total: number } | null }
  | { op: 'leaderboard'; season: string; rows: LeaderEntry[]; /** The requester's standing (if they have played). */ you?: { rank: number; total: number; rating: number; games: number } }
  /** Result of a ranked match for this player. `status` void = no rating change. */
  | { op: 'rating'; mode: RankedMode; status: 'final' | 'abandoned' | 'void'; before: number; after: number; delta: number; result: 'win' | 'loss' | 'draw' | 'abandon' | 'none'; reason?: string }
  | { op: 'error'; message: string }
  | { op: 'peer-joined'; peerId: string; name: string }
  | { op: 'peer-left'; peerId: string }
  /** A peer's connection dropped; it may still come back within the grace period. */
  | { op: 'peer-lost'; peerId: string }
  | { op: 'peer-back'; peerId: string }
  | { op: 'host-lost' }
  | { op: 'host-back' }
  | { op: 'pong'; id: number }
  /** Checkpoint is sent only to the elected host; peers names include reconnecting seats. */
  | { op: 'host-changed'; hostId: string; previousHostId: string; peers: { peerId: string; name: string }[]; checkpoint?: unknown }
  | { op: 'room-closed'; reason: string }
  | { op: 'signal'; from: string; data: unknown }
  | { op: 'msg'; from: string; data: unknown };

/** Per-tab client ids: short and boring, or dropped. */
export function cleanClientId(id: unknown): string {
  return typeof id === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(id) ? id : '';
}

export function normalizeRoomCode(code: string): string {
  return code.trim().toUpperCase().replace(/[^A-Z]/g, '').slice(0, ROOM_CODE_LENGTH);
}

export function cleanName(name: unknown): string {
  const s = typeof name === 'string' ? name : '';
  // eslint-disable-next-line no-control-regex
  const clean = s.replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 24) || 'Player';
  // Enforced here so every path (lobby, ranked, relay) refuses a bad name, whatever the client sent.
  return isBadText(clean) ? 'Player' : clean;
}

export function cleanTitle(title: unknown): string {
  const s = typeof title === 'string' ? title : '';
  // eslint-disable-next-line no-control-regex
  const clean = s.replace(/[\u0000-\u001f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, MAX_TITLE_LENGTH);
  return isBadText(clean) ? '' : clean;
}
