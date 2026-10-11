/**
 * SIMULATION WORKER — runs a single-player match (Rapier physics, robots, AI, rules) off the page's main thread, so the
 * page only reads input and draws. Every batch of physics steps it posts a SimFrame: robot model poses (RobotMirror),
 * piece poses, clock, score, rules state and HUD events. See WorkerSim for the page side.
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
import { RobotMirror } from './robotMirror';
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

scope.onmessage = (e: MessageEvent<ToWorker>) => {
  const m = e.data;
  try {
    if (m.t === 'init') void init(m);
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
    }
  } catch (err) {
    post({ t: 'error', message: err instanceof Error ? `${err.message}\n${err.stack}` : String(err) });
  }
};

async function init(m: Extract<ToWorker, { t: 'init' }>): Promise<void> {
  try {
    const R = await loadRapier();
    const season = getSeason(m.settings.seasonId);
    await prepareCadModels(m.setup.robots.map((r) => r.config.model));
    StowBay.ACTIVE_MAX = m.activeMax;
    speed = m.speed;
    const playerId = m.setup.robots[0]?.id ?? null;
    const settings = m.settings;
    world = new MatchWorld(R, season, m.setup, {
      scene: new THREE.Scene(),
      playerId,
      realHopper: (rs) => m.hopper === 'all' || (m.hopper === 'player' && rs.id === playerId),
      pieceFlow: true,
      optimize: true,
      aiSettings: botSettings(m.setup, settings),
    }, {
      toast: (msg, kind, alliance, robot) => events.push({ k: 'toast', msg, kind, alliance, robot: robot?.id }),
      cue: (robot, text, cls) => events.push({ k: 'cue', robot: robot.id, text, cls }),
      humanPlayerIsAuto: (a) => !player || a !== player.alliance || settings.autoHumanPlayer,
    });
    player = world.player;
    // The page shows the driver's intake guide on its copy; the mirror copies node visibility from here.
    player?.showIntakeGuide(true);
    sim = new MatchSim(world, season, settings, {
      periodChange: (ch) => events.push({ k: 'period', ch }),
      results: (res) => events.push({ k: 'results', res }),
    }, m.log ? { log: { mode: 'local' } } : {});
    mirrors = world.robots.map((r) => new RobotMirror(r));
    post({ t: 'ready', shapes: mirrors.map((x) => x.shape) });
    last = performance.now();
    loop();
  } catch (err) {
    post({ t: 'error', message: err instanceof Error ? `${err.message}\n${err.stack}` : String(err) });
  }
}

let last = 0;
let acc = 0;
let stepMs = 0;
let frameMs = 0;

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
        command: (r) => (r === p ? cmd : IDLE_COMMAND),
        humanPlayer: p ? hp.splice(0).map((b) => [p.alliance, b] as [typeof p.alliance, number]) : [],
      });
      acc -= dt;
      steps++;
      const t1 = performance.now();
      stepMs += (t1 - t0) * 0.02 - stepMs * 0.02;
      t0 = t1;
    }
    if (steps === max) acc = 0;
  } else acc = 0;
  // Keep the page in step while nothing moves (paused, results) at a low rate; every batch of steps otherwise.
  if (steps > 0 || events.length || sim.state !== lastState || now - lastFrameAt > 250) sendFrame(steps * dt, now);
  setTimeout(loop, 1);
}

function sendFrame(stepped: number, now: number): void {
  const s = sim!, w = world!;
  const f0 = performance.now();
  lastFrameAt = now;
  lastState = s.state;
  const transfer: Transferable[] = [];
  const clock = w.clock;
  const climbReady = clock.started && !clock.finished && clock.current.mode === 'teleop' && clock.driveRemaining <= (s.season.endgameSeconds ?? 30);
  const visuals = w.robots.map((r, i) => {
    r.climbReady = climbReady;
    r.syncVisual(stepped);
    const v = mirrors[i].capture(firstFrame);
    transfer.push(v.nodes.buffer, v.mats.buffer, v.tokens.buffer);
    for (const inst of v.inst) transfer.push(inst.matrices.buffer);
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
  const changed = firstFrame ? [...Array(pool.count).keys()] : pool.takeChanges();
  if (firstFrame) pool.takeChanges();
  for (const i of changed) pieceStates.push([i, pool.state[i] === 'field' ? 0 : pool.state[i] === 'held' ? 1 : 2, pool.owner[i], pool.tag[i]]);
  const score = w.score.snapshot();
  const scoreKey = JSON.stringify(score);
  const rulesState = w.rules.netState?.();
  const rulesKey = rulesState === undefined ? '' : JSON.stringify(rulesState);
  for (const m of radioFor(w.ctx).since(radioSeq)) { radioSeq = m.seq; events.push({ k: 'radio', m }); }
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
    perf: { stepMs, frameMs, realHoppers: w.robots.filter((r) => r.bay).length },
  };
  lastScore = scoreKey;
  lastRules = rulesKey;
  firstFrame = false;
  post(frame, transfer);
  frameMs += (performance.now() - f0 - frameMs) * 0.05;
}
