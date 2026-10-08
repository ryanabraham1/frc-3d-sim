import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { WebSocketServer, WebSocket, RawData } from 'ws';
const OPEN = 1;
import { RankedService } from './ranked.ts';
import { createRankedStore, type RankedStore } from './rankedStore.ts';
import {
  cleanClientId,
  cleanName,
  cleanTitle,
  CLOSE_LEAVE,
  MAX_BINARY_BACKLOG,
  MAX_LISTED_ROOMS,
  MAX_PEERS_PER_ROOM,
  normalizeRoomCode,
  RECONNECT_GRACE_MS,
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
 * relay never inspects game data. Used by the Node HTTP and Cloudflare WebSocket adapters.
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
  /** Per-tab id from the client (empty if it sent none). */
  clientId: string;
  /** Membership events a dropped connection missed; replayed when it resumes. */
  missed: RelayEvent[];
  /** Connection dropped; waiting for a `rejoin` until `lostTimer` fires. */
  lost: boolean;
  directPeers: Set<string>;
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
  checkpoint?: unknown;
  ranked?: boolean;
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
  /** Workers handle protocol pings automatically. */
  serverPings?: boolean;
  /** Per-IP limits; 0 disables a limit. */
  limits?: Partial<RelayLimits>;
  /** Ranked rating storage (default: Supabase when configured by env, else in memory). */
  rankedStore?: RankedStore;
  /** Test hooks for the ranked service. */
  ranked?: { tickMs?: number; reportWindowMs?: number };
}

export interface RelayLimits {
  /** Simultaneous sockets per IP. */
  connections: number;
  /** Rooms created per IP per minute. */
  creates: number;
  /** Failed joins/rejoins per IP per minute (stops guessing private room codes). */
  badJoins: number;
  /** Ranked queue requests per IP per minute. */
  ranked: number;
  /** Ranked profile/leaderboard reads per IP per minute (the Ranked page polls; several browsers can share an IP). */
  rankedReads: number;
}

const DEFAULT_LIMITS: RelayLimits = { connections: 24, creates: 8, badJoins: 20, ranked: 30, rankedReads: 240 };
const WINDOW_MS = 60_000;
const SEATS_DEFAULT = 6;

export function createRelayCore(wss: WebSocketServer, opts: RelayOptions = {}): Relay {
  const log = opts.log ?? (() => {});
  const grace = opts.reconnectGraceMs ?? RECONNECT_GRACE_MS;
  const limits: RelayLimits = { ...DEFAULT_LIMITS, ...opts.limits };
  const rooms = new Map<string, Room>();
  let nextPeer = 1;

  // Sliding one-minute counters per IP.
  const hits = { creates: new Map<string, number[]>(), badJoins: new Map<string, number[]>(), ranked: new Map<string, number[]>(), rankedReads: new Map<string, number[]>() };
  const byId = new Map<string, Peer>();
  const recent = (m: Map<string, number[]>, ip: string): number[] => {
    const now = Date.now();
    const list = (m.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
    m.set(ip, list);
    return list;
  };
  const record = (m: Map<string, number[]>, ip: string) => recent(m, ip).push(Date.now());
  const exceeded = (m: Map<string, number[]>, ip: string, limit: number) => limit > 0 && recent(m, ip).length >= limit;

  const MEMBERSHIP = new Set(['peer-joined', 'peer-left', 'peer-lost', 'peer-back', 'host-changed']);
  const send = (p: Peer, ev: RelayEvent) => {
    if (p.ws.readyState === OPEN) p.ws.send(JSON.stringify(ev));
    // A host that is briefly offline must still learn who came and went while it was away.
    else if (p.lost && MEMBERSHIP.has(ev.op) && p.missed.length < 100) p.missed.push(ev);
  };

  const newCode = (): string => {
    for (let tries = 0; tries < 1000; tries++) {
      let c = '';
      for (let i = 0; i < ROOM_CODE_LENGTH; i++) c += ROOM_CODE_ALPHABET[Math.floor(Math.random() * ROOM_CODE_ALPHABET.length)];
      if (!rooms.has(c)) return c;
    }
    throw new Error('no free room codes');
  };

  const store = opts.rankedStore ?? createRankedStore();
  const ranked = new RankedService({
    store,
    log,
    tickMs: opts.ranked?.tickMs,
    reportWindowMs: opts.ranked?.reportWindowMs,
    send: (id, ev) => {
      const p = byId.get(id);
      if (p) send(p, ev);
    },
    isOpen: (id) => byId.get(id)?.ws.readyState === OPEN,
    seat: (hostId, memberIds) => {
      const host = byId.get(hostId);
      const members = memberIds.map((id) => byId.get(id));
      if (!host || members.some((p) => !p || p.ws.readyState !== OPEN)) return null;
      const code = newCode();
      const r: Room = {
        code,
        host,
        peers: new Map(),
        visibility: 'private',
        title: 'Ranked match',
        ranked: true,
        season: '',
        drivers: members.length,
        seats: 6,
        state: 'lobby',
        bots: false,
        banned: new Set(),
      };
      const tokens = new Map<string, string>();
      for (const p of members as Peer[]) {
        leave(p, 'host left');
        r.peers.set(p.id, p);
        p.room = r;
        tokens.set(p.id, p.token);
      }
      rooms.set(code, r);
      return { code, tokens };
    },
  });

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
    ranked.peerLeft(p.id);
    if (room.host === p) {
      const successor = room.checkpoint ? [...room.peers.values()].find(o => !o.lost && o.ws.readyState === OPEN) : undefined;
      if (successor) {
        room.host = successor;
        const checkpoint = room.checkpoint;
        const peers = [...room.peers.values()].map(o => ({ peerId: o.id, name: o.name }));
        for (const o of room.peers.values()) send(o, { op: 'host-changed', hostId: successor.id, previousHostId: p.id, peers,
          ...(o === successor ? { checkpoint } : {}) });
        log(`room ${room.code} host changed to ${successor.id}`);
      } else {
        ranked.roomClosed(room.code);
        rooms.delete(room.code);
        for (const o of room.peers.values()) {
          if (o.lostTimer) clearTimeout(o.lostTimer);
          o.lostTimer = null;
          o.room = null;
          send(o, { op: 'room-closed', reason });
        }
        log(`room ${room.code} closed (${reason})`);
      }
    } else {
      send(room.host, { op: 'peer-left', peerId: p.id });
    }
    if (p.ws.readyState !== OPEN) byId.delete(p.id);
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

  /** The same tab joining again replaces the seat its previous page left behind (dropped but not yet expired). */
  const replaceStale = (p: Peer, target?: Room) => {
    if (!p.clientId) return;
    for (const o of [...byId.values()]) {
      if (o === p || o.clientId !== p.clientId || !o.room) continue;
      const inTarget = target && o.room === target;
      if (!o.lost && !inTarget) continue; // a live seat elsewhere is left alone (leave() handles moving rooms)
      if (o.room.host === o) continue; // never evict a room's host this way
      send(o, { op: 'room-closed', reason: 'You joined again from this tab' });
      leave(o, 'replaced');
    }
  };

  wss.on('connection', (ws: WebSocket, _req: IncomingMessage, ip: string) => {
    let peer: Peer = { id: `p${nextPeer++}`, name: 'Player', ws, room: null, token: randomUUID(), ip, clientId: '', missed: [], lost: false, directPeers: new Set(), lostTimer: null };
    byId.set(peer.id, peer);
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
          if (o === peer || peer.directPeers.has(o.id) || o.ws.readyState !== OPEN) continue;
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
        case 'ping':
          if (typeof req.id === 'number' && Number.isFinite(req.id)) send(peer, { op: 'pong', id: req.id });
          break;
        case 'checkpoint':
          if (room && !room.ranked && room.host === peer && req.data && typeof req.data === 'object') room.checkpoint = req.data;
          break;
        case 'create': {
          if (exceeded(hits.creates, ip, limits.creates)) return send(peer, { op: 'error', message: 'You are creating rooms too quickly — wait a moment' });
          record(hits.creates, ip);
          leave(peer, 'host left');
          peer.name = cleanName(req.name);
          peer.clientId = cleanClientId(req.client);
          replaceStale(peer);
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
          peer.clientId = cleanClientId(req.client);
          replaceStale(peer, r);
          r.peers.set(peer.id, peer);
          peer.room = r;
          send(peer, { op: 'joined', room: code, peerId: peer.id, hostId: r.host.id, token: peer.token });
          send(r.host, { op: 'peer-joined', peerId: peer.id, name: peer.name });
          break;
        }
        case 'rejoin': {
          if (joinBlocked()) return;
          const r = rooms.get(normalizeRoomCode(String(req.room ?? '')));
          // A half-open old socket may not have failed server-side yet. The secret authenticates replacement.
          const ghost = r && [...r.peers.values()].find((p) => p.token === req.token);
          if (!r || !ghost) return badJoin('That room is no longer available');
          if (ghost.lostTimer) clearTimeout(ghost.lostTimer);
          ghost.lostTimer = null;
          ghost.lost = false;
          ghost.directPeers.clear();
          const old = ghost.ws;
          ghost.ws = ws;
          ghost.ip = ip;
          if (old !== ws) old.terminate();
          byId.delete(peer.id); // the placeholder made for this socket
          peer = ghost;
          send(peer, { op: 'joined', room: r.code, peerId: peer.id, hostId: r.host.id, token: peer.token, resumed: true });
          for (const ev of peer.missed.splice(0)) send(peer, ev);
          if (r.host === peer) {
            for (const o of r.peers.values()) if (o !== peer) send(o, { op: 'host-back' });
          } else send(r.host, { op: 'peer-back', peerId: peer.id });
          break;
        }
        case 'forget': {
          const r = rooms.get(normalizeRoomCode(String(req.room ?? '')));
          const ghost = r && [...r.peers.values()].find((p) => p.lost && p.token === req.token && r.host !== p);
          if (ghost) leave(ghost, 'left');
          break;
        }
        case 'list':
          send(peer, { op: 'rooms', rooms: listing() });
          break;
        case 'queue':
        case 'profile':
        case 'leaderboard':
          {
            const bucket = req.op === 'queue' ? hits.ranked : hits.rankedReads;
            const limit = req.op === 'queue' ? limits.ranked : limits.rankedReads;
            if (exceeded(bucket, ip, limit)) return send(peer, { op: 'error', message: req.op === 'queue' ? 'Too many searches — wait a moment' : 'Too many ranked requests — slow down' });
            record(bucket, ip);
          }
          if (req.op === 'queue') {
            if (peer.room) return send(peer, { op: 'error', message: 'Leave your room before searching for a ranked match' });
            void ranked.queue(peer.id, req.mode, req.name, req.secret);
          } else if (req.op === 'profile') void ranked.profile(peer.id, req.secret, req.name);
          else void ranked.leaderboard(peer.id, req.secret);
          break;
        case 'unqueue':
          ranked.unqueue(peer.id);
          break;
        case 'result':
          ranked.result(peer.id, req);
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
        case 'snapshot-route':
          if (room?.host === peer && Array.isArray(req.exclude)) peer.directPeers = new Set(req.exclude.filter(id => typeof id === 'string' && room.peers.has(id)));
          break;
        case 'signal': {
          if (!room) return;
          const target = room.peers.get(String(req.to));
          if (target && target !== peer && (peer === room.host || target === room.host)) send(target, { op: 'signal', from: peer.id, data: req.data });
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
          for (const o of room.peers.values()) if (o !== peer && o.ws.readyState === OPEN) o.ws.send(text);
          break;
        }
      }
    });

    ws.on('close', (code: number) => {
      if (peer.ws !== ws) return; // superseded by a rejoin
      ranked.peerGone(peer.id);
      if (code === CLOSE_LEAVE) leave(peer, 'host left');
      else drop(peer);
      if (!peer.room) byId.delete(peer.id);
    });
    ws.on('error', () => ws.terminate());
  });

  const ping = setInterval(() => {
    for (const ws of opts.serverPings === false ? [] : wss.clients) {
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
        ranked.close();
        for (const r of rooms.values()) for (const p of r.peers.values()) if (p.lostTimer) clearTimeout(p.lostTimer);
        rooms.clear();
        for (const ws of wss.clients) ws.terminate();
        wss.close(() => resolve());
      }),
  };
}
