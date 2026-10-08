import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NetClient } from '../src/engine/net/netClient';

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
