/**
 * The host half of the simulation worker, on a real season world: when snapshots go out, what the page's link state does
 * to them, and that frames and snapshots each see every piece change. The Worker itself is covered by the browser run.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { HostSync, COMMAND_TIMEOUT_MS, type HostSimLink } from '../src/engine/net/hostSync';
import { decodeSnapshot, packCommand, type ClientMsg, type Snapshot } from '../src/engine/net/protocol';
import type { NetClient } from '../src/engine/net/netClient';
import { HeadlessSim } from '../src/engine/testing/headless';
import { HostStream, IDLE_SNAPSHOT_MS, MAX_SNAPSHOTS_IN_FLIGHT, SNAPSHOT_EVERY_STEPS } from '../src/engine/sim/hostStream';
import { MatchSim } from '../src/engine/core/matchSim';
import { cloneConfig } from '../src/engine/robot/config';
import { IDLE_COMMAND } from '../src/engine/robot/robot';
import { getSeason } from '../src/seasons/index';

beforeAll(async () => {
  await RAPIER.init();
});

function setup() {
  const season = getSeason('2026-rebuilt');
  const sim = new HeadlessSim(season, RAPIER, { robot: cloneConfig(season.robotDefaults), alliance: 'blue', pose: season.startPose('blue', 2) });
  sim.rules.stage();
  const src = { pool: sim.pool, robots: [sim.robot], clock: sim.ctx.clock, score: sim.ctx.score, rules: sim.rules, netState: 'running' as const, countdownLeft: 0, lastResults: null };
  const sent: ArrayBuffer[] = [];
  const stream = new HostStream(src, (buf) => sent.push(buf));
  const last = (): Snapshot => decodeSnapshot(sent[sent.length - 1])!;
  return { sim, stream, sent, last };
}

const firstFieldPiece = (sim: HeadlessSim) => {
  for (let i = 0; i < sim.pool.count; i++) if (sim.pool.state[i] === 'field') return i;
  throw new Error('no field piece');
};

describe('HostStream', () => {
  it('sends every third step, and one snapshot for a batch of catch-up steps', () => {
    const { stream, sent } = setup();
    for (let i = 1; i < SNAPSHOT_EVERY_STEPS; i++) stream.update(1, true, 0, 0);
    expect(sent).toHaveLength(0);
    stream.update(1, true, 0, 0);
    expect(sent).toHaveLength(1);
    stream.ack();
    stream.update(5, true, 0, 0);
    expect(sent).toHaveLength(2);
  });

  it('keeps clients in sync at a low rate while nothing steps', () => {
    const { stream, sent } = setup();
    stream.update(0, false, 0, 1000);
    stream.update(0, false, 0, 1000 + IDLE_SNAPSHOT_MS / 2);
    expect(sent).toHaveLength(1);
    stream.ack();
    stream.update(0, false, 0, 1001 + IDLE_SNAPSHOT_MS);
    expect(sent).toHaveLength(2);
  });

  it('stops encoding when the page falls behind, then carries on', () => {
    const { stream, sent } = setup();
    for (let i = 0; i < MAX_SNAPSHOTS_IN_FLIGHT + 2; i++) stream.update(SNAPSHOT_EVERY_STEPS, true, 0, 0);
    expect(sent).toHaveLength(MAX_SNAPSHOTS_IN_FLIGHT);
    stream.ack();
    stream.update(SNAPSHOT_EVERY_STEPS, true, 0, 0);
    expect(sent).toHaveLength(MAX_SNAPSHOTS_IN_FLIGHT + 1);
  });

  it('a snapshot skipped for a backed-up socket keeps its piece changes for the next one', () => {
    const { sim, stream, last } = setup();
    stream.update(SNAPSHOT_EVERY_STEPS, true, 0, 0); // the opening keyframe
    stream.ack();
    const i = firstFieldPiece(sim);
    sim.pool.hold(i, sim.robot.id);
    stream.setLink(true, false);
    stream.update(SNAPSHOT_EVERY_STEPS, true, 0, 0);
    stream.setLink(true, true);
    stream.update(SNAPSHOT_EVERY_STEPS, true, 0, 0);
    expect(last().meta.key).toBeUndefined();
    expect(last().meta.pieces?.some((p) => p[0] === i)).toBe(true);
  });

  it('frames and snapshots both see every piece change', () => {
    const { sim, stream, last } = setup();
    stream.update(SNAPSHOT_EVERY_STEPS, true, 0, 0);
    stream.ack();
    stream.takeFrameChanges();
    const i = firstFieldPiece(sim);
    sim.pool.hold(i, sim.robot.id);
    expect(stream.takeFrameChanges()).toContain(i);
    expect(stream.takeFrameChanges()).not.toContain(i);
    stream.update(SNAPSHOT_EVERY_STEPS, true, 0, 0);
    expect(last().meta.pieces?.some((p) => p[0] === i)).toBe(true);
    const j = firstFieldPiece(sim);
    sim.pool.hold(j, sim.robot.id);
    stream.ack();
    stream.update(SNAPSHOT_EVERY_STEPS, true, 0, 0);
    expect(last().meta.pieces?.some((p) => p[0] === j)).toBe(true);
    expect(stream.takeFrameChanges()).toContain(j);
  });

  it('a keyframe request makes the next snapshot complete', () => {
    const { stream, last } = setup();
    stream.update(SNAPSHOT_EVERY_STEPS, true, 0, 0);
    stream.ack();
    stream.update(SNAPSHOT_EVERY_STEPS, true, 0, 0);
    expect(last().meta.key).toBeUndefined();
    stream.ack();
    stream.requestKeyframe();
    stream.update(SNAPSHOT_EVERY_STEPS, true, 0, 0);
    expect(last().meta.key).toBe(true);
  });

  it('holds remote commands until they go stale, the link drops or the driver is dropped, and acks their sequence', () => {
    const { sim, stream, last } = setup();
    const id = sim.robot.id;
    const cmd = { ...IDLE_COMMAND, vx: 1 };
    stream.setCommand(id, cmd, 7, 0);
    expect(stream.command(id, COMMAND_TIMEOUT_MS)).toEqual(cmd);
    expect(stream.command(id, COMMAND_TIMEOUT_MS + 1)).toBeNull();
    stream.setLink(false, false);
    expect(stream.command(id, 1)).toBeNull();
    stream.setLink(true, true);
    stream.update(SNAPSHOT_EVERY_STEPS, true, 0, 0);
    expect(last().robots[0].cmdSeq).toBe(7);
    stream.dropCommands(id);
    expect(stream.command(id, 1)).toBeNull();
    stream.setCommand(id, cmd, 8, 0);
    stream.dropCommands();
    expect(stream.command(id, 1)).toBeNull();
  });
});

describe('HostSync with the match in the worker', () => {
  function pageHost() {
    const { sim } = setup();
    type Listener = (e: never) => void;
    const listeners = new Map<string, Listener[]>();
    const binary: ArrayBuffer[] = [];
    const net = {
      peerId: 'host', buffered: 0, relaySnapshotBacklog: 0, connected: true,
      on(ev: string, fn: Listener) { listeners.set(ev, [...(listeners.get(ev) ?? []), fn]); return () => {}; },
      send() {},
      sendBinary(buf: ArrayBuffer) { binary.push(buf); },
    };
    const emit = (ev: string, e: unknown) => listeners.get(ev)?.forEach((l) => l(e as never));
    const robotSetup = { id: sim.robot.id, peerId: 'c1' };
    const src = { pool: sim.pool, robots: [sim.robot], clock: sim.ctx.clock, score: sim.ctx.score, rules: sim.rules, netState: 'running' as const, countdownLeft: 0, lastResults: null };
    const hs = new HostSync(net as unknown as NetClient, { seasonId: sim.season.id, seed: 1, autoHumanPlayer: false, robots: [robotSetup as never], peers: [] }, src, { humanPlayer() {}, allReady() {}, peerLeft() {} });
    const calls: unknown[][] = [];
    const link: HostSimLink = {
      command: (...a) => void calls.push(['command', ...a]),
      dropCommands: (...a) => void calls.push(['drop', ...a]),
      requestKeyframe: () => void calls.push(['key']),
    };
    hs.link = link;
    const say = (data: ClientMsg) => emit('msg', { from: 'c1', data });
    return { sim, hs, net, emit, calls, say, binary };
  }

  it('forwards new commands, not stale ones', () => {
    const { sim, calls, say } = pageHost();
    const c = packCommand(IDLE_COMMAND);
    say({ t: 'cmd', c, s: 5 });
    say({ t: 'cmd', c, s: 4 });
    expect(calls.filter((x) => x[0] === 'command').map((x) => x.slice(1, 2).concat(x[3]))).toEqual([[sim.robot.id, 5]]);
  });

  it('forwards keyframe requests and dropped drivers', () => {
    const { sim, calls, emit, say } = pageHost();
    say({ t: 'resync' });
    say({ t: 'ready' });
    emit('peer-back', { peerId: 'c1' });
    expect(calls.filter((x) => x[0] === 'key')).toHaveLength(3);
    emit('peer-lost', { peerId: 'c1' });
    emit('peer-left', { peerId: 'c1' });
    emit('reconnecting', {});
    expect(calls.filter((x) => x[0] === 'drop')).toEqual([['drop', sim.robot.id], ['drop', sim.robot.id], ['drop']]);
  });

  it('counts and sends a snapshot the worker encoded, and reports whether the socket can take more', () => {
    const { hs, net, binary } = pageHost();
    hs.sendEncoded(new ArrayBuffer(12));
    expect(binary).toHaveLength(1);
    expect(hs.bytesSent).toBe(12);
    expect(hs.linkClear).toBe(true);
    net.relaySnapshotBacklog = 1 << 20;
    expect(hs.linkClear).toBe(false);
  });
});

describe('MatchSim.allReady', () => {
  const sim = (state: string, pausedFrom = 'countdown') => Object.assign(Object.create(MatchSim.prototype) as MatchSim, { state, pausedFrom, countdown: 0 });

  it('starts the countdown from waiting', () => {
    const s = sim('waiting');
    expect(s.allReady()).toBe(true);
    expect(s.state).toBe('countdown');
    expect(s.countdown).toBeGreaterThan(0);
  });

  it('a host paused while waiting resumes into the countdown', () => {
    const s = sim('paused', 'waiting');
    expect(s.allReady()).toBe(false);
    expect(s.state).toBe('paused');
    expect(s.pausedFrom).toBe('countdown');
    expect(s.countdown).toBeGreaterThan(0);
  });

  it('does nothing once the match is under way', () => {
    const s = sim('running');
    expect(s.allReady()).toBe(false);
    expect(s.state).toBe('running');
  });
});
