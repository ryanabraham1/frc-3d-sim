import { Emitter } from '../core/events';
import type { Outcome, RankedMode } from './ranked';
import { CLOSE_LEAVE, RECONNECT_GRACE_MS, RELAY_PATH, type RelayEvent, type RelayRequest, type RoomListing, type RoomMeta } from './relayProtocol';

type Ev<K extends RelayEvent['op']> = Omit<Extract<RelayEvent, { op: K }>, 'op'>;

export interface NetClientEvents {
  /** JSON game message from another peer (clients only ever hear from the host). */
  msg: { from: string; data: unknown };
  /** Binary frame from the host (snapshots). */
  binary: ArrayBuffer;
  'peer-joined': { peerId: string; name: string };
  'peer-left': { peerId: string };
  /** Host only: a client's connection dropped (it may come back). */
  'peer-lost': { peerId: string };
  /** Host only: a dropped client is back. */
  'peer-back': { peerId: string };
  /** Clients: the host's connection dropped / came back. */
  'host-lost': Record<string, never>;
  'host-back': Record<string, never>;
  /** Public room list (reply to `list()`). */
  rooms: { rooms: RoomListing[] };
  queued: Ev<'queued'>;
  'queue-status': Ev<'queue-status'>;
  unqueued: Ev<'unqueued'>;
  matched: Ev<'matched'>;
  profile: Ev<'profile'>;
  leaderboard: Ev<'leaderboard'>;
  rating: Ev<'rating'>;
  /** Relay error not tied to a pending create/join (e.g. a refused ranked search). */
  'relay-error': { message: string };
  /** Our connection dropped; trying to resume the same seat. */
  reconnecting: Record<string, never>;
  /** Resumed after a drop. */
  reconnected: Record<string, never>;
  /** Connection or room ended for good. */
  closed: { reason: string };
}

/** Thrown for an answer from the relay (as opposed to a network failure). */
class RelayError extends Error {}

/**
 * Browser WebSocket client for the relay (server/relay.ts). One instance lives across menu ↔ match so
 * a lobby survives between matches. A dropped connection is resumed automatically (same peer id) for up
 * to the relay's grace period.
 */
export class NetClient extends Emitter<NetClientEvents> {
  peerId = '';
  hostId = '';
  room = '';
  /** True while a dropped connection is being resumed. */
  reconnecting = false;
  private token = '';
  private connecting: Promise<void> | null = null;
  private url = '';
  private ws: WebSocket | null = null;
  private pending: { resolve: (e: RelayEvent) => void; reject: (err: Error) => void } | null = null;
  private closedReason: string | null = null;
  /**
   * Dev aid: simulated round-trip latency in ms (`?netlag=200` in the page URL). Half is added to each
   * direction; constant delay keeps ordering.
   */
  readonly lagMs: number = (() => {
    try {
      return Math.max(0, Number(new URLSearchParams(location.search).get('netlag')) || 0);
    } catch {
      return 0;
    }
  })();

  constructor() {
    super();
    // Closing the tab is a deliberate leave: don't make the room wait out the reconnect window.
    if (typeof window !== 'undefined') window.addEventListener('pagehide', () => this.ws?.close(CLOSE_LEAVE, 'leave'));
  }

  private later(fn: () => void): void {
    if (this.lagMs > 0) setTimeout(fn, this.lagMs / 2);
    else fn();
  }

  /** Relay URL: VITE_RELAY_URL if set at build time, else /ws on the page's own host. */
  static defaultUrl(): string {
    const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env?.VITE_RELAY_URL;
    if (env) return env;
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${location.host}${RELAY_PATH}`;
  }

  get isHost(): boolean {
    return !!this.peerId && this.peerId === this.hostId;
  }

  /** In a room with a live socket. */
  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN && !!this.room;
  }

  /** Socket open (in a room or not) — enough to ask for the room list. */
  get open(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  /** Check relay readiness using the same WebSocket transport as create/join. */
  static probe(url: string, timeoutMs = 30000): Promise<boolean> {
    return new Promise((resolve) => {
      let ws: WebSocket;
      try {
        ws = new WebSocket(url);
      } catch {
        resolve(false);
        return;
      }
      let settled = false;
      const finish = (ready: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        ws.onopen = ws.onerror = ws.onclose = null;
        try { ws.close(); } catch { /* already closed */ }
        resolve(ready);
      };
      const timer = setTimeout(() => finish(false), timeoutMs);
      ws.onopen = () => finish(true);
      ws.onerror = () => finish(false);
      ws.onclose = () => finish(false);
    });
  }

  /** Open a socket (replacing any existing one). */
  async connect(url: string, timeoutMs = 15000): Promise<void> {
    this.close();
    this.closedReason = null;
    this.url = url;
    await this.openSocket(url, timeoutMs);
  }

  /** Reuse the open socket if it is already on `url` and idle; otherwise connect (concurrent callers share one attempt). */
  ensureConnected(url: string): Promise<void> {
    if (this.open && this.url === url) return Promise.resolve();
    if (this.connecting && this.url === url) return this.connecting;
    const attempt = this.connect(url).finally(() => {
      if (this.connecting === attempt) this.connecting = null;
    });
    this.connecting = attempt;
    return attempt;
  }

  private async openSocket(url: string, timeoutMs: number): Promise<void> {
    const ws = new WebSocket(url);
    ws.binaryType = 'arraybuffer';
    this.ws = ws;
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`Could not reach relay at ${url}`)), timeoutMs);
      ws.onopen = () => {
        clearTimeout(t);
        resolve();
      };
      ws.onerror = () => {
        clearTimeout(t);
        reject(new Error(`Could not reach relay at ${url}`));
      };
    });
    ws.onmessage = (e) => this.later(() => this.onMessage(e));
    ws.onclose = () => this.onSocketClosed(ws);
    ws.onerror = null;
  }

  private onSocketClosed(ws: WebSocket): void {
    if (this.ws !== ws) return;
    this.ws = null;
    this.pending?.reject(new Error(this.closedReason ?? 'Disconnected from relay'));
    this.pending = null;
    // A drop while seated in a room is resumed in the background; anything else ends here.
    if (this.closedReason === null && this.room && this.token && !this.reconnecting) {
      void this.resume();
      return;
    }
    if (this.reconnecting) return;
    this.finish(this.closedReason ?? 'Disconnected from relay');
  }

  private finish(reason: string): void {
    this.room = '';
    this.token = '';
    this.reconnecting = false;
    this.emit('closed', { reason });
  }

  /** Retry `rejoin` with a short backoff until the relay's grace period runs out. */
  private async resume(): Promise<void> {
    this.reconnecting = true;
    this.emit('reconnecting', {});
    const deadline = performance.now() + RECONNECT_GRACE_MS - 2000;
    let delay = 400;
    while (this.closedReason === null && performance.now() < deadline) {
      try {
        await this.openSocket(this.url, 6000);
        const ev = await this.request({ op: 'rejoin', room: this.room, token: this.token });
        if (ev.op !== 'joined') throw new RelayError('Unexpected relay reply');
        this.hostId = ev.hostId;
        this.reconnecting = false;
        this.emit('reconnected', {});
        return;
      } catch (e) {
        if (e instanceof RelayError) break; // the room is gone — no point retrying
        this.ws?.close();
        this.ws = null;
        await new Promise((r) => setTimeout(r, delay));
        delay = Math.min(delay * 1.6, 3000);
      }
    }
    if (this.closedReason !== null) return; // the player left while we were retrying
    this.finish('Connection lost');
  }

  async create(name: string, meta?: RoomMeta): Promise<void> {
    const ev = await this.request({ op: 'create', name, meta });
    if (ev.op !== 'created') throw new Error('Unexpected relay reply');
    this.room = ev.room;
    this.peerId = ev.peerId;
    this.hostId = ev.peerId;
    this.token = ev.token;
  }

  async join(room: string, name: string): Promise<void> {
    const ev = await this.request({ op: 'join', room, name });
    if (ev.op !== 'joined') throw new Error('Unexpected relay reply');
    this.room = ev.room;
    this.peerId = ev.peerId;
    this.hostId = ev.hostId;
    this.token = ev.token;
  }

  /** Ask for the public room list; the answer arrives as a `rooms` event. */
  list(): void {
    this.raw({ op: 'list' });
  }

  queue(mode: RankedMode, name: string, secret: string): void {
    this.raw({ op: 'queue', mode, name, secret });
  }

  unqueue(): void {
    this.raw({ op: 'unqueue' });
  }

  profile(name: string, secret: string): void {
    this.raw({ op: 'profile', name, secret });
  }

  leaderboard(mode: RankedMode, secret?: string): void {
    this.raw({ op: 'leaderboard', mode, secret });
  }

  /** Ranked: report the match result as this player saw it. */
  reportResult(winner: Outcome, red: number, blue: number): void {
    this.raw({ op: 'result', winner, red, blue });
  }

  /** Host: publish what the public room list shows (and flip public/private). */
  setMeta(meta: RoomMeta): void {
    this.raw({ op: 'meta', meta });
  }

  /** Host: remove a peer from the room. */
  kick(peerId: string): void {
    this.raw({ op: 'kick', peerId });
  }

  /** Client → host, or host → `to` (all clients when omitted). */
  send(data: unknown, to?: string): void {
    this.raw({ op: 'send', data, to });
  }

  /** Host only: stream a binary frame to every client. */
  sendBinary(buf: ArrayBuffer): void {
    this.later(() => {
      if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(buf);
    });
  }

  /** Bytes queued but not yet sent (back-pressure hint for the host). */
  get buffered(): number {
    return this.ws?.bufferedAmount ?? 0;
  }

  /** Leave deliberately: the relay frees the seat at once instead of holding it for a reconnect. */
  close(reason = 'Left the room'): void {
    const ws = this.ws;
    this.closedReason = reason;
    // Mid-reconnect there is no live room to leave: stop retrying and report once.
    if (this.reconnecting) this.finish(reason);
    ws?.close(CLOSE_LEAVE, 'leave');
  }

  private raw(req: RelayRequest): void {
    const text = JSON.stringify(req);
    this.later(() => {
      if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(text);
    });
  }

  private request(req: RelayRequest): Promise<RelayEvent> {
    if (this.ws?.readyState !== WebSocket.OPEN) return Promise.reject(new Error('Not connected'));
    return new Promise<RelayEvent>((resolve, reject) => {
      this.pending = { resolve, reject };
      this.raw(req);
    });
  }

  private onMessage(e: MessageEvent): void {
    if (e.data instanceof ArrayBuffer) {
      this.emit('binary', e.data);
      return;
    }
    let ev: RelayEvent;
    try {
      ev = JSON.parse(String(e.data)) as RelayEvent;
    } catch {
      return;
    }
    switch (ev.op) {
      case 'created':
      case 'joined':
        this.pending?.resolve(ev);
        this.pending = null;
        break;
      case 'error':
        if (this.pending) {
          this.pending.reject(new RelayError(ev.message));
          this.pending = null;
        } else this.emit('relay-error', { message: ev.message });
        break;
      case 'queued':
      case 'queue-status':
      case 'unqueued':
      case 'profile':
      case 'leaderboard':
      case 'rating': {
        const { op, ...rest } = ev;
        (this.emit as (t: string, p: unknown) => void).call(this, op, rest);
        break;
      }
      case 'matched':
        this.room = ev.room;
        this.peerId = ev.peerId;
        this.hostId = ev.hostId;
        this.token = ev.token;
        this.emit('matched', ev);
        break;
      case 'rooms':
        this.emit('rooms', { rooms: ev.rooms });
        break;
      case 'msg':
        this.emit('msg', { from: ev.from, data: ev.data });
        break;
      case 'peer-joined':
        this.emit('peer-joined', { peerId: ev.peerId, name: ev.name });
        break;
      case 'peer-left':
        this.emit('peer-left', { peerId: ev.peerId });
        break;
      case 'peer-lost':
        this.emit('peer-lost', { peerId: ev.peerId });
        break;
      case 'peer-back':
        this.emit('peer-back', { peerId: ev.peerId });
        break;
      case 'host-lost':
        this.emit('host-lost', {});
        break;
      case 'host-back':
        this.emit('host-back', {});
        break;
      case 'room-closed':
        this.closedReason = ev.reason === 'host left' ? 'The host left — room closed' : ev.reason;
        this.room = '';
        this.ws?.close();
        break;
    }
  }
}
