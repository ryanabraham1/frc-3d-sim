/**
 * SIMULATION WORKER — runs a match (Rapier physics, robots, AI, rules) off the page's main thread, so the page only reads
 * input and draws. Every batch of physics steps it posts a SimFrame: robot model poses (RobotMirror), piece poses, clock,
 * score, rules state and HUD events. See WorkerSim for the page side. A multiplayer host's match runs here too: remote
 * drivers' commands come in through the page, encoded snapshots go out through it (HostStream).
 */
import './workerShim';
import * as THREE from 'three';
import { loadRapier } from '../physics/world';
import { getSeason } from '../../seasons';
import { prepareCadModels } from '../robot/cadModels';
import { StowBay } from '../robot/stowBay';
import { IDLE_COMMAND, type Robot, type RobotCommand } from '../robot/robot';
import { MatchWorld } from '../core/matchWorld';
import { MatchSim, botSettings } from '../core/matchSim';
import { radioFor } from '../ai/team';
import { compressCheckpoint } from '../net/recovery';
import { RobotMirror } from './robotMirror';
import { HostStream } from './hostStream';
import { syncWorldVisuals } from './worldVisuals';
import type { Alliance } from '../coords';
import { PIECE_STRIDE, type FromWorker, type RobotHudState, type SimEvent, type SimFrame, type ToWorker } from './protocol';

const scope = self as unknown as { postMessage(m: unknown, transfer: Transferable[]): void; onmessage: ((e: MessageEvent<ToWorker>) => void) | null };
const post = (m: FromWorker, transfer: Transferable[] = []) => scope.postMessage(m, transfer);

let sim: MatchSim | null = null;
let world: MatchWorld | null = null;
let mirrors: RobotMirror[] = [];
let player: Robot | null = null;
let cmd: RobotCommand = IDLE_COMMAND;
const hp: number[] = [];
let speed = 1;
const events: SimEvent[] = [];
let lastScore = '';
let lastRules = '';
let radioSeq = 0;
let firstFrame = true;
let lastFrameAt = 0;
let lastState = '';
let warming: Promise<unknown> = Promise.resolve();
/** Multiplayer host: the network half. */
let stream: HostStream | null = null;
const remoteHp: [Alliance, number][] = [];
/** Host: frames the page hasn't applied yet (a busy page must not collect stale ones ahead of the snapshots). */
let framesInFlight = 0;
const MAX_FRAMES_IN_FLIGHT = 3;
/** Sent while the world was still loading: the page doesn't wait for `ready` before it talks. */
let early: ToWorker[] | null = [];

scope.onmessage = (e: MessageEvent<ToWorker>) => handle(e.data);

function handle(m: ToWorker): void {
  try {
    if (early && m.t !== 'warm' && m.t !== 'init') early.push(m);
    else if (m.t === 'warm') {
      warming = Promise.all([loadRapier(), prepareCadModels(m.models, { detail: m.cadDetail })]);
      // init reports failures through the normal worker fallback.
      void warming.catch(() => {});
    } else if (m.t === 'init') void init(m);
    else if (m.t === 'start' && sim) { last = performance.now(); loop(); }
    else if (m.t === 'input') {
      cmd = m.cmd;
      hp.push(...m.hp);
      if (m.boost !== undefined && sim && m.boost !== sim.boost) sim.setBoost(player, m.boost);
    } else if (m.t === 'pause') sim?.pause();
    else if (m.t === 'resume') { sim?.resume(); last = performance.now(); }
    else if (m.t === 'finishLog') {
      const log = sim?.matchLog;
      if (log) {
        log.finish(m.totals);
        post({ t: 'log', text: log.toJSONL(), frames: log.frameCount });
      }
    } else if (m.t === 'remoteCmd') stream?.setCommand(m.robot, m.cmd, m.seq);
    else if (m.t === 'dropCmds') stream?.dropCommands(m.robot);
    else if (m.t === 'remoteHp') remoteHp.push([m.alliance, m.button]);
    else if (m.t === 'keyframe') stream?.requestKeyframe();
    else if (m.t === 'link') stream?.setLink(m.connected, m.clear);
    else if (m.t === 'snapshotSent') stream?.ack();
    else if (m.t === 'frameDone') framesInFlight = Math.max(0, framesInFlight - 1);
    else if (m.t === 'allReady') { if (sim?.allReady()) events.push({ k: 'countdown' }); }
    else if (m.t === 'checkpoint') void checkpoint();
    else if (m.t === 'restore' && sim) {
      sim.restoreRecovery(m.state);
      acc = 0;
      stream?.requestKeyframe();
      if (sim.state === 'results' && sim.results) events.push({ k: 'results', res: sim.results });
      events.push({ k: 'restored', paused: sim.state === 'paused' });
      sendFrame(0, performance.now());
    }
  } catch (err) {
    post({ t: 'error', message: err instanceof Error ? `${err.message}\n${err.stack}` : String(err) });
  }
}

/** Capture, serialize and compress here: a checkpoint is the one big job a host has every few seconds. */
async function checkpoint(): Promise<void> {
  if (!sim?.world.rules.recoveryState) return;
  try {
    const t0 = performance.now();
    const json = JSON.stringify(sim.recoveryState());
    checkpointMs = performance.now() - t0;
    post({ t: 'checkpoint', data: await compressCheckpoint(json) });
  } catch (err) {
    // A failed checkpoint only costs the next recovery its freshness; it's no reason to stop the match.
    console.warn('[sim] checkpoint failed', err);
  }
}

async function init(m: Extract<ToWorker, { t: 'init' }>): Promise<void> {
  try {
    await warming;
    const R = await loadRapier();
    const season = getSeason(m.settings.seasonId);
    await prepareCadModels(m.setup.robots.map((r) => r.config.model), { detail: m.cadDetail });
    StowBay.ACTIVE_MAX = m.activeMax;
    speed = m.speed;
    const { playerId, role, setup } = m;
    const host = role === 'host';
    const settings = m.settings;
    world = new MatchWorld(R, season, m.setup, {
      scene: new THREE.Scene(),
      playerId,
      realHopper: (rs) => m.hopper === 'all' || (m.hopper === 'player' && rs.id === playerId),
      hopperMode: m.hopperMode,
      pieceFlow: true,
      lightweight: host,
      optimize: true,
      aiSettings: botSettings(m.setup, settings),
    }, {
      toast: (msg, kind, alliance, robot) => events.push({ k: 'toast', msg, kind, alliance, robot: robot?.id }),
      cue: (robot, text, cls) => events.push({ k: 'cue', robot: robot.id, text, cls }),
      humanPlayerIsAuto: (a) => host ? setup.autoHumanPlayer || !setup.robots.some((r) => r.alliance === a && !r.bot) : !player || a !== player.alliance || settings.autoHumanPlayer,
    });
    player = world.player;
    // The page shows the driver's intake guide on its copy; the mirror copies node visibility from here.
    player?.showIntakeGuide(true);
    sim = new MatchSim(world, season, settings, {
      periodChange: (ch) => events.push({ k: 'period', ch }),
      results: (res) => events.push({ k: 'results', res }),
      ghost: (run) => events.push({ k: 'ghost', run }),
    }, { ...(m.log ? { log: { mode: role } } : {}), ghost: m.ghost });
    if (host) {
      const s = sim, w = world;
      s.state = 'waiting';
      stream = new HostStream({
        pool: w.pool, robots: w.robots, clock: w.clock, score: w.score, rules: w.rules,
        get netState() { return s.state; },
        get countdownLeft() { return s.countdown; },
        get lastResults() { return s.results; },
      }, (buf) => post({ t: 'snapshot', buf }, [buf]));
    }
    mirrors = world.robots.map((r) => new RobotMirror(r));
    post({ t: 'ready', shapes: mirrors.map((x) => x.shape) });
    // The view starts the countdown after its shaders and first GPU upload are ready.
    sendFrame(0, performance.now());
    const waiting = early ?? [];
    early = null;
    for (const msg of waiting) handle(msg);
  } catch (err) {
    post({ t: 'error', message: err instanceof Error ? `${err.message}\n${err.stack}` : String(err) });
  }
}

let last = 0;
let acc = 0;
let stepMs = 0;
let frameMs = 0;
let tickMs = 0;
let tickMaxMs = 0;
let checkpointMs = 0;
let load = 0;
let windowMax = 0;
let windowBusy = 0;
let windowStart = 0;

function loop(): void {
  if (!sim || !world) return;
  const now = performance.now();
  const dt = sim.dt;
  acc += Math.min(0.1, (now - last) / 1000) * speed;
  last = now;
  let steps = 0;
  if (sim.stepping) {
    const max = Math.ceil(5 * Math.max(1, speed));
    let t0 = performance.now();
    while (acc >= dt && steps < max) {
      const p = player;
      sim.step(dt, {
        command: (r) => (r === p ? cmd : stream?.command(r.id) ?? IDLE_COMMAND),
        humanPlayer: [...(p ? hp.splice(0).map((b) => [p.alliance, b] as [Alliance, number]) : []), ...remoteHp.splice(0)],
      });
      acc -= dt;
      steps++;
      const t1 = performance.now();
      stepMs += (t1 - t0) * 0.02 - stepMs * 0.02;
      t0 = t1;
    }
    if (steps === max) acc = 0;
  } else acc = 0;
  // Snapshots go first: every guest is waiting on them, and only this screen on the frame.
  stream?.update(steps, sim.stepping, sim.simTime, now);
  pendingVisual += steps * dt;
  // Keep the page in step while nothing moves (paused, results) at a low rate; every batch of steps otherwise.
  if ((steps > 0 || events.length || sim.state !== lastState || now - lastFrameAt > 250) && (!stream || framesInFlight < MAX_FRAMES_IN_FLIGHT)) {
    sendFrame(pendingVisual, now);
    pendingVisual = 0;
  }
  noteTick(now, performance.now() - now);
  setTimeout(loop, 1);
}

/** Time the visuals still have to catch up on (a host can skip frames while its page is busy). */
let pendingVisual = 0;

function noteTick(now: number, ms: number): void {
  tickMs += (ms - tickMs) * 0.05;
  windowBusy += ms;
  if (ms > windowMax) windowMax = ms;
  if (now - windowStart < 500) return;
  load = windowStart ? windowBusy / (now - windowStart) : 0;
  tickMaxMs = windowMax;
  windowBusy = windowMax = 0;
  windowStart = now;
}

function sendFrame(stepped: number, now: number): void {
  const s = sim!, w = world!;
  const f0 = performance.now();
  lastFrameAt = now;
  lastState = s.state;
  if (stream) framesInFlight++;
  const transfer: Transferable[] = [];
  const clock = w.clock;
  const climbReady = clock.started && !clock.finished && clock.current.mode === 'teleop' && clock.driveRemaining <= (s.season.endgameSeconds ?? 30);
  syncWorldVisuals(w, stepped, s.simTime, climbReady);
  const visuals = mirrors.map((mirror) => {
    const v = mirror.capture(firstFrame);
    transfer.push(v.nodes.buffer, v.mats.buffer, v.tokens.buffer);
    for (const inst of v.inst) transfer.push(inst.matrices.buffer);
    for (const geometry of v.geometry) transfer.push(geometry.positions.buffer);
    return v;
  });
  const pool = w.pool;
  const pieces = new Float32Array(pool.count * PIECE_STRIDE);
  for (let i = 0; i < pool.count; i++) {
    if (!pool.isDrawn(i)) continue;
    const b = pool.bodies[i], t = b.translation(), q = b.rotation(), j = i * PIECE_STRIDE;
    pieces[j] = 1;
    pieces[j + 1] = t.x; pieces[j + 2] = t.y; pieces[j + 3] = t.z;
    pieces[j + 4] = q.x; pieces[j + 5] = q.y; pieces[j + 6] = q.z; pieces[j + 7] = q.w;
  }
  transfer.push(pieces.buffer);
  const pieceStates: SimFrame['pieceStates'] = [];
  const taken = stream ? stream.takeFrameChanges() : pool.takeChanges();
  const changed = firstFrame ? [...Array(pool.count).keys()] : taken;
  for (const i of changed) pieceStates.push([i, pool.state[i] === 'field' ? 0 : pool.state[i] === 'held' ? 1 : 2, pool.owner[i], pool.tag[i]]);
  const score = w.score.snapshot();
  const scoreKey = JSON.stringify(score);
  const rulesState = w.rules.netState?.();
  const rulesKey = rulesState === undefined ? '' : JSON.stringify(rulesState);
  // Only the solo screen shows the AI's radio.
  if (!stream) for (const m of radioFor(w.ctx).since(radioSeq)) { radioSeq = m.seq; events.push({ k: 'radio', m }); }
  const hud: RobotHudState[] = w.robots.map((r) => ({ overheadLimit: r.overheadLimit, hopperRaised: r.hopperRaised, blockerDeploy: r.blockerDeploy, hopperCapacity: r.config.hopperCapacity, packLimit: r.packLimit }));
  const frame: SimFrame = {
    t: 'frame',
    time: s.simTime,
    st: s.state,
    cd: s.countdown,
    clock: w.clock.snapshot(),
    ...(scoreKey !== lastScore ? { score } : {}),
    ...(rulesKey !== lastRules ? { rules: rulesState } : {}),
    robots: w.robots.map((r) => r.netState()),
    hud,
    visuals,
    pieces,
    pieceStates,
    events: events.splice(0),
    boost: s.boost,
    perf: { stepMs, frameMs, tickMs, tickMaxMs, checkpointMs, load, realHoppers: w.robots.filter((r) => r.bay || r.mech).length },
  };
  lastScore = scoreKey;
  lastRules = rulesKey;
  firstFrame = false;
  post(frame, transfer);
  frameMs += (performance.now() - f0 - frameMs) * 0.05;
}
