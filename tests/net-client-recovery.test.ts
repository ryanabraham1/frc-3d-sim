import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { iceUrl, NetClient } from '../src/engine/net/netClient';

class Socket {
  static OPEN = 1;
  static CLOSED = 3;
  static instances: Socket[] = [];
  readyState = 0;
  binaryType = '';
  bufferedAmount = 0;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  constructor(_url: string) { Socket.instances.push(this); }
  open() { this.readyState = 1; this.onopen?.(); }
  send(data: string) { this.sent.push(data); }
  close() { this.readyState = 3; this.onclose?.(); }
  message(data: unknown) { this.onmessage?.({ data: JSON.stringify(data) } as MessageEvent); }
}
let client: NetClient;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'performance'] });
  vi.stubGlobal('WebSocket', Socket);
  vi.stubGlobal('sessionStorage', undefined);
  vi.stubGlobal('location', { search: '' });
  vi.stubGlobal('fetch', () => Promise.reject(new Error('offline')));
  Socket.instances = [];
  client = new NetClient();
});
afterEach(() => { client.close(); vi.useRealTimers(); vi.unstubAllGlobals(); });
async function open() {
  const connecting = client.connect('ws://test/ws');
  Socket.instances.at(-1)!.open();
  await connecting;
  return Socket.instances.at(-1)!;
}
async function seated() {
  const ws = await open();
  const creating = client.create('Host');
  ws.message({ op: 'created', room: 'ABCD', peerId: 'host', token: 'secret' });
  await creating;
  return ws;
}

describe('connection recovery', () => {
  it('closes a socket that never opens instead of leaving a late connection alive', async () => {
    const connecting = client.connect('ws://test/ws', 100);
    const rejected = expect(connecting).rejects.toThrow('Could not reach relay');
    await vi.advanceTimersByTimeAsync(100);
    await rejected;
    expect(Socket.instances[0].readyState).toBe(Socket.CLOSED);
    expect(client.open).toBe(false);
  });

  it('bounds requests when an open relay never answers', async () => {
    await open();
    const rejected = expect(client.create('Host')).rejects.toThrow('Relay response timed out');
    await vi.advanceTimersByTimeAsync(6000);
    await rejected;
  });

  it('detects half-open connections and resumes the same seat', async () => {
    const ws = await seated();
    await vi.advanceTimersByTimeAsync(12000);
    expect(ws.readyState).toBe(Socket.CLOSED);
    expect(client.reconnecting).toBe(true);
    const retry = Socket.instances.at(-1)!;
    retry.open();
    await vi.advanceTimersByTimeAsync(0);
    expect(retry.sent.map(s => JSON.parse(s))).toContainEqual({ op: 'rejoin', room: 'ABCD', token: 'secret' });
    retry.message({ op: 'joined', room: 'ABCD', peerId: 'host', hostId: 'host', token: 'secret', resumed: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(client.reconnecting).toBe(false);
    expect(client.connected).toBe(true);
    expect(client.peerId).toBe('host');
  });

  it('leaving during an attempted reconnect cannot close a new connection', async () => {
    const ws = await seated();
    ws.close(); // starts a reconnect, still opening
    const retry = Socket.instances.at(-1)!;
    client.close();
    const connecting = client.connect('ws://new-room/ws');
    const fresh = Socket.instances.at(-1)!;
    fresh.open();
    await connecting;
    await vi.advanceTimersByTimeAsync(5000);
    expect(retry.readyState).toBe(Socket.CLOSED);
    expect(fresh.readyState).toBe(Socket.OPEN);
    expect(client.open).toBe(true);
  });
});

it('does not replay delayed commands or messages into a new socket', async () => {
  client.close();
  vi.stubGlobal('location', { search: '?netlag=200' });
  client = new NetClient();
  const old = await open();
  const received: unknown[] = [];
  client.on('msg', msg => received.push(msg));
  old.message({ op: 'msg', from: 'old-host', data: { t: 'to-lobby' } });
  client.send({ t: 'cmd', s: 1 });
  client.close();
  const fresh = await open();
  await vi.advanceTimersByTimeAsync(150);
  expect(received).toHaveLength(0);
  expect(fresh.sent.map(s => JSON.parse(s)).some(s => s.op === 'send')).toBe(false);
});

it('measures both directions of the artificial latency in relay RTT', async () => {
  client.close();
  vi.stubGlobal('location', { search: '?netlag=200' });
  client = new NetClient();
  const ws = await open();
  await vi.advanceTimersByTimeAsync(2100);
  expect(ws.sent.map(s => JSON.parse(s))).toContainEqual({ op: 'ping', id: 1 });
  ws.message({ op: 'pong', id: 1 });
  await vi.advanceTimersByTimeAsync(100);
  expect(client.rttMs).toBe(200);
});

class Channel {
  readyState = 'connecting';
  binaryType = '';
  bufferedAmount = 0;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  send() {}
  close() { this.readyState = 'closed'; }
  open() { this.readyState = 'open'; this.onopen?.(); }
}
class PC {
  static instances: PC[] = [];
  connectionState = 'new';
  localDescription: { toJSON: () => unknown } | null = null;
  onicecandidate: unknown = null;
  onconnectionstatechange: (() => void) | null = null;
  ondatachannel: unknown = null;
  channels: Channel[] = [];
  constructor(public config: RTCConfiguration) { PC.instances.push(this); }
  createDataChannel() { const c = new Channel(); this.channels.push(c); return c; }
  async createOffer() { return { type: 'offer', sdp: 'x' }; }
  async setLocalDescription(d: unknown) { this.localDescription = { toJSON: () => d }; }
  close() { this.connectionState = 'closed'; }
  state(s: string) { this.connectionState = s; this.onconnectionstatechange?.(); }
}

describe('direct links', () => {
  beforeEach(() => { PC.instances = []; vi.stubGlobal('RTCPeerConnection', PC); });

  it('relay backlog only holds snapshots while a peer depends on the relay', () => {
    const client = new NetClient() as unknown as { peers: Set<string>; direct: { isOpen(p: string): boolean }; ws: { bufferedAmount: number }; relaySnapshotBacklog: number };
    client.ws = { bufferedAmount: 70000 };
    client.peers.add('a');
    client.peers.add('b');
    client.direct.isOpen = (p) => p === 'a';
    expect(client.relaySnapshotBacklog).toBe(70000);
    client.direct.isOpen = () => true;
    expect(client.relaySnapshotBacklog).toBe(0);
  });

  it('maps the relay socket to its ICE endpoint', () => {
    expect(iceUrl('wss://relay.example.dev/ws')).toBe('https://relay.example.dev/ice');
    expect(iceUrl('ws://localhost:5173/ws?x=1')).toBe('http://localhost:5173/ice');
  });

  it('host offers again with backoff after a direct link fails, and rides out a brief disconnect', async () => {
    client = new NetClient();
    const ws = await seated();
    // The relay stays alive throughout (its heartbeat closes a silent socket after 10 s).
    const wait = async (ms: number) => { for (; ms > 0; ms -= 1000) { ws.message({ op: 'pong', id: -1 }); await vi.advanceTimersByTimeAsync(Math.min(1000, ms)); } };
    ws.message({ op: 'peer-joined', peerId: 'guest', name: 'G' });
    await vi.advanceTimersByTimeAsync(0);
    expect(PC.instances).toHaveLength(1);
    const first = PC.instances[0];
    first.channels.forEach(c => c.open());
    expect(client.directPeerCount).toBe(1);
    // Wi-Fi blip: 'disconnected' that recovers keeps the link.
    first.state('disconnected');
    await wait(3000);
    first.state('connected');
    await wait(10000);
    expect(client.directPeerCount).toBe(1);
    expect(PC.instances).toHaveLength(1);
    // A real failure drops to the relay, then the host tries direct again instead of staying on the relay.
    first.state('failed');
    expect(client.directPeerCount).toBe(0);
    await wait(2000);
    expect(PC.instances).toHaveLength(2);
    // That one never connects (15 s negotiation timeout): the next try waits longer.
    await wait(15000);
    await wait(3900);
    expect(PC.instances).toHaveLength(2);
    await wait(200);
    expect(PC.instances).toHaveLength(3);
  });

  it('uses TURN servers from the relay for new links', async () => {
    vi.stubGlobal('fetch', async () => ({ ok: true, json: async () => ({ iceServers: [{ urls: 'turn:turn.example:3478', username: 'u', credential: 'c' }] }) }));
    client = new NetClient();
    const ws = await seated();
    await vi.advanceTimersByTimeAsync(0);
    ws.message({ op: 'peer-joined', peerId: 'guest', name: 'G' });
    await vi.advanceTimersByTimeAsync(0);
    const urls = (PC.instances[0].config.iceServers ?? []).flatMap(s => s.urls);
    expect(urls).toContain('turn:turn.example:3478');
    expect(urls).toContain('stun:stun.cloudflare.com:3478');
  });
});
