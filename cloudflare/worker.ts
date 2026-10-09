import type { DurableObjectNamespace, Request, Response as WorkerResponse, WebSocket } from '@cloudflare/workers-types';
declare const Response: typeof import('@cloudflare/workers-types').Response;
declare const WebSocketPair: typeof import('@cloudflare/workers-types').WebSocketPair;
import { DurableObject } from 'cloudflare:workers';
import { EventEmitter } from 'node:events';
import { Buffer } from 'node:buffer';
import type { WebSocketServer } from 'ws';
import { createRelayCore, type Relay } from '../server/relayCore';
import { createRankedStore } from '../server/rankedStore';
import { MAX_FRAME_BYTES, RECONNECT_GRACE_MS } from '../src/engine/net/relayProtocol';

interface Env {
  RELAY: DurableObjectNamespace;
  /** Optional comma-separated frontend origins; unset allows public clients. */
  ALLOWED_ORIGINS?: string;
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_KEY?: string;
}

/** Adapt the Workers socket to the small ws interface used by the shared relay. */
class WorkerSocket extends EventEmitter {
  readonly socket: WebSocket;
  constructor(socket: WebSocket) {
    super();
    this.socket = socket;
    socket.binaryType = 'arraybuffer';
    socket.accept();
    socket.addEventListener('message', e => {
      const size = typeof e.data === 'string' ? Buffer.byteLength(e.data) : e.data.byteLength;
      if (size > MAX_FRAME_BYTES) { socket.close(1009, 'Frame too large'); return; }
      this.emit('message', typeof e.data === 'string' ? Buffer.from(e.data) : Buffer.from(e.data), typeof e.data !== 'string');
    });
    socket.addEventListener('close', e => this.emit('close', e.code));
    socket.addEventListener('error', () => this.emit('error'));
  }
  get readyState(): number { return this.socket.readyState; }
  // Workers do not expose bufferedAmount. The browser sender bounds its own backlog.
  get bufferedAmount(): number { return 0; }
  send(data: string | ArrayBuffer | Uint8Array): void {
    if (this.readyState === 1) this.socket.send(data);
  }
  terminate(): void { try { this.socket.close(1011, 'Connection ended'); } catch { /* already closed */ } }
}

class WorkerSockets extends EventEmitter {
  readonly clients = new Set<WorkerSocket>();
  close(done: () => void): void { done(); }
}

/** One shared coordinator preserves public discovery and cross-room ranked matchmaking. */
export class RelayCoordinator extends DurableObject<Env> {
  private hub: WorkerSockets | null = null;
  private relay: Relay | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;

  async fetch(request: Request): Promise<WorkerResponse> {
    const path = new URL(request.url).pathname;
    if (path === '/healthz') return Response.json({ ok: true, rooms: this.relay?.roomCount() ?? 0, peers: this.hub?.clients.size ?? 0 });
    if (path !== '/ws') return new Response('Not found', { status: 404 });
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return new Response('WebSocket required', { status: 426 });
    const origin = request.headers.get('Origin');
    const allowed = this.env.ALLOWED_ORIGINS?.split(',').map(s => s.trim()).filter(Boolean);
    if (allowed?.length && (!origin || !allowed.includes(origin))) return new Response('Origin not allowed', { status: 403 });
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
    if (!this.hub) {
      this.hub = new WorkerSockets();
      this.relay = createRelayCore(this.hub as unknown as WebSocketServer, {
        serverPings: false,
        log: (msg: string) => console.log(msg),
        rankedStore: createRankedStore({ SUPABASE_URL: this.env.SUPABASE_URL, SUPABASE_SERVICE_KEY: this.env.SUPABASE_SERVICE_KEY }),
      });
    }
    const hub = this.hub;
    const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';
    if (hub.clients.size >= 200) return new Response('Relay is full', { status: 503 });
    if ([...hub.clients].filter(s => (s as WorkerSocket & { ip?: string }).ip === ip).length >= 24) return new Response('Too many connections', { status: 429 });
    const pair = new WebSocketPair();
    const socket = new WorkerSocket(pair[1]);
    Object.assign(socket, { ip });
    hub.clients.add(socket);
    socket.once('close', () => {
      hub.clients.delete(socket);
      if (!hub.clients.size) this.idleTimer = setTimeout(() => {
        if (hub.clients.size || this.hub !== hub) return;
        void this.relay?.close();
        this.relay = null;
        this.hub = null;
        this.idleTimer = null;
      }, RECONNECT_GRACE_MS + 1000);
    });
    hub.emit('connection', socket, undefined, ip);
    return new Response(null, { status: 101, webSocket: pair[0] });
  }
}

export default {
  fetch(request: Request, env: Env): Promise<WorkerResponse> {
    return env.RELAY.get(env.RELAY.idFromName('public-relay-v1')).fetch(request);
  },
};
