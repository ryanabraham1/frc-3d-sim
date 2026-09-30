/**
 * HostSync ↔ ClientSync over a fake transport, on real season worlds (HeadlessSim): what goes into each
 * snapshot (bandwidth) and how clients recover from lost snapshots / late packets (lag).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { HostSync } from '../src/engine/net/hostSync';
import { ClientSync, MAX_INTERP_DELAY, MIN_INTERP_DELAY } from '../src/engine/net/clientSync';
import { decodeSnapshot, type ClientMsg, type Snapshot } from '../src/engine/net/protocol';
import type { NetClient } from '../src/engine/net/netClient';
import { HeadlessSim } from '../src/engine/testing/headless';
import { cloneConfig } from '../src/engine/robot/config';
import { IDLE_COMMAND } from '../src/engine/robot/robot';
import { getSeason } from '../src/seasons/index';
import type { SeasonRules } from '../src/engine/core/season';

beforeAll(async () => {
  await RAPIER.init();
});

type Listener = (e: { from: string; data: unknown }) => void;

/** Stand-in for NetClient: records what is sent, lets the test deliver client messages to the host. */
function fakeNet() {
  const frames: ArrayBuffer[] = [];
  const sent: unknown[] = [];
  const listeners: Listener[] = [];
  const net = {
    peerId: 'host',
    buffered: 0,
    on(ev: string, fn: Listener) {
      if (ev === 'msg') listeners.push(fn);
      return () => {};
    },
    send(data: unknown) {
      sent.push(data);
    },
    sendBinary(buf: ArrayBuffer) {
      frames.push(buf);
    },
  };
  const deliver = (data: ClientMsg) => listeners.forEach((l) => l({ from: 'c1', data }));
  return { net, client: net as unknown as NetClient, frames, sent, deliver };
}

function world(seasonId: string) {
  const season = getSeason(seasonId);
  const sim = new HeadlessSim(season, RAPIER, { robot: cloneConfig(season.robotDefaults), alliance: 'blue', pose: season.startPose('blue', 2) });
  sim.rules.stage();
  return sim;
}

function host(sim: HeadlessSim) {
  const t = fakeNet();
  const src = { pool: sim.pool, robots: [sim.robot], clock: sim.ctx.clock, score: sim.ctx.score, rules: sim.rules, netState: 'running' as const, countdownLeft: 0, lastResults: null };
  const hs = new HostSync(t.client, { seasonId: sim.season.id, seed: 1, autoHumanPlayer: false, robots: [], peers: [] }, src, { humanPlayer() {}, allReady() {}, peerLeft() {} });
  const last = (): Snapshot => decodeSnapshot(t.frames[t.frames.length - 1])!;
  return { ...t, hs, last };
}

/** Let the staged pieces fall asleep. */
function settle(sim: HeadlessSim, seconds = 4) {
  sim.run(seconds);
}

describe('HostSync snapshots', () => {
  it('numbers snapshots and sends resting pieces only once', () => {
    const sim = world('2026-rebuilt');
    settle(sim);
    const h = host(sim);
    h.hs.sendSnapshot(1);
    const key = h.last();
    expect(key.meta.key).toBe(true);
    expect(key.pieceIdx.length).toBe(sim.pool.countIn('field'));
    sim.run(0.05);
    h.hs.sendSnapshot(1.05);
    sim.run(0.05);
    h.hs.sendSnapshot(1.1);
    const later = h.last();
    expect(later.seq).toBe(key.seq + 2);
    // Everything is asleep on the carpet: nothing to resend.
    expect(later.pieceIdx.length).toBeLessThan(5);
    expect(h.frames[h.frames.length - 1].byteLength).toBeLessThan(400);
    h.hs.dispose();
    sim.dispose();
  });

  it('sends a moving piece again, and a keyframe on resync', () => {
    const sim = world('2026-rebuilt');
    settle(sim);
    const h = host(sim);
    h.hs.sendSnapshot(1);
    const i = sim.pool.indices('field')[0];
    sim.pool.bodies[i].applyImpulse({ x: 0, y: 0.5, z: 0 }, true);
    sim.run(0.05);
    h.hs.sendSnapshot(1.05);
    expect(h.last().pieceIdx).toContain(i);
    h.deliver({ t: 'resync' });
    h.hs.sendSnapshot(1.1);
    expect(h.last().meta.key).toBe(true);
    expect(h.last().pieceIdx.length).toBe(sim.pool.countIn('field'));
    h.hs.dispose();
    sim.dispose();
  });

  it('holds snapshots while the uplink is backed up, without losing piece changes', () => {
    const sim = world('2026-rebuilt');
    const h = host(sim);
    h.hs.sendSnapshot(0);
    const i = sim.pool.indices('field')[0];
    h.net.buffered = 10 * 1024 * 1024;
    sim.pool.reserve(i, 'test');
    h.hs.sendSnapshot(0.03);
    expect(h.frames.length).toBe(1);
    h.net.buffered = 0;
    h.hs.sendSnapshot(0.06);
    expect(h.last().meta.pieces?.some(([k, st, , tag]) => k === i && st === 2 && tag === 'test')).toBe(true);
    h.hs.dispose();
    sim.dispose();
  });

  it('sends the clock ~10 Hz, but immediately when the period changes', () => {
    const sim = world('2026-rebuilt');
    const h = host(sim);
    const withClock = () => h.frames.map((f) => decodeSnapshot(f)!.meta.clock !== undefined);
    for (let k = 0; k < 6; k++) h.hs.sendSnapshot(k / 30);
    expect(withClock()).toEqual([true, false, true, false, false, true]);
    sim.ctx.clock.start();
    h.hs.sendSnapshot(0.2);
    expect(h.last().meta.clock?.s).toBe(true);
    h.hs.dispose();
    sim.dispose();
  });

  it('resends only the rules keys that changed (swinging cages, not every placement)', () => {
    const sim = world('2025-reefscape');
    settle(sim, 1);
    const h = host(sim);
    h.hs.sendSnapshot(0);
    expect(h.last().meta.rules).toBeDefined();
    const cage = (sim.rules as unknown as { refs: { cages: { blue: { push(fx: number, fy: number): void }[] } } }).refs.cages.blue[0];
    cage.push(40, 0);
    sim.run(0.1);
    h.hs.sendSnapshot(0.1);
    const m = h.last().meta;
    expect(m.rules).toBeUndefined();
    expect(Object.keys(m.rulesPatch ?? {})).toContain('cages');
    expect(Object.keys(m.rulesPatch ?? {})).not.toContain('placements');
    h.hs.dispose();
    sim.dispose();
  });

  it('sends a resting CORAL orientation once, not every snapshot', () => {
    const sim = world('2025-reefscape');
    const coral = sim.pool.indices('reserve').find((k) => sim.pool.specAt(k).shape === 'tube')!;
    sim.pool.placeField(coral, 6.5, 6.5);
    settle(sim, 4);
    const h = host(sim);
    h.hs.sendSnapshot(0);
    expect(h.last().meta.rotations?.some(([k]) => k === coral)).toBe(true);
    sim.run(0.05);
    h.hs.sendSnapshot(0.05);
    expect(h.last().meta.rotations?.some(([k]) => k === coral) ?? false).toBe(false);
    h.hs.dispose();
    sim.dispose();
  });
});

describe('ClientSync', () => {
  /** A host world streaming into a separate client replica world. */
  function pair(seasonId: string) {
    const hostSim = world(seasonId);
    const h = host(hostSim);
    const clientSim = new HeadlessSim(getSeason(seasonId), RAPIER, { robot: cloneConfig(hostSim.season.robotDefaults), alliance: 'blue', pose: hostSim.season.startPose('blue', 2) });
    const c = fakeNet();
    const applied: unknown[] = [];
    const rules = clientSim.rules;
    const spy: SeasonRules = Object.create(rules);
    spy.applyNetState = (s: unknown) => {
      applied.push(JSON.parse(JSON.stringify(s)));
      rules.applyNetState?.(s);
    };
    const cs = new ClientSync(c.client, { pool: clientSim.pool, robots: [clientSim.robot], clock: clientSim.ctx.clock, score: clientSim.ctx.score, rules: spy });
    const dispose = () => {
      h.hs.dispose();
      hostSim.dispose();
      clientSim.dispose();
    };
    return { hostSim, h, clientSim, c, cs, applied, dispose };
  }

  it('asks for a keyframe (at most once a second) when snapshots go missing', () => {
    const p = pair('2026-rebuilt');
    const { h, cs, c } = p;
    for (let k = 0; k < 4; k++) p.h.hs.sendSnapshot(k / 30);
    cs.onBinary(h.frames[0], 0);
    cs.onBinary(h.frames[1], 33);
    expect(c.sent).toEqual([]);
    cs.onBinary(h.frames[3], 100); // frame 2 was dropped
    expect(c.sent).toEqual([{ t: 'resync' }]);
    expect(cs.missed).toBe(1);
    for (let k = 4; k < 7; k++) h.hs.sendSnapshot(k / 30);
    cs.onBinary(h.frames[6], 200); // another gap, too soon for a second request
    expect(c.sent.length).toBe(1);
    p.dispose();
  });

  it('merges rules patches into the full state the season applies', () => {
    const p = pair('2025-reefscape');
    p.h.hs.sendSnapshot(0);
    p.cs.onBinary(p.h.frames[0], 0);
    const cage = (p.hostSim.rules as unknown as { refs: { cages: { blue: { push(fx: number, fy: number): void }[] } } }).refs.cages.blue[0];
    cage.push(40, 0);
    p.hostSim.run(0.1);
    p.h.hs.sendSnapshot(0.1);
    expect(p.h.last().meta.rulesPatch).toBeDefined();
    p.cs.onBinary(p.h.frames[1], 100);
    expect(p.applied.length).toBe(2);
    const full = p.applied[1] as Record<string, unknown>;
    expect(Object.keys(full).sort()).toEqual(Object.keys(p.applied[0] as object).sort());
    expect(full.cages).toEqual(JSON.parse(JSON.stringify((p.hostSim.rules.netState!() as Record<string, unknown>).cages)));
    p.dispose();
  });

  it('keeps robots moving through a late snapshot instead of freezing', () => {
    const p = pair('2026-rebuilt');
    const { hostSim, h, cs, clientSim } = p;
    const cmd = { vx: 2, vy: 0, omega: 0, intake: false, shoot: false, pass: false, climb: null, descend: false };
    let ms = 0;
    for (let k = 0; k < 20; k++) {
      hostSim.run(1 / 30, cmd);
      h.hs.sendSnapshot((k + 1) / 30);
      ms = ((k + 1) * 1000) / 30;
      cs.onBinary(h.frames[k], ms);
    }
    // Snapshots stop arriving; render time passes the newest one.
    const newest = cs.latest.get(0)!.x;
    cs.interpolate(ms + cs.delay * 1000 + 60);
    const x1 = clientSim.robot.body.translation().x;
    expect(x1).toBeGreaterThan(newest + 0.05);
    // …but only briefly: no runaway extrapolation.
    cs.interpolate(ms + cs.delay * 1000 + 2000);
    expect(clientSim.robot.body.translation().x).toBeLessThan(newest + 2 * 0.1 + 0.05);
    p.dispose();
  });

  it('adapts the interpolation delay to arrival jitter, within bounds', () => {
    const p = pair('2026-rebuilt');
    const { h, cs } = p;
    for (let k = 0; k < 120; k++) h.hs.sendSnapshot(k / 30);
    for (let k = 0; k < 60; k++) cs.onBinary(h.frames[k], (k * 1000) / 30);
    const smooth = cs.delay;
    expect(smooth).toBeGreaterThanOrEqual(MIN_INTERP_DELAY);
    expect(smooth).toBeLessThan(0.1);
    // Bursty arrival: ±60 ms.
    for (let k = 60; k < 120; k++) cs.onBinary(h.frames[k], (k * 1000) / 30 + (k % 2 ? 60 : -60));
    expect(cs.delay).toBeGreaterThan(smooth + 0.05);
    expect(cs.delay).toBeLessThanOrEqual(MAX_INTERP_DELAY);
    p.dispose();
  });
});

describe('pieces are where the host has them (regression: invisible FUEL that "spawned in" and beached robots)', () => {
  it('2026: robot drives through FUEL — nothing sinks into the carpet; host view and client replica match the physics', () => {
    const season = getSeason('2026-rebuilt');
    const mk = () => new HeadlessSim(season, RAPIER, { robot: cloneConfig(season.robotDefaults), alliance: 'blue', pose: season.startPose('blue', 2) });
    const hostSim = mk();
    hostSim.rules.stage();
    const clientSim = mk();
    const h = host(hostSim);
    const cs = new ClientSync(fakeNet().client, { pool: clientSim.pool, robots: [clientSim.robot], clock: clientSim.ctx.clock, score: clientSim.ctx.score, rules: clientSim.rules });
    hostSim.ctx.clock.start();
    const m = new THREE.Matrix4();
    const drift = (view: typeof hostSim.pool) => {
      let worst = 0;
      for (let i = 0; i < hostSim.pool.count; i++) {
        if (hostSim.pool.state[i] !== 'field') continue;
        view.meshes[0].getMatrixAt(i, m);
        const p = hostSim.pool.position(i);
        worst = Math.max(worst, m.elements[0] === 0 ? Infinity : Math.hypot(m.elements[12] - p.x, m.elements[13] - p.y, m.elements[14] - p.z));
      }
      return worst;
    };
    const drive = { vx: 2.5, vy: 0, omega: 0, intake: true, shoot: false, pass: false, climb: null, descend: false };
    let ms = 0;
    let lowest = Infinity;
    for (let i = 0; i < 90 * 6; i++) {
      hostSim.step(i < 90 ? IDLE_COMMAND : { ...drive, vy: Math.sin(i / 40) });
      hostSim.ctx.clock.advance(1 / 90);
      for (let k = 0; k < hostSim.pool.count; k++) if (hostSim.pool.state[k] === 'field') lowest = Math.min(lowest, hostSim.pool.position(k).y);
      if (i % 3 === 0) {
        h.hs.sendSnapshot(i / 90);
        ms = (i / 90) * 1000;
        cs.onBinary(h.frames[h.frames.length - 1], ms);
      }
      if (i % 2 === 0) hostSim.pool.syncVisuals();
      if (i % 45 === 0 && i > 0) { // right after a snapshot
        hostSim.pool.syncVisuals();
        expect(drift(hostSim.pool), `host view at step ${i}`).toBeLessThan(0.002);
        cs.interpolate(ms + 1000); // past the newest snapshot: every piece at its latest pose
        clientSim.pool.syncVisuals();
        expect(drift(clientSim.pool), `client view at step ${i}`).toBeLessThan(0.005);
      }
    }
    expect(lowest, 'a FUEL ball sank into the carpet').toBeGreaterThan(0.03);
    h.hs.dispose();
    hostSim.dispose();
    clientSim.dispose();
  });
});

describe('GamePiecePool.syncVisuals (replica)', () => {
  it('redraws only pieces whose replica pose changed', () => {
    const sim = world('2026-rebuilt');
    const pool = sim.pool;
    const field = pool.indices('field');
    for (const i of field) {
      pool.applyReplicaState(i, 'field', -1, null);
      const p = pool.position(i);
      pool.setReplicaPosition(i, p.x, p.y, p.z);
    }
    pool.syncVisuals();
    let reads = 0;
    for (const b of pool.bodies) {
      const orig = b.translation.bind(b);
      b.translation = () => (reads++, orig());
    }
    pool.syncVisuals();
    expect(reads).toBe(0);
    const i = field[0];
    pool.setReplicaPosition(i, 1, 0.5, 1);
    pool.syncVisuals();
    expect(reads).toBe(1);
    const m = new THREE.Matrix4();
    pool.meshes[0].getMatrixAt(i, m);
    expect(m.elements[13]).toBeCloseTo(0.5, 5);
    sim.dispose();
  });
});
