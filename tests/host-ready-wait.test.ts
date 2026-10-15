import { afterEach, expect, it, vi } from 'vitest';
import { HostSync } from '../src/engine/net/hostSync';
import type { NetClient } from '../src/engine/net/netClient';

/** Minimal NetClient stand-in: the test fires its events. */
function fakeNet() {
  const handlers = new Map<string, ((e: unknown) => void)[]>();
  const net = {
    peerId: 'host', buffered: 0, connected: true,
    on(ev: string, fn: (e: unknown) => void) { handlers.set(ev, [...(handlers.get(ev) ?? []), fn]); return () => {}; },
    send() {}, sendBinary() {},
  };
  const emit = (ev: string, e: unknown) => handlers.get(ev)?.forEach((fn) => fn(e));
  return { client: net as unknown as NetClient, emit };
}

function host() {
  const t = fakeNet(), allReady = vi.fn();
  const src = { pool: { count: 0 }, robots: [], netState: 'waiting', countdownLeft: 0, lastResults: null } as never;
  const hs = new HostSync(t.client, { seasonId: '2026-rebuilt', seed: 1, autoHumanPlayer: false, robots: [], peers: ['host', 'slow', 'gone'] }, src,
    { humanPlayer() {}, allReady, peerLeft() {} }, 20000, 120000);
  return { ...t, hs, allReady };
}

afterEach(() => { vi.useRealTimers(); });

// A guest still loading (compiling shaders on a slow machine) is still connected: the match must not start without it.
it('waits past the ready timeout for connected guests, and starts without only the ones that dropped', () => {
  vi.useFakeTimers();
  const { emit, hs, allReady } = host();
  try {
    emit('msg', { from: 'gone', data: { t: 'ready' } });
    emit('peer-lost', { peerId: 'gone' });
    emit('msg', { from: 'gone', data: { t: 'nothing' } });
    vi.advanceTimersByTime(30000);
    expect(allReady).not.toHaveBeenCalled(); // 'slow' is connected and loading
    emit('msg', { from: 'slow', data: { t: 'ready' } });
    expect(allReady).toHaveBeenCalledTimes(1);
  } finally { hs.dispose(); }
});

it('drops a lost guest at the timeout and gives up on a stuck one at the hard cap', () => {
  vi.useFakeTimers();
  const a = host();
  try {
    a.emit('peer-lost', { peerId: 'gone' });
    a.emit('peer-lost', { peerId: 'slow' });
    vi.advanceTimersByTime(20001);
    expect(a.allReady).toHaveBeenCalledTimes(1);
  } finally { a.hs.dispose(); }
  const b = host();
  try {
    vi.advanceTimersByTime(119000);
    expect(b.allReady).not.toHaveBeenCalled();
    vi.advanceTimersByTime(3000);
    expect(b.allReady).toHaveBeenCalledTimes(1);
  } finally { b.hs.dispose(); }
});
