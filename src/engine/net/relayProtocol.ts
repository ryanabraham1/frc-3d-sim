/**
 * Relay envelope protocol. The relay (server/relay.ts) is game-agnostic: it manages rooms and peer ids
 * and fans messages out. Text frames are these JSON envelopes; binary frames are opaque and may only be
 * sent by the room host (forwarded to every other peer). Shared by the server and the browser client.
 */

export const RELAY_PATH = '/ws';
export const MAX_PEERS_PER_ROOM = 12;
export const MAX_FRAME_BYTES = 256 * 1024;
/** The relay drops host binary frames (snapshots) for a peer with more than this still queued to it. */
export const MAX_BINARY_BACKLOG = 128 * 1024;
/** Room code alphabet: no I/O/0/1 to avoid confusion when read aloud. */
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
export const ROOM_CODE_LENGTH = 4;

export type RelayRequest =
  | { op: 'create'; name: string }
  | { op: 'join'; room: string; name: string }
  /** Client → always delivered to host. Host → `to` peer, or every client when omitted. */
  | { op: 'send'; data: unknown; to?: string };

export type RelayEvent =
  | { op: 'created'; room: string; peerId: string }
  | { op: 'joined'; room: string; peerId: string; hostId: string }
  | { op: 'error'; message: string }
  | { op: 'peer-joined'; peerId: string; name: string }
  | { op: 'peer-left'; peerId: string }
  | { op: 'room-closed'; reason: string }
  | { op: 'msg'; from: string; data: unknown };

export function normalizeRoomCode(code: string): string {
  return code.trim().toUpperCase().replace(/[^A-Z]/g, '').slice(0, ROOM_CODE_LENGTH);
}

export function cleanName(name: unknown): string {
  const s = typeof name === 'string' ? name : '';
  // eslint-disable-next-line no-control-regex
  return s.replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 24) || 'Player';
}
