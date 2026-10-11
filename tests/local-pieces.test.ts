/**
 * Client-side simulation of the game pieces around the predicted robot (src/engine/net/localPieces.ts), on real season
 * worlds joined by a fake link with latency (tests/helpers/netPair.ts). Each scenario runs with and without it, so the
 * numbers show what a non-host driver sees: the old way (pieces only from snapshots) against the new one.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { netPair, drive } from './helpers/netPair';
import { footprint } from '../src/engine/robot/config';
import type { RobotCommand } from '../src/engine/robot/robot';

beforeAll(async () => {
  await RAPIER.init();
});

type Pair = ReturnType<typeof netPair>;

/** Collision proxies overlapping the client's robot chassis by more than 4 cm (the "driving through FUEL" look). */
function overlapping(p: Pair): number {
  const r = p.clientSim.robot;
  const fp = footprint(r.config);
  const pool = p.clientSim.pool;
  const m = pool.radius - 0.04;
  let n = 0;
  for (let i = 0; i < pool.count; i++) {
    if (pool.state[i] !== 'field') continue;
    const q = r.toLocal(pool.position(i));
    if (Math.abs(q.f) < fp.length / 2 + m && Math.abs(q.l) < fp.width / 2 + m && q.h > 0.08 && q.h < r.config.height) n++;
  }
  return n;
}

/** Worst distance between where the client draws a field piece and where the host has it (Infinity = not drawn). */
function worstPieceError(p: Pair): number {
  const pool = p.clientSim.pool;
  const host = p.hostSim.pool;
  const meshIndex = (pool as unknown as { meshIndex: number[] }).meshIndex;
  const m = new THREE.Matrix4();
  pool.syncVisuals(1);
  let worst = 0;
  for (let i = 0; i < host.count; i++) {
    if (host.state[i] !== 'field') continue;
    pool.meshes[meshIndex[i]].getMatrixAt(i, m);
    if (m.elements[0] === 0 && m.elements[1] === 0 && m.elements[2] === 0) return Infinity;
    const h = host.position(i);
    worst = Math.max(worst, Math.hypot(m.elements[12] - h.x, m.elements[13] - h.y, m.elements[14] - h.z));
  }
  return worst;
}

/** Client robot pose against the host's pose after the host has run the same inputs (one latency later). */
function poseError(p: Pair, from: number, to: number): { mean: number; max: number } {
  const s = p.samples.slice(from, to);
  let sum = 0, max = 0, n = 0;
  for (let k = 0; k + p.latencySteps < s.length; k++) {
    const e = s[k].client.distanceTo(s[k + p.latencySteps].host);
    sum += e;
    max = Math.max(max, e);
    n++;
  }
  return { mean: sum / n, max };
}

interface Run {
  p: Pair;
  overlap: number;
  pose: { mean: number; max: number };
  /** Steps the client / host robot rode up on pieces, and when it first did (host time-aligned to the client's inputs). */
  upClient: number;
  upHost: number;
  firstUpClient: number;
  firstUpHost: number;
}

function scenario(opts: Parameters<typeof netPair>[0], steps: number, cmd: (k: number) => RobotCommand, setup?: (p: Pair) => void): Run {
  const p = netPair(opts);
  p.hostSim.rules.stage();
  setup?.(p);
  p.run(1.5);
  const s0 = p.samples.length;
  let overlap = 0;
  for (let k = 0; k < steps; k++) {
    p.step(cmd(k));
    overlap += overlapping(p);
  }
  const s = p.samples.slice(s0, s0 + steps);
  const L = p.latencySteps;
  const up = 0.03;
  return {
    p,
    overlap: overlap / steps,
    pose: poseError(p, s0, s0 + steps),
    upClient: s.filter((x) => x.client.y > up).length,
    upHost: s.filter((x) => x.host.y > up).length,
    firstUpClient: s.findIndex((x) => x.client.y > up),
    firstUpHost: s.findIndex((x, k) => k >= L && x.host.y > up) - L,
  };
}

describe('client-side game pieces near the predicted robot', () => {
  // A robot whose bumpers ride 8 cm off the carpet beaches on FUEL (the stock 1.5 in bumpers push it instead).
  const beachingRobot = { pose: { x: 6.2, y: 4.0, yaw: 0 }, config: (c: { bumperBottom: number; bumperTop: number }) => { c.bumperBottom = 0.08; c.bumperTop = Math.max(c.bumperTop, 0.18); } };
  const intoThePile = (k: number) => (k < 130 ? drive(2.5, 0.6) : k < 190 ? drive(0, 0) : drive(-2, 0.5));

  it('shows a non-host driver beaching on FUEL when the host does (it used to drive straight through)', () => {
    const old = scenario({ latencyMs: 100, local: false, ...beachingRobot }, 280, intoThePile);
    const now = scenario({ latencyMs: 100, local: true, ...beachingRobot }, 280, intoThePile);
    try {
      // The host beaches for most of the run; before, the client never left the carpet.
      expect(now.upHost).toBeGreaterThan(150);
      expect(old.upClient).toBe(0);
      expect(now.upClient).toBeGreaterThan(now.upHost * 0.7);
      // ...at the moment the driver hits the pile, not a round trip later.
      expect(Math.abs(now.firstUpClient - now.firstUpHost)).toBeLessThan(15);
      // The predicted robot stays far closer to where the host has it.
      expect(now.pose.mean).toBeLessThan(old.pose.mean * 0.5);
      expect(now.pose.max).toBeLessThan(old.pose.max);
      // Still beached when it stops, like the host (the old client sat flat with FUEL drawn inside the chassis).
      now.p.run(4);
      const c = now.p.clientSim.robot.body.translation();
      const h = now.p.hostSim.robot.body.translation();
      expect(Math.hypot(c.x - h.x, c.y - h.y, c.z - h.z)).toBeLessThan(0.03);
      expect(worstPieceError(now.p)).toBeLessThan(0.05);
    } finally {
      old.p.dispose();
      now.p.dispose();
    }
  });

  it('predicts FUEL contacts and robot motion through a pile, then releases collision proxies', () => {
    const plow = (k: number) => (k < 160 ? drive(3, 1.5) : k < 220 ? drive(0, 0) : drive(-2, 2));
    const opts = { latencyMs: 40, pose: { x: 6.3, y: 4.0, yaw: 0.3 } };
    const old = scenario({ ...opts, local: false }, 300, plow);
    const now = scenario({ ...opts, local: true }, 300, plow);
    try {
      expect(old.overlap).toBeGreaterThan(3);
      expect(now.overlap).toBeLessThan(old.overlap * 0.3);
      expect(now.pose.mean).toBeLessThan(0.03);
      expect(now.p.lp.adoptions).toBeGreaterThan(50);
      now.p.run(3);
      // Every piece back exactly where the host has it; nothing left simulated next to a robot at rest.
      expect(worstPieceError(now.p)).toBeLessThan(0.05);
      expect(now.p.lp.count).toBeLessThan(5);
    } finally {
      old.p.dispose();
      now.p.dispose();
    }
  });

  it('hands pieces near another robot back to the host', () => {
    const run = scenario({ latencyMs: 60, local: true, pose: { x: 6.3, y: 4.0, yaw: 0 }, others: [{ id: 1, pose: { x: 9.6, y: 4.0, yaw: Math.PI } }] }, 0, () => drive(0, 0));
    const p = run.p;
    try {
      const other = p.clientSim.ctx.robots[1];
      const reach = Math.hypot(footprint(other.config).length, footprint(other.config).width) / 2;
      const pool = p.clientSim.pool;
      p.otherCmds.set(1, drive(-0.8, 0));
      let contested = 0;
      for (let k = 0; k < 200; k++) {
        p.step(k < 150 ? drive(1.5, 0) : drive(0, 0));
        const o = other.body.translation();
        for (let i = 0; i < pool.count; i++) {
          if (!pool.isLocal(i)) continue;
          const q = pool.position(i);
          if (Math.hypot(q.x - o.x, q.z - o.z) < reach + 0.55) contested++;
        }
      }
      expect(p.lp.adoptions).toBeGreaterThan(10);
      expect(contested).toBe(0);
      p.otherCmds.set(1, drive(0, 0));
      p.run(4);
      expect(worstPieceError(p)).toBeLessThan(0.05);
    } finally {
      p.dispose();
    }
  });

  it.each([40, 100, 150])('renders only host ball trajectories while driving, stopping and reversing at %i ms latency', (latencyMs) => {
    const opts = { latencyMs, pose: { x: 6.3, y: 4.0, yaw: 0.3 } };
    const predicted = netPair({ ...opts, local: true });
    const authoritative = netPair({ ...opts, local: false });
    try {
      for (const p of [predicted, authoritative]) { p.hostSim.rules.stage(); p.run(1.5); }
      const a = new THREE.Matrix4(), b = new THREE.Matrix4();
      let worstVisibleDifference = 0;
      let worstProxyDifference = 0;
      for (let k = 0; k < 520; k++) {
        const cmd = k < 160 ? drive(3, 1.5) : k < 350 ? drive(0, 0) : drive(-2, 2);
        predicted.step(cmd);
        authoritative.step(cmd);
        const pool = predicted.clientSim.pool;
        pool.syncVisuals(k % 2 ? 0.2 : 1);
        authoritative.clientSim.pool.syncVisuals(1);
        for (let i = 0; i < pool.count; i++) {
          pool.mesh.getMatrixAt(i, a);
          authoritative.clientSim.pool.mesh.getMatrixAt(i, b);
          worstVisibleDifference = Math.max(worstVisibleDifference, ...a.elements.map((v, j) => Math.abs(v - b.elements[j])));
          if (pool.isLocal(i)) {
            const q = pool.position(i), h = { x: a.elements[12], y: a.elements[13], z: a.elements[14] };
            worstProxyDifference = Math.max(worstProxyDifference, Math.hypot(q.x - h.x, q.y - h.y, q.z - h.z));
          }
        }
      }
      // Exercise an actually divergent pile, including the old return animation after stopping.
      expect(predicted.lp.adoptions).toBeGreaterThan(50);
      expect(worstVisibleDifference).toBeLessThan(0.00001);
      expect(worstProxyDifference).toBeGreaterThan(0.5);
    } finally {
      predicted.dispose(); authoritative.dispose();
    }
  });

  it.each([40, 100, 150])('restores support after prediction releases pieces under a stopped robot at %i ms latency', (latencyMs) => {
    const p = netPair({ latencyMs, local: true, ...beachingRobot });
    try {
      p.hostSim.rules.stage();
      p.run(1.5);
      for (let k = 0; k < 130; k++) p.step(drive(2.5, 0.6));
      p.run(2);
      expect(p.hostSim.robot.body.translation().y).toBeGreaterThan(0.03);
      // A prediction snap or reconnect releases every local piece, including the chassis supports.
      p.lp.releaseAll();
      p.run(1);
      const lifts = p.lp.lifted;
      const start = p.samples.length;
      p.run(3);
      const heights = p.samples.slice(start).map((s) => s.client.y);
      expect(p.lp.lifted - lifts).toBeLessThanOrEqual(1);
      expect(Math.max(...heights) - Math.min(...heights)).toBeLessThan(0.01);
      expect(Math.min(...heights)).toBeGreaterThan(0.03);
      expect(Math.abs(heights[heights.length - 1] - p.hostSim.robot.body.translation().y)).toBeLessThan(0.01);
    } finally {
      p.dispose();
    }
  });

  it('leaves intake captures to the host and settles with it after intaking', () => {
    const run = scenario({ latencyMs: 60, local: true, pose: { x: 10.2, y: 4.0, yaw: 0 } }, 220, (k) => drive(k < 150 ? -2 : 0, 0.4 * Math.sin(k / 20), { intake: true }));
    const p = run.p;
    try {
      expect(p.hostSim.robot.held.length).toBeGreaterThan(20);
      expect(p.clientSim.robot.held.length).toBe(p.hostSim.robot.held.length);
      p.run(4);
      expect(worstPieceError(p)).toBeLessThan(0.05);
    } finally {
      p.dispose();
    }
  });

  it('2025: CORAL and ALGAE on the carpet go back to the host pose and orientation', () => {
    const p = netPair({ seasonId: '2025-reefscape', latencyMs: 60, local: true, pose: { x: 6.5, y: 1.6, yaw: 0 } });
    try {
      p.hostSim.rules.stage();
      const pool = p.hostSim.pool;
      const placed: number[] = [];
      const byShape = new Map<string, number[]>();
      for (const i of pool.indices('reserve')) {
        const k = pool.specAt(i).shape ?? 'sphere';
        if (!byShape.has(k)) byShape.set(k, []);
        byShape.get(k)!.push(i);
      }
      for (const list of byShape.values()) for (const i of list.slice(0, 8)) {
        const n = placed.length;
        pool.placeField(i, 7.6 + (n % 4) * 0.45, 1.0 + Math.floor(n / 4) * 0.45);
        placed.push(i);
      }
      p.run(2);
      for (let k = 0; k < 200; k++) p.step(k < 140 ? drive(1.8, k < 70 ? 0.5 : -0.3) : drive(0, 0));
      expect(p.lp.adoptions).toBeGreaterThan(5);
      p.run(4);
      expect(worstPieceError(p)).toBeLessThan(0.05);
      const q = new THREE.Quaternion();
      for (const i of placed) {
        if (pool.state[i] !== 'field' || pool.specAt(i).shape !== 'tube') continue;
        const h = pool.bodies[i].rotation();
        const c = p.clientSim.pool.bodies[i].rotation();
        expect(q.set(h.x, h.y, h.z, h.w).angleTo(new THREE.Quaternion(c.x, c.y, c.z, c.w)), `tube ${i}`).toBeLessThan(0.05);
      }
    } finally {
      p.dispose();
    }
  });

  it('a piece the host takes leaves local simulation at once', () => {
    const run = scenario({ latencyMs: 40, local: true, pose: { x: 6.3, y: 4.0, yaw: 0 } }, 60, () => drive(1.5, 0));
    const p = run.p;
    try {
      const pool = p.clientSim.pool;
      const i = pool.indices('field').find((k) => pool.isLocal(k));
      expect(i).toBeDefined();
      pool.applyReplicaState(i!, 'held', 0, null);
      expect(pool.isLocal(i!)).toBe(false);
      expect(pool.bodies[i!].isEnabled()).toBe(false);
    } finally {
      p.dispose();
    }
  });
});
