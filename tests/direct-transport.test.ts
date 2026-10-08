import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DirectTransport } from '../src/engine/net/directTransport';

class Channel {
  label = 'frc-game';
  readyState = 'connecting';
  binaryType = '';
  bufferedAmount = 0;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  sent: unknown[] = [];
  send(data: unknown) { if (this.readyState !== 'open') throw new Error('closed'); this.sent.push(data); }
  close() { this.readyState = 'closed'; this.onclose?.(); }
  open() { this.readyState = 'open'; this.onopen?.(); }
}
class PC {
  static instances: PC[] = [];
  localDescription: { type: string; sdp: string; toJSON: () => { type: string; sdp: string } } | null = null;
  connectionState = 'new';
  sctp = { maxMessageSize: 65536 };
  onicecandidate: ((e: { candidate: { toJSON: () => unknown } }) => void) | null = null;
  onconnectionstatechange: (() => void) | null = null;
  ondatachannel: ((e: { channel: Channel }) => void) | null = null;
  channel = new Channel();
  calls: string[] = [];
  constructor() { PC.instances.push(this); }
  createDataChannel() { return this.channel; }
  async createOffer() { return { type: 'offer', sdp: 'offer' }; }
  async createAnswer() { return { type: 'answer', sdp: 'answer' }; }
  async setLocalDescription(d: { type: string; sdp: string }) {
    this.localDescription = { ...d, toJSON: () => d };
    this.onicecandidate?.({ candidate: { toJSON: () => ({ candidate: 'ice' }) } });
  }
  async setRemoteDescription() { this.calls.push('description'); await Promise.resolve(); }
  async addIceCandidate() { this.calls.push('candidate'); }
  close() { this.connectionState = 'closed'; }
}
let transport: DirectTransport;
const signals: { peer: string; data: unknown }[] = [];
const changes: string[] = [];
const received: unknown[] = [];
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('RTCPeerConnection', PC);
  vi.stubGlobal('location', { search: '' });
  PC.instances = []; signals.length = changes.length = received.length = 0;
  transport = new DirectTransport((peer, data) => signals.push({ peer, data }), (peer, data) => received.push({ peer, data }), peer => changes.push(peer));
});
afterEach(() => { transport.close(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('direct host connections', () => {
  it('uses relay until open, sends SDP before ICE, and falls back immediately after failure', async () => {
    await transport.offer('guest');
    expect(transport.send('guest', 'cmd')).toBe(false);
    expect(signals[0].data).toHaveProperty('description.type', 'offer');
    expect(signals[1].data).toHaveProperty('candidate.candidate', 'ice');
    const pc = PC.instances[0];
    pc.channel.open();
    expect(transport.peers).toEqual(['guest']);
    expect(transport.send('guest', 'cmd')).toBe(true);
    pc.channel.onmessage?.({ data: new ArrayBuffer(5) });
    expect(received).toHaveLength(1);
    pc.connectionState = 'failed'; pc.onconnectionstatechange?.();
    expect(transport.send('guest', 'cmd')).toBe(false);
    expect(transport.peers).toEqual([]);
    expect(changes).toEqual(['guest', 'guest']);
  });

  it('serializes a remote description before its candidate and rejects stale negotiation sessions', async () => {
    transport.handleSignal('host', { session: 'current', description: { type: 'offer', sdp: 'sdp' } }, true);
    transport.handleSignal('host', { session: 'current', candidate: { candidate: 'ice' } }, true);
    transport.handleSignal('host', { session: 'old', candidate: { candidate: 'stale' } }, true);
    await vi.advanceTimersByTimeAsync(0);
    expect(PC.instances[0].calls).toEqual(['description', 'candidate']);
    expect(signals[0].data).toHaveProperty('description.type', 'answer');
  });

  it('rejects client offers at the host and bounds negotiations that never connect', async () => {
    transport.handleSignal('guest', { session: 'bad', description: { type: 'offer' } }, false);
    await vi.advanceTimersByTimeAsync(0);
    expect(PC.instances).toHaveLength(0);
    await transport.offer('guest');
    await vi.advanceTimersByTimeAsync(15000);
    expect(PC.instances[0].connectionState).toBe('closed');
    expect(transport.send('guest', 'cmd')).toBe(false);
  });

  it('bounds direct snapshot backlog and relays oversized frames instead of losing them', async () => {
    await transport.offer('guest');
    const pc = PC.instances[0]; pc.channel.open();
    pc.channel.bufferedAmount = 20000;
    expect(transport.send('guest', new ArrayBuffer(20))).toBe(true); // skipped until a fresh snapshot
    expect(transport.send('guest', 'cmd')).toBe(false); // controls can use relay
    expect(pc.channel.sent).toHaveLength(0);
    pc.channel.bufferedAmount = 0;
    expect(transport.send('guest', new ArrayBuffer(70000))).toBe(false);
    expect(pc.channel.sent).toHaveLength(0);
  });

  it('leaving cancels queued offers before they can create a connection in another room', async () => {
    transport.handleSignal('host', { session: 'old', description: { type: 'offer' } }, true);
    transport.close();
    await vi.advanceTimersByTimeAsync(0);
    expect(PC.instances).toHaveLength(0);
  });
});
