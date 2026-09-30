import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer, WebSocket, type RawData } from 'ws';
import {
  cleanName,
  MAX_BINARY_BACKLOG,
  MAX_FRAME_BYTES,
  MAX_PEERS_PER_ROOM,
  normalizeRoomCode,
  RELAY_PATH,
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  type RelayEvent,
  type RelayRequest,
} from '../src/engine/net/relayProtocol.ts';

/**
 * Game-agnostic WebSocket relay: rooms, peer ids, fan-out. The host's browser is the authority; the
 * relay never inspects game data. Attach it to any Node http.Server (Vite dev server, the standalone
 * server in server/index.ts, or a test server).
 */

interface Peer {
  id: string;
  name: string;
  ws: WebSocket;
  room: Room | null;
}

interface Room {
  code: string;
  host: Peer;
  peers: Map<string, Peer>;
}

export interface Relay {
  readonly wss: WebSocketServer;
  /** Number of open rooms (for tests / health). */
  roomCount(): number;
  close(): Promise<void>;
}

export interface RelayOptions {
  path?: string;
  log?: (msg: string) => void;
  /** Destroy upgrade requests for other paths (standalone server). Leave false when sharing a server (Vite HMR). */
  rejectOtherPaths?: boolean;
  /** Keep-alive ping interval (ms). */
  pingInterval?: number;
}

export function attachRelay(server: Server, opts: RelayOptions = {}): Relay {
  const path = opts.path ?? RELAY_PATH;
  const log = opts.log ?? (() => {});
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_FRAME_BYTES });
  const rooms = new Map<string, Room>();
  let nextPeer = 1;

  const onUpgrade = (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const url = new URL(req.url ?? '/', 'http://x');
    if (url.pathname !== path) {
      // Not ours (e.g. Vite HMR) — leave it for other listeners unless we own the whole server.
      if (opts.rejectOtherPaths) socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
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

  const leave = (p: Peer, reason: string) => {
    const room = p.room;
    if (!room) return;
    p.room = null;
    room.peers.delete(p.id);
    if (room.host === p) {
      rooms.delete(room.code);
      for (const o of room.peers.values()) {
        o.room = null;
        send(o, { op: 'room-closed', reason });
      }
      log(`room ${room.code} closed (${reason})`);
    } else {
      send(room.host, { op: 'peer-left', peerId: p.id });
    }
  };

  wss.on('connection', (ws: WebSocket) => {
    const peer: Peer = { id: `p${nextPeer++}`, name: 'Player', ws, room: null };
    const alive = ws as WebSocket & { __alive?: boolean };
    alive.__alive = true;
    ws.on('pong', () => (alive.__alive = true));

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
          leave(peer, 'host left');
          peer.name = cleanName(req.name);
          const code = newCode();
          const r: Room = { code, host: peer, peers: new Map([[peer.id, peer]]) };
          rooms.set(code, r);
          peer.room = r;
          send(peer, { op: 'created', room: code, peerId: peer.id });
          log(`room ${code} created by ${peer.name}`);
          break;
        }
        case 'join': {
          const code = normalizeRoomCode(String(req.room ?? ''));
          const r = rooms.get(code);
          if (!r) return send(peer, { op: 'error', message: `Room ${code || '?'} not found` });
          if (r.peers.size >= MAX_PEERS_PER_ROOM) return send(peer, { op: 'error', message: `Room ${code} is full` });
          leave(peer, 'host left');
          peer.name = cleanName(req.name);
          r.peers.set(peer.id, peer);
          peer.room = r;
          send(peer, { op: 'joined', room: code, peerId: peer.id, hostId: r.host.id });
          send(r.host, { op: 'peer-joined', peerId: peer.id, name: peer.name });
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

    ws.on('close', () => leave(peer, 'host left'));
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
  }, opts.pingInterval ?? 20000);

  return {
    wss,
    roomCount: () => rooms.size,
    close: () =>
      new Promise<void>((resolve) => {
        clearInterval(ping);
        server.off('upgrade', onUpgrade);
        for (const ws of wss.clients) ws.terminate();
        wss.close(() => resolve());
      }),
  };
}
