/**
 * A host world and a predicting client world joined by a fake link with one-way latency, stepped together on one
 * simulated clock. Mirrors Game.clientTick / Game.draw for the client (prediction, local game pieces, interpolation)
 * and Game.step + HostSync for the host. Used by the multiplayer feel tests.
 */
import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { HostSync } from '../../src/engine/net/hostSync';
import { ClientSync } from '../../src/engine/net/clientSync';
import { Predictor } from '../../src/engine/net/prediction';
import { LocalPieces } from '../../src/engine/net/localPieces';
import type { ClientMsg, MatchSetup, RobotSetup } from '../../src/engine/net/protocol';
import type { NetClient } from '../../src/engine/net/netClient';
import { HeadlessSim } from '../../src/engine/testing/headless';
import { cloneConfig, type RobotConfig } from '../../src/engine/robot/config';
import { IDLE_COMMAND, type RobotCommand } from '../../src/engine/robot/robot';
import { getSeason } from '../../src/seasons/index';
import type { FieldPose } from '../../src/engine/coords';

type Listener = (e: { from: string; data: unknown }) => void;

function fakeNet(peerId: string) {
  const frames: ArrayBuffer[] = [];
  const sent: unknown[] = [];
  const listeners: Listener[] = [];
  const net = {
    peerId,
    buffered: 0,
    connected: true,
    rttMs: 0,
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
  const deliver = (from: string, data: unknown) => listeners.forEach((l) => l({ from, data }));
  return { client: net as unknown as NetClient, frames, sent, deliver };
}

export interface PairOptions {
  seasonId?: string;
  /** One-way latency (ms) in each direction. */
  latencyMs: number;
  /** Extra downlink delay at this host time; scheduled arrivals preserve TCP order. */
  snapshotDelayMs?: (hostMs: number) => number;
  /** Simulate pieces near the predicted robot on the client. */
  local: boolean;
  /** Extra robots (driven by the host only, like another player's robot). */
  others?: { pose: FieldPose; id: number }[];
  /** Start pose of the client's robot (default: blue 2). */
  pose?: FieldPose;
  /** Adjust the client's robot config (both worlds). */
  config?: (c: RobotConfig) => void;
}

export interface Sample {
  ms: number;
  client: THREE.Vector3;
  host: THREE.Vector3;
  clientTraction: number;
  hostTraction: number;
}

export function netPair(opts: PairOptions) {
  const season = getSeason(opts.seasonId ?? '2026-rebuilt');
  const pose = opts.pose ?? season.startPose('blue', 2);
  const extraRobots = (opts.others ?? []).map((o) => ({ config: cloneConfig(season.robotDefaults), alliance: 'red' as const, station: 1, pose: o.pose, id: o.id }));
  const robot = () => {
    const c = cloneConfig(season.robotDefaults);
    opts.config?.(c);
    return c;
  };
  const mk = () => new HeadlessSim(season, RAPIER, { robot: robot(), alliance: 'blue', pose, extraRobots });
  const hostSim = mk();
  const clientSim = mk();
  for (const r of clientSim.ctx.robots) if (r !== clientSim.robot) r.body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);

  const hn = fakeNet('host');
  const cn = fakeNet('c1');
  const setup: MatchSetup = { seasonId: season.id, seed: 1, autoHumanPlayer: false, peers: [], robots: [{ id: 0, peerId: 'c1' } as RobotSetup] };
  const src = { pool: hostSim.pool, robots: hostSim.ctx.robots, clock: hostSim.ctx.clock, score: hostSim.ctx.score, rules: hostSim.rules, netState: 'running' as const, countdownLeft: 0, lastResults: null };
  const hs = new HostSync(hn.client, setup, src, { humanPlayer() {}, allReady() {}, peerLeft() {} });
  const cs = new ClientSync(cn.client, { pool: clientSim.pool, robots: clientSim.ctx.robots, clock: clientSim.ctx.clock, score: clientSim.ctx.score, rules: clientSim.rules });
  const predictor = new Predictor(clientSim.robot);
  const lp = new LocalPieces({ pool: clientSim.pool, robots: clientSim.ctx.robots, clientSync: cs }, clientSim.robot);
  lp.enabled = opts.local;

  const toHost: { at: number; msg: unknown }[] = [];
  const toClient: { at: number; buf: ArrayBuffer }[] = [];
  let lastDeliveryAt = 0;
  let sentIdx = 0;
  let frameIdx = 0;
  let n = 0;
  let snaps = 0;
  const samples: Sample[] = [];
  const dt = hostSim.physics.dt;
  /** Commands for robots other than the client's (by robot id), applied on the host. */
  const otherCmds = new Map<number, RobotCommand>();
  /** Client-side CPU time (prediction, local pieces, interpolation), for the cost check. */
  const timing = { clientMs: 0, steps: 0 };

  function hostStep(cmd: RobotCommand) {
    // HeadlessSim.step drives its own robot; drive the extra robots the way Game.step does.
    for (const r of hostSim.ctx.robots) {
      if (r === hostSim.robot) continue;
      r.enabled = true;
      const c = otherCmds.get(r.id) ?? IDLE_COMMAND;
      r.lastCommand = c;
      r.drive(c, dt);
      r.tick(dt);
    }
    hostSim.step(cmd);
  }

  /** Advance both worlds one 90 Hz step with the client driver holding `cmd`. */
  function step(cmd: RobotCommand) {
    const now = (n * 1000) / 90;
    // Host.
    while (toHost.length && toHost[0].at <= now) hn.deliver('c1', toHost.shift()!.msg);
    hostStep(hs.command(0) ?? IDLE_COMMAND);
    if (n % 3 === 0) hs.sendSnapshot(n * dt);
    while (frameIdx < hn.frames.length) {
      lastDeliveryAt = Math.max(lastDeliveryAt, now + opts.latencyMs + (opts.snapshotDelayMs?.(now) ?? 0));
      toClient.push({ at: lastDeliveryAt, buf: hn.frames[frameIdx++] });
    }

    // Client (Game.clientTick + Game.draw).
    const clientStart = performance.now();
    while (toClient.length && toClient[0].at <= now) {
      const snap = cs.onBinary(toClient.shift()!.buf, now);
      const mine = snap?.robots.find((r) => r.id === 0);
      if (mine) predictor.queueSnapshot(mine, now, snap!.meta.st === 'running', snap!.time);
    }
    cs.interpolate(now, predictor.active ? 0 : null);
    // Game.draw: the predicted robot takes everything but its pose from the newest snapshot.
    const latest = predictor.active ? cs.latest.get(0) : undefined;
    if (latest) clientSim.robot.applyNetDiscrete(latest);
    predictor.flush();
    const r = clientSim.robot;
    r.lastCommand = cmd;
    const seq = cs.sendCommand(cmd, now);
    if (seq !== null) predictor.onSent(seq, now);
    while (sentIdx < cn.sent.length) toHost.push({ at: now + opts.latencyMs, msg: cn.sent[sentIdx++] as ClientMsg });
    if (predictor.snaps !== snaps) lp.releaseAll();
    snaps = predictor.snaps;
    lp.update(now, predictor.active, predictor.rtt);
    if (predictor.active) {
      r.capturePrevPose();
      lp.beforeStep();
      r.drive(cmd, dt);
      clientSim.physics.step();
      lp.afterStep();
      predictor.record(now);
    }
    timing.clientMs += performance.now() - clientStart;
    timing.steps++;
    const ct = r.body.translation();
    const ht = hostSim.robot.body.translation();
    samples.push({ ms: now, client: new THREE.Vector3(ct.x, ct.y, ct.z), host: new THREE.Vector3(ht.x, ht.y, ht.z), clientTraction: r.traction, hostTraction: hostSim.robot.traction });
    n++;
  }

  function run(seconds: number, cmd: RobotCommand | ((k: number) => RobotCommand) = IDLE_COMMAND) {
    const steps = Math.round(seconds * 90);
    for (let k = 0; k < steps; k++) step(typeof cmd === 'function' ? cmd(k) : cmd);
  }

  /** What the client draws for piece i (null = hidden). */
  const m4 = new THREE.Matrix4();
  function drawnPiece(i: number): THREE.Vector3 | null {
    clientSim.pool.syncVisuals(1);
    const mesh = clientSim.pool.meshes[0];
    mesh.getMatrixAt(i, m4);
    if (m4.elements[0] === 0) return null;
    return new THREE.Vector3(m4.elements[12], m4.elements[13], m4.elements[14]);
  }

  /** Place n FUEL on both... on the host only (the client learns about them from snapshots). */
  function pile(points: { x: number; y: number }[]) {
    hostSim.scatter(points);
  }

  function dispose() {
    hs.dispose();
    hostSim.dispose();
    clientSim.dispose();
  }

  return { timing, season, pose, hostSim, clientSim, hs, cs, predictor, lp, samples, otherCmds, step, run, pile, drawnPiece, dispose, latencySteps: Math.round((opts.latencyMs / 1000) * 90) };
}

export const drive = (vx: number, vy = 0, extra: Partial<RobotCommand> = {}): RobotCommand => ({ ...IDLE_COMMAND, vx, vy, ...extra });
