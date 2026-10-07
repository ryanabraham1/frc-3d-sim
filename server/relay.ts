import { randomUUID } from 'node:crypto';
import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer, WebSocket, type RawData } from 'ws';
import {
  cleanName,
  cleanTitle,
  CLOSE_LEAVE,
  MAX_BINARY_BACKLOG,
  MAX_FRAME_BYTES,
  MAX_LISTED_ROOMS,
  MAX_PEERS_PER_ROOM,
  normalizeRoomCode,
  RECONNECT_GRACE_MS,
  RELAY_PATH,
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  type RelayEvent,
  type RelayRequest,
  type RoomListing,
  type RoomMeta,
  type RoomState,
  type RoomVisibility,
} from '../src/engine/net/relayProtocol.ts';

/**
 * Game-agnostic WebSocket relay: rooms, peer ids, fan-out. The host's browser is the authority; the
 * relay never inspects game data. Attach it to any Node http.Server (Vite dev server, the standalone
 * server in server/index.ts, or a test server).
 *
 * Rooms are private (code only) or public (listed for `list`). A peer whose connection drops keeps its
 * place for `reconnectGraceMs`; `rejoin` with its token resumes the same peer id.
 */

interface Peer {
  id: string;
  name: string;
  ws: WebSocket;
  room: Room | null;
  /** Secret that lets this peer resume after a dropped connection. */
  token: string;
  ip: string;
  /** Connection dropped; waiting for a `rejoin` until `lostTimer` fires. */
  lost: boolean;
  lostTimer: ReturnType<typeof setTimeout> | null;
}

interface Room {
  code: string;
  host: Peer;
  peers: Map<string, Peer>;
  visibility: RoomVisibility;
  title: string;
  season: string;
  drivers: number;
  seats: number;
  state: RoomState;
  bots: boolean;
  /** IPs removed by the host. */
  banned: Set<string>;
}

export interface Relay {
  readonly wss: WebSocketServer;
  /** Number of open rooms (for tests / health). */
  roomCount(): number;
  /** Open rooms visible in the public list. */
  publicRoomCount(): number;
  close(): Promise<void>;
}

export interface RelayOptions {
  path?: string;
  log?: (msg: string) => void;
  /** Destroy upgrade requests for other paths (standalone server). Leave false when sharing a server (Vite HMR). */
  rejectOtherPaths?: boolean;
  /** Keep-alive ping interval (ms). */
  pingInterval?: number;
  /** How long a dropped peer keeps its seat (ms). */
  reconnectGraceMs?: number;
  /** Take the client IP from X-Forwarded-For (only behind a proxy you control, e.g. Render). */
  trustProxy?: boolean;
  /** Per-IP limits; 0 disables a limit. */
  limits?: Partial<RelayLimits>;
}

export interface RelayLimits {
  /** Simultaneous sockets per IP. */
  connections: number;
  /** Rooms created per IP per minute. */
  creates: number;
  /** Failed joins/rejoins per IP per minute (stops guessing private room codes). */
  badJoins: number;
}

const DEFAULT_LIMITS: RelayLimits = { connections: 24, creates: 8, badJoins: 20 };
const WINDOW_MS = 60_000;
const SEATS_DEFAULT = 6;

export function attachRelay(server: Server, opts: RelayOptions = {}): Relay {
  const path = opts.path ?? RELAY_PATH;
  const log = opts.log ?? (() => {});
  const grace = opts.reconnectGraceMs ?? RECONNECT_GRACE_MS;
  const limits: RelayLimits = { ...DEFAULT_LIMITS, ...opts.limits };
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_FRAME_BYTES });
  const rooms = new Map<string, Room>();
  let nextPeer = 1;

  // Sliding one-minute counters per IP.
  const connCount = new Map<string, number>();
  const hits = { creates: new Map<string, number[]>(), badJoins: new Map<string, number[]>() };
  const recent = (m: Map<string, number[]>, ip: string): number[] => {
    const now = Date.now();
    const list = (m.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
    m.set(ip, list);
    return list;
  };
  const record = (m: Map<string, number[]>, ip: string) => recent(m, ip).push(Date.now());
  const exceeded = (m: Map<string, number[]>, ip: string, limit: number) => limit > 0 && recent(m, ip).length >= limit;

  const clientIp = (req: IncomingMessage): string => {
    if (opts.trustProxy) {
      const fwd = req.headers['x-forwarded-for'];
      const first = (Array.isArray(fwd) ? fwd[0] : fwd)?.split(',')[0]?.trim();
      if (first) return first;
    }
    return req.socket.remoteAddress ?? 'unknown';
  };

  const onUpgrade = (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const url = new URL(req.url ?? '/', 'http://x');
    if (url.pathname !== path) {
      // Not ours (e.g. Vite HMR) — leave it for other listeners unless we own the whole server.
      if (opts.rejectOtherPaths) socket.destroy();
      return;
    }
    const ip = clientIp(req);
    if (limits.connections > 0 && (connCount.get(ip) ?? 0) >= limits.connections) {
      socket.write('HTTP/1.1 429 Too Many Requests\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req, ip));
  };
  server.on('upgrade', onUpgrade);

  const send = (p: Peer, ev: RelayEvent) => {
    if (p.ws.readyState === WebSocket.OPEN) p.ws.send(JSON.stringify(ev));
  };

  const newCode = (): string => {
    for (let tries = 0; tries < 1000; tries++) {
      let c = '';
      for (let i = 0; i < ROOM_CODE_LENGTH; i++) c += ROOM_CODE_ALPHABET[Math.floor(Math.random() * ROOM_CODE_ALPHABET.length)];
      if (!rooms.has(c)) return c;
    }
    throw new Error('no free room codes');
  };

  const applyMeta = (r: Room, m: RoomMeta | undefined) => {
    if (!m || typeof m !== 'object') return;
    if (m.visibility === 'public' || m.visibility === 'private') r.visibility = m.visibility;
    if (m.title !== undefined) r.title = cleanTitle(m.title);
    if (typeof m.season === 'string') r.season = cleanTitle(m.season);
    if (Number.isFinite(m.seats)) r.seats = Math.max(1, Math.min(12, Math.floor(m.seats!)));
    if (Number.isFinite(m.drivers)) r.drivers = Math.max(0, Math.min(r.seats, Math.floor(m.drivers!)));
    if (m.state === 'lobby' || m.state === 'placing' || m.state === 'match') r.state = m.state;
    if (typeof m.bots === 'boolean') r.bots = m.bots;
  };

  const listing = (): RoomListing[] => {
    const out: RoomListing[] = [];
    for (const r of rooms.values()) {
      if (r.visibility !== 'public') continue;
      out.push({
        code: r.code,
        title: r.title || `${r.host.name}'s room`,
        host: r.host.name,
        season: r.season,
        players: r.peers.size,
        max: MAX_PEERS_PER_ROOM,
        drivers: r.drivers,
        seats: r.seats,
        state: r.state,
        bots: r.bots,
      });
    }
    // Joinable rooms first, then the busiest.
    const open = (x: RoomListing) => (x.state === 'lobby' && x.players < x.max ? 0 : 1);
    out.sort((a, b) => open(a) - open(b) || b.players - a.players || a.code.localeCompare(b.code));
    return out.slice(0, MAX_LISTED_ROOMS);
  };

  /** Remove a peer for good (left, kicked, or its reconnect window ran out). */
  const leave = (p: Peer, reason: string) => {
    if (p.lostTimer) clearTimeout(p.lostTimer);
    p.lostTimer = null;
    const room = p.room;
    if (!room) return;
    p.room = null;
    room.peers.delete(p.id);
    if (room.host === p) {
      rooms.delete(room.code);
      for (const o of room.peers.values()) {
        if (o.lostTimer) clearTimeout(o.lostTimer);
        o.lostTimer = null;
        o.room = null;
        send(o, { op: 'room-closed', reason });
      }
      log(`room ${room.code} closed (${reason})`);
    } else {
      send(room.host, { op: 'peer-left', peerId: p.id });
    }
  };

  /** The socket died without a deliberate leave: hold the seat for a while. */
  const drop = (p: Peer) => {
    const room = p.room;
    if (!room || p.lost) return;
    if (grace <= 0) return leave(p, 'host left');
    p.lost = true;
    if (room.host === p) {
      for (const o of room.peers.values()) if (o !== p) send(o, { op: 'host-lost' });
    } else send(room.host, { op: 'peer-lost', peerId: p.id });
    p.lostTimer = setTimeout(() => {
      p.lostTimer = null;
      leave(p, room.host === p ? 'host left' : 'left');
    }, grace);
  };

  wss.on('connection', (ws: WebSocket, _req: IncomingMessage, ip: string) => {
    connCount.set(ip, (connCount.get(ip) ?? 0) + 1);
    let peer: Peer = { id: `p${nextPeer++}`, name: 'Player', ws, room: null, token: randomUUID(), ip, lost: false, lostTimer: null };
    const alive = ws as WebSocket & { __alive?: boolean };
    alive.__alive = true;
    ws.on('pong', () => (alive.__alive = true));

    const badJoin = (message: string) => {
      record(hits.badJoins, ip);
      send(peer, { op: 'error', message });
    };
    const joinBlocked = (): boolean => {
      if (!exceeded(hits.badJoins, ip, limits.badJoins)) return false;
      send(peer, { op: 'error', message: 'Too many attempts — wait a minute and try again' });
      return true;
    };

    ws.on('message', (raw: RawData, isBinary: boolean) => {
      const room = peer.room;
      if (isBinary) {
        // Only the host streams binary (snapshots) → every other peer in the room. A peer whose link can't
        // keep up skips frames rather than queueing seconds of stale ones; it asks the host for a keyframe.
        if (!room || room.host !== peer) return;
        for (const o of room.peers.values()) {
          if (o === peer || o.ws.readyState !== WebSocket.OPEN) continue;
          if (o.ws.bufferedAmount > MAX_BINARY_BACKLOG) continue;
          o.ws.send(raw, { binary: true });
        }
        return;
      }
      let req: RelayRequest;
      try {
        req = JSON.parse(raw.toString()) as RelayRequest;
      } catch {
        return;
      }
      if (!req || typeof req !== 'object') return;
      switch (req.op) {
        case 'create': {
          if (exceeded(hits.creates, ip, limits.creates)) return send(peer, { op: 'error', message: 'You are creating rooms too quickly — wait a moment' });
          record(hits.creates, ip);
          leave(peer, 'host left');
          peer.name = cleanName(req.name);
          const code = newCode();
          const r: Room = {
            code,
            host: peer,
            peers: new Map([[peer.id, peer]]),
            visibility: 'private',
            title: '',
            season: '',
            drivers: 0,
            seats: SEATS_DEFAULT,
            state: 'lobby',
            bots: false,
            banned: new Set(),
          };
          applyMeta(r, req.meta);
          rooms.set(code, r);
          peer.room = r;
          send(peer, { op: 'created', room: code, peerId: peer.id, token: peer.token });
          log(`room ${code} created by ${peer.name} (${r.visibility})`);
          break;
        }
        case 'join': {
          if (joinBlocked()) return;
          const code = normalizeRoomCode(String(req.room ?? ''));
          const r = rooms.get(code);
          if (!r) return badJoin(`Room ${code || '?'} not found`);
          if (r.banned.has(ip)) return badJoin('You were removed from this room');
          if (r.peers.size >= MAX_PEERS_PER_ROOM) return send(peer, { op: 'error', message: `Room ${code} is full` });
          leave(peer, 'host left');
          peer.name = cleanName(req.name);
          r.peers.set(peer.id, peer);
          peer.room = r;
          send(peer, { op: 'joined', room: code, peerId: peer.id, hostId: r.host.id, token: peer.token });
          send(r.host, { op: 'peer-joined', peerId: peer.id, name: peer.name });
          break;
        }
        case 'rejoin': {
          if (joinBlocked()) return;
          const r = rooms.get(normalizeRoomCode(String(req.room ?? '')));
          const ghost = r && [...r.peers.values()].find((p) => p.lost && p.token === req.token);
          if (!r || !ghost) return badJoin('That room is no longer available');
          if (ghost.lostTimer) clearTimeout(ghost.lostTimer);
          ghost.lostTimer = null;
          ghost.lost = false;
          const old = ghost.ws;
          ghost.ws = ws;
          ghost.ip = ip;
          if (old !== ws) old.terminate();
          peer = ghost;
          send(peer, { op: 'joined', room: r.code, peerId: peer.id, hostId: r.host.id, token: peer.token, resumed: true });
          if (r.host === peer) {
            for (const o of r.peers.values()) if (o !== peer) send(o, { op: 'host-back' });
          } else send(r.host, { op: 'peer-back', peerId: peer.id });
          break;
        }
        case 'list':
          send(peer, { op: 'rooms', rooms: listing() });
          break;
        case 'meta':
          if (room && room.host === peer) applyMeta(room, req.meta);
          break;
        case 'kick': {
          if (!room || room.host !== peer) return;
          const t = room.peers.get(String(req.peerId));
          if (!t || t === peer) return;
          room.banned.add(t.ip);
          send(t, { op: 'room-closed', reason: 'You were removed by the host' });
          leave(t, 'removed');
          break;
        }
        case 'send': {
          if (!room) return;
          const ev: RelayEvent = { op: 'msg', from: peer.id, data: req.data };
          if (peer !== room.host) return send(room.host, ev);
          if (req.to !== undefined) {
            const t = room.peers.get(String(req.to));
            if (t && t !== peer) send(t, ev);
            return;
          }
          const text = JSON.stringify(ev);
          for (const o of room.peers.values()) if (o !== peer && o.ws.readyState === WebSocket.OPEN) o.ws.send(text);
          break;
        }
      }
    });

    ws.on('close', (code: number) => {
      const n = (connCount.get(ip) ?? 1) - 1;
      if (n > 0) connCount.set(ip, n);
      else connCount.delete(ip);
      if (peer.ws !== ws) return; // superseded by a rejoin
      if (code === CLOSE_LEAVE) leave(peer, 'host left');
      else drop(peer);
    });
    ws.on('error', () => ws.terminate());
  });

  const ping = setInterval(() => {
    for (const ws of wss.clients) {
      const w = ws as WebSocket & { __alive?: boolean };
      if (w.__alive === false) {
        ws.terminate();
        continue;
      }
      w.__alive = false;
      ws.ping();
    }
    for (const m of Object.values(hits)) for (const ip of [...m.keys()]) if (!recent(m, ip).length) m.delete(ip);
  }, opts.pingInterval ?? 20000);

  return {
    wss,
    roomCount: () => rooms.size,
    publicRoomCount: () => listing().length,
    close: () =>
      new Promise<void>((resolve) => {
        clearInterval(ping);
        server.off('upgrade', onUpgrade);
        for (const r of rooms.values()) for (const p of r.peers.values()) if (p.lostTimer) clearTimeout(p.lostTimer);
        rooms.clear();
        for (const ws of wss.clients) ws.terminate();
        wss.close(() => resolve());
      }),
  };
}
