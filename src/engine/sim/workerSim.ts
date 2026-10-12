import * as THREE from 'three';
import type { MatchWorld } from '../core/matchWorld';
import type { GameSettings } from '../core/season';
import type { MatchSetup, NetGameState } from '../net/protocol';
import type { RobotCommand } from '../robot/robot';
import { RobotMirror, type RobotVisualFrame } from './robotMirror';
import { PIECE_STRIDE, type FromWorker, type HopperPhysics, type SimEvent, type SimFrame, type ToWorker } from './protocol';

/** How far behind the newest frame the page draws (s): about two physics steps, so there is nearly always a frame either side. */
const RENDER_DELAY = 0.024;
/** Frames kept for blending. */
const RING = 8;
const STATES = ['field', 'held', 'reserve'] as const;

interface Kept {
  time: number;
  visuals: RobotVisualFrame[];
  pieces: Float32Array;
}

export interface WorkerSimInit {
  settings: GameSettings;
  setup: MatchSetup;
  hopper: HopperPhysics;
  hopperMode?: 'mech' | 'stowbay';
  activeMax: number;
  log: boolean;
  speed: number;
}

/**
 * Page side of the simulation worker: starts it, forwards the driver's input, and poses the page's replica world from
 * the frames it sends — robot models node by node, pieces, clock, score and rules — drawing a moment behind the newest
 * frame so motion is blended between two physics steps.
 */
export class WorkerSim {
  state: NetGameState = 'countdown';
  countdown = 0;
  boost = false;
  /** Frames received (for stats). */
  frames = 0;
  lastFrameAt = 0;
  perf = { stepMs: 0, frameMs: 0, realHoppers: 0 };
  readonly mirrors: RobotMirror[];
  private readonly worker: Worker;
  private readonly ring: Kept[] = [];
  private rt = -1;
  private lastNow = 0;
  private ready: Promise<void>;
  private logWaiter: ((r: { text: string; frames: number }) => void) | null = null;
  private disposed = false;
  private readonly p0 = new THREE.Vector3();
  private readonly p1 = new THREE.Vector3();
  private readonly q0 = new THREE.Quaternion();
  private readonly q1 = new THREE.Quaternion();

  constructor(
    private readonly world: MatchWorld,
    init: WorkerSimInit,
    private readonly onEvent: (e: SimEvent) => void,
    private readonly onFail: (reason: string) => void,
    makeToken?: () => THREE.Object3D,
  ) {
    this.mirrors = world.robots.map((r) => new RobotMirror(r, makeToken));
    this.speed = init.speed;
    this.worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    this.ready = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('simulation worker did not start in 60 s')), 60000);
      this.worker.onmessage = (e: MessageEvent<FromWorker>) => {
        const m = e.data;
        if (m.t === 'ready') {
          clearTimeout(timer);
          const mine = this.mirrors.map((x) => x.shape);
          const bad = m.shapes.findIndex((s, i) => s !== mine[i]);
          if (bad >= 0 || m.shapes.length !== mine.length) reject(new Error(`robot ${bad} model differs between the page and the worker`));
          else resolve();
        } else if (m.t === 'error') {
          clearTimeout(timer);
          reject(new Error(m.message));
        } else this.receive(m);
      };
      this.worker.onerror = (e) => { clearTimeout(timer); reject(new Error(e.message || 'worker error')); };
    });
    this.ready.then(() => {
      this.worker.onmessage = (e: MessageEvent<FromWorker>) => this.receive(e.data);
      this.worker.onerror = (e) => this.fail(e.message || 'worker error');
    }, (err: Error) => this.fail(err.message));
    this.send({ t: 'init', ...init });
  }
  private readonly speed: number;

  get started(): Promise<void> { return this.ready; }

  private fail(reason: string): void {
    if (this.disposed) return;
    this.dispose();
    this.onFail(reason);
  }

  private send(m: ToWorker): void {
    this.worker.postMessage(m);
  }

  input(cmd: RobotCommand, hp: number[], boost?: boolean): void {
    this.send({ t: 'input', cmd, hp, ...(boost === undefined ? {} : { boost }) });
  }
  pause(): void { this.send({ t: 'pause' }); this.state = 'paused'; }
  resume(): void { this.send({ t: 'resume' }); }

  /** Finish the worker's match log and fetch it. */
  finishLog(totals?: Record<string, number>): Promise<{ text: string; frames: number }> {
    return new Promise((resolve) => {
      this.logWaiter = resolve;
      this.send({ t: 'finishLog', totals });
    });
  }

  private receive(m: FromWorker): void {
    if (m.t === 'frame') this.applyFrame(m);
    else if (m.t === 'log') { this.logWaiter?.(m); this.logWaiter = null; }
    else if (m.t === 'error') this.fail(m.message);
  }

  /** Everything that doesn't blend is applied as it arrives; poses are kept for `draw`. */
  private applyFrame(f: SimFrame): void {
    const { world } = this;
    this.frames++;
    this.lastFrameAt = performance.now();
    this.state = f.st;
    this.countdown = f.cd;
    this.boost = f.boost;
    this.perf = f.perf;
    world.clock.restore(f.clock);
    if (f.score) world.score.restore(f.score);
    if (f.rules !== undefined) world.rules.applyNetState?.(f.rules);
    for (const [i, code, owner, tag] of f.pieceStates) world.pool.applyReplicaState(i, STATES[code] ?? 'reserve', owner, tag);
    for (let i = 0; i < world.robots.length; i++) {
      const r = world.robots[i], s = f.robots[i], h = f.hud[i];
      if (s) r.applyNet(s);
      if (h) {
        r.overheadLimit = h.overheadLimit;
        r.hopperRaised = h.hopperRaised;
        r.blockerDeploy = h.blockerDeploy;
        r.config.hopperCapacity = h.hopperCapacity;
        r.packLimit = h.packLimit;
      }
      const v = f.visuals[i];
      if (v) this.mirrors[i].applyDiscrete(v);
    }
    for (const e of f.events) this.onEvent(e);
    const last = this.ring[this.ring.length - 1];
    if (last && f.time < last.time) this.ring.length = 0; // a new match on the same worker
    if (last && f.time === last.time) this.ring[this.ring.length - 1] = { time: f.time, visuals: f.visuals, pieces: f.pieces };
    else this.ring.push({ time: f.time, visuals: f.visuals, pieces: f.pieces });
    if (this.ring.length > RING) this.ring.shift();
  }

  /** Pose the page's world for this frame. */
  draw(now: number): void {
    const ring = this.ring;
    if (!ring.length) return;
    const newest = ring[ring.length - 1];
    const target = newest.time - RENDER_DELAY;
    const dt = this.lastNow ? (now - this.lastNow) / 1000 : 0;
    this.lastNow = now;
    if (this.rt < 0 || Math.abs(target - this.rt) > 0.25) this.rt = target;
    else {
      // Advance with the page clock and drift toward the target, so uneven frame arrival never shows as uneven motion.
      if (this.state === 'running' || this.state === 'countdown') this.rt += dt * this.speed;
      this.rt += (target - this.rt) * 0.1;
    }
    if (this.rt > newest.time) this.rt = newest.time;
    let b = ring.length - 1;
    while (b > 0 && ring[b - 1].time >= this.rt) b--;
    const fb = ring[b], fa = ring[Math.max(0, b - 1)];
    const k = fb === fa || fb.time <= fa.time ? 1 : Math.min(1, Math.max(0, (this.rt - fa.time) / (fb.time - fa.time)));
    for (let i = 0; i < this.mirrors.length; i++) {
      const va = fa.visuals[i], vb = fb.visuals[i];
      if (!vb) continue;
      this.mirrors[i].applyNodes(va?.nodes ?? vb.nodes, vb.nodes, k);
      this.mirrors[i].applyTokens(va?.tokens ?? vb.tokens, vb.tokens, k);
    }
    this.drawPieces(fa.pieces, fb.pieces, k);
  }

  private drawPieces(a: Float32Array, b: Float32Array, k: number): void {
    const pool = this.world.pool;
    const n = Math.min(pool.count, b.length / PIECE_STRIDE);
    for (let i = 0; i < n; i++) {
      const j = i * PIECE_STRIDE;
      if (!b[j]) { pool.drawMirror(i, null); continue; }
      this.p1.set(b[j + 1], b[j + 2], b[j + 3]);
      this.q1.set(b[j + 4], b[j + 5], b[j + 6], b[j + 7]);
      if (k < 1 && a !== b && a[j]) {
        this.p0.set(a[j + 1], a[j + 2], a[j + 3]);
        // A piece that jumped (launched, handed off, reset) is drawn where it is, not streaked.
        if (this.p0.distanceToSquared(this.p1) < 0.25) {
          this.p1.lerpVectors(this.p0, this.p1, k);
          this.q1.slerpQuaternions(this.q0.set(a[j + 4], a[j + 5], a[j + 6], a[j + 7]), this.q1, k);
        }
      }
      pool.drawMirror(i, this.p1, this.q1);
    }
    pool.flushMirror();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.worker.terminate();
  }
}
