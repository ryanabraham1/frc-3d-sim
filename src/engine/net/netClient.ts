import { Emitter } from '../core/events';
import { RELAY_PATH, type RelayEvent, type RelayRequest } from './relayProtocol';

export interface NetClientEvents {
  /** JSON game message from another peer (clients only ever hear from the host). */
  msg: { from: string; data: unknown };
  /** Binary frame from the host (snapshots). */
  binary: ArrayBuffer;
  'peer-joined': { peerId: string; name: string };
  'peer-left': { peerId: string };
  /** Connection or room ended. */
  closed: { reason: string };
}

/**
 * Browser WebSocket client for the relay (server/relay.ts). One instance lives across menu ↔ match so
 * a lobby survives between matches.
 */
export class NetClient extends Emitter<NetClientEvents> {
  peerId = '';
  hostId = '';
  room = '';
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

  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN && !!this.room;
  }

  /** http(s) health URL for a relay ws(s) URL: wss://host/ws → https://host/healthz. */
  static healthUrl(wsUrl: string): string {
    const u = new URL(wsUrl);
    u.protocol = u.protocol === 'wss:' ? 'https:' : 'http:';
    u.pathname = '/healthz';
    u.search = '';
    return u.toString();
  }

  async connect(url: string, timeoutMs = 15000): Promise<void> {
    this.close();
    this.closedReason = null;
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
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      const reason = this.closedReason ?? 'Disconnected from relay';
      this.room = '';
      this.pending?.reject(new Error(reason));
      this.pending = null;
      this.emit('closed', { reason });
    };
    ws.onerror = null;
  }

  async create(name: string): Promise<void> {
    const ev = await this.request({ op: 'create', name });
    if (ev.op !== 'created') throw new Error('Unexpected relay reply');
    this.room = ev.room;
    this.peerId = ev.peerId;
    this.hostId = ev.peerId;
  }

  async join(room: string, name: string): Promise<void> {
    const ev = await this.request({ op: 'join', room, name });
    if (ev.op !== 'joined') throw new Error('Unexpected relay reply');
    this.room = ev.room;
    this.peerId = ev.peerId;
    this.hostId = ev.hostId;
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

  close(reason = 'Left the room'): void {
    const ws = this.ws;
    if (!ws) return;
    this.closedReason = reason;
    ws.close();
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
          this.pending.reject(new Error(ev.message));
          this.pending = null;
        }
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
      case 'room-closed':
        this.closedReason = ev.reason === 'host left' ? 'The host left — room closed' : ev.reason;
        this.room = '';
        this.ws?.close();
        break;
    }
  }
}
