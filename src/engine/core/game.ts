import { CameraRig, CAMERA_LABELS } from '../camera/cameras';
import { Alliance, FieldFrame } from '../coords';
import { FieldBuilder } from '../field/builder';
import { GamePiecePool } from '../gamepiece/pool';
import { Hud } from '../hud/hud';
import { DEFAULT_CONTROLS_HELP, DriverInput, InputManager } from '../input/input';
import { MatchClock, PeriodChange } from '../match/clock';
import { Scoreboard } from '../match/scoreboard';
import { ClientSync } from '../net/clientSync';
import { HostSync } from '../net/hostSync';
import { Predictor } from '../net/prediction';
import type { NetClient } from '../net/netClient';
import type { HostMsg, MatchSetup, NetGameState, RobotSetup } from '../net/protocol';
import { slotId } from '../net/protocol';
import { Ticker } from '../net/ticker';
import { PhysicsWorld, RapierModule } from '../physics/world';
import { Rng } from '../random';
import { Renderer } from '../render/renderer';
import { sanitizeConfig } from '../robot/config';
import { IDLE_COMMAND, Robot, RobotCommand } from '../robot/robot';
import { clamp, formatClock } from '../units';
import type { AutoPilot, GameSettings, MatchResults, SeasonContext, SeasonDefinition, SeasonHud, SeasonRules, ToastKind } from './season';

type GameState = NetGameState;

/**
 * local  — singleplayer: this page simulates everything.
 * host   — multiplayer authority: simulates everything, applies remote drivers' commands, streams snapshots.
 * client — multiplayer replica: never steps physics; renders host snapshots and sends its driver's commands.
 */
export type GameRole = 'local' | 'host' | 'client';

export interface GameNet {
  role: 'host' | 'client';
  client: NetClient;
  setup: MatchSetup;
}

export interface GameCallbacks {
  /** Leave to the main menu (multiplayer: also leaves/closes the room). */
  onExit: () => void;
  /** Singleplayer restart. */
  onRestart: (settings: GameSettings) => void;
  /** Multiplayer host: restart with the same lobby. */
  onPlayAgain?: () => void;
  /** Multiplayer host: everyone back to the lobby. */
  onBackToLobby?: () => void;
}

const PRE_MATCH_COUNTDOWN = 3;
/** Host streams a snapshot every N physics steps (90 Hz / 3 = 30 Hz). */
const SNAPSHOT_EVERY_STEPS = 3;

/** Singleplayer: a one-robot MatchSetup from the menu settings. */
export function localSetup(s: GameSettings): MatchSetup {
  return {
    seasonId: s.seasonId,
    seed: s.seed,
    autoHumanPlayer: s.autoHumanPlayer,
    peers: [],
    robots: [
      {
        id: 0,
        slot: slotId(s.alliance, s.station),
        alliance: s.alliance,
        station: s.station,
        config: s.robot,
        autoRoutine: s.autoRoutine,
        manualAuto: s.manualAuto,
        peerId: '',
        name: 'You',
      },
    ],
  };
}

/**
 * Orchestrates one match: builds the world from a SeasonDefinition, runs a fixed-step simulation,
 * routes input (or the AUTO autopilot, or remote drivers) to robots, and drives HUD + camera. Year-agnostic.
 */
export class Game {
  readonly role: GameRole;
  readonly setup: MatchSetup;
  readonly frame: FieldFrame;
  readonly renderer: Renderer;
  readonly physics: PhysicsWorld;
  readonly builder: FieldBuilder;
  readonly pool: GamePiecePool;
  readonly robots: Robot[] = [];
  readonly clock: MatchClock;
  readonly score: Scoreboard;
  readonly rng: Rng;
  readonly hud: Hud;
  readonly rules: SeasonRules;
  readonly ctx: SeasonContext;
  readonly camera: CameraRig;
  readonly input = new InputManager();
  /** AUTO-period drivers per robot id (drivers can't control robots in AUTO). */
  private readonly autoPilots = new Map<number, AutoPilot>();
  private readonly robotSetups = new Map<number, RobotSetup>();
  private readonly seasonHud: SeasonHud;
  /** The robot driven from this screen (null = multiplayer spectator). */
  readonly player: Robot | null;
  readonly hostSync: HostSync | null = null;
  readonly clientSync: ClientSync | null = null;
  /** Client-side prediction of this screen's own robot (clients only). */
  readonly predictor: Predictor | null = null;
  private readonly net: GameNet | null;
  private readonly offs: (() => void)[] = [];
  private ticker: Ticker | null = null;

  private state: GameState = 'countdown';
  private countdown = PRE_MATCH_COUNTDOWN;
  private raf = 0;
  private last = 0;
  private lastDraw = 0;
  private acc = 0;
  private time = 0;
  /** Host sim time (s) — advances only while stepping. */
  private simTime = 0;
  private stepsSinceSnap = 0;
  private lastIdleSnap = 0;
  private lastPredict = 0;
  private fpsAcc = 0;
  private fpsFrames = 0;
  private autoIntake: boolean;
  climbLevel: number;
  scoringLevel = 4;
  private results: MatchResults | null = null;
  private pausedFrom: GameState = 'countdown';
  /** Client-side modal currently shown. */
  private clientModal: 'none' | 'local' | 'host-pause' | 'results' | 'closed' = 'none';
  private lastClockKey = '';
  private lastNetState: GameState | null = null;
  private disposed = false;

  constructor(
    container: HTMLElement,
    R: RapierModule,
    readonly season: SeasonDefinition,
    readonly settings: GameSettings,
    private readonly callbacks: GameCallbacks,
    net?: GameNet,
  ) {
    this.net = net ?? null;
    this.role = net?.role ?? 'local';
    this.setup = net?.setup ?? localSetup(settings);
    this.frame = new FieldFrame(season.fieldLength, season.fieldWidth);
    this.renderer = new Renderer(container, season.fieldLength, season.fieldWidth, { shadows: settings.shadows });
    this.physics = new PhysicsWorld(R, 1 / 90);
    this.builder = new FieldBuilder(this.physics, this.renderer.scene, this.frame);
    this.rng = new Rng(this.setup.seed);
    this.clock = new MatchClock(season.timeline);
    this.score = new Scoreboard(season.foulValues);
    this.hud = new Hud(container, season.controlsHelp ?? DEFAULT_CONTROLS_HELP);
    this.pool = new GamePiecePool(this.physics, this.renderer.scene, this.frame, season.gamePiece);
    this.autoIntake = settings.autoIntake;

    // Every robot on the field is driven by a human (locally or over the network) — no bot AI.
    for (const rs of this.setup.robots) {
      const cfg = season.normalizeRobotConfig?.(rs.config) ?? sanitizeConfig(rs.config, season.maxRobotHeight, season.maxRobotPerimeter);
      const robot = new Robot(this.physics, this.renderer.scene, this.frame, cfg, rs.alliance, rs.id, rs.station, season.startPose(rs.alliance, rs.station));
      robot.projectile = { radius: season.gamePiece.radius, airDamping: season.gamePiece.airDamping ?? 0.02 };
      robot.controller = 'player';
      season.configureRobot?.(robot);
      this.robots.push(robot);
      this.robotSetups.set(rs.id, rs);
    }
    const mine = net ? this.setup.robots.find((r) => r.peerId === net.client.peerId) : this.setup.robots[0];
    this.player = mine ? this.robots.find((r) => r.id === mine.id)! : null;
    this.scoringLevel = Math.min(this.scoringLevel, this.player?.config.placement?.maxLevel ?? this.scoringLevel);
    this.climbLevel = Math.min(season.maxClimbLevel, this.player?.config.climber.maxLevel ?? season.maxClimbLevel);

    const self = this;
    this.ctx = {
      physics: this.physics,
      scene: this.renderer.scene,
      frame: this.frame,
      builder: this.builder,
      pool: this.pool,
      robots: this.robots,
      clock: this.clock,
      score: this.score,
      rng: this.rng,
      hud: this.hud,
      settings,
      playerRobot: this.player,
      toast(msg: string, kind: ToastKind = 'info', alliance?: Alliance, robot?: Robot) {
        self.toast(msg, kind, alliance, robot);
      },
      humanPlayerIsAuto(a: Alliance) {
        if (self.role === 'local') return !self.player || a !== self.player.alliance || self.settings.autoHumanPlayer;
        return self.setup.autoHumanPlayer || !self.setup.robots.some((r) => r.alliance === a);
      },
    };

    season.buildField(this.ctx);
    this.rules = season.createRules(this.ctx);

    if (this.role === 'client') {
      // Replica: piece/robot state arrives in snapshots; nothing is staged or simulated here.
      // Other robots are posed from snapshots (kinematic); our own stays dynamic for prediction.
      for (const r of this.robots) {
        if (r !== this.player) r.body.setBodyType(R.RigidBodyType.KinematicPositionBased, true);
      }
      this.clientSync = new ClientSync(net!.client, this);
      if (this.player) this.predictor = new Predictor(this.player);
      this.state = 'waiting';
      this.offs.push(
        net!.client.on('binary', (buf) => {
          const now = performance.now();
          const snap = this.clientSync!.onBinary(buf, now);
          const mine = snap && this.player ? snap.robots.find((r) => r.id === this.player!.id) : undefined;
          if (mine) this.predictor!.onSnapshot(mine, now, snap!.meta.st === 'running');
        }),
      );
      this.offs.push(
        net!.client.on('msg', ({ data }) => {
          const m = data as HostMsg;
          if (m?.t === 'toast') this.hud.toast(m.msg, m.kind, m.alliance);
          if (m?.t === 'notice') this.hud.toast(m.message, 'warn');
        }),
      );
    } else {
      this.rules.stage();
      for (const r of this.robots) {
        const rs = this.robotSetups.get(r.id)!;
        this.autoPilots.set(r.id, season.createAutoPilot(this.ctx, this.rules, r, rs.autoRoutine));
      }
    }

    if (this.role === 'host') {
      this.state = 'waiting';
      this.hostSync = new HostSync(net!.client, this.setup, this, {
        humanPlayer: (robot, _peer, button) => {
          if (robot && this.state === 'running' && button <= (this.season.humanPlayerButtons ?? 1)) this.rules.humanPlayerAction(robot.alliance, button);
        },
        allReady: () => {
          if (this.state === 'paused' && this.pausedFrom === 'waiting') {
            this.pausedFrom = 'countdown';
            this.countdown = PRE_MATCH_COUNTDOWN;
            return;
          }
          if (this.state !== 'waiting') return;
          this.state = 'countdown';
          this.countdown = PRE_MATCH_COUNTDOWN;
          this.hud.showBanner('ROBOTS READY', PRE_MATCH_COUNTDOWN);
        },
        peerLeft: (peerId, robot) => {
          const rs = this.setup.robots.find((r) => r.peerId === peerId);
          if (rs && robot) this.toast(`${rs.name} (${robot.config.teamNumber}) disconnected — robot idle`, 'warn');
        },
      });
    }

    if (this.net) {
      this.offs.push(
        this.net.client.on('closed', ({ reason }) => {
          if (this.disposed) return;
          this.clientModal = 'closed';
          if (this.state !== 'results') this.state = 'paused';
          this.hud.showModal('Disconnected', `<p>${reason}.</p>`, [{ label: 'Main menu', primary: true, onClick: () => this.callbacks.onExit() }]);
        }),
      );
    }

    const eye = this.player ?? this.robots[0];
    const eyePos = eye ? season.driverEye(eye.alliance, eye.station) : season.driverEye(settings.alliance, settings.station);
    this.camera = new CameraRig(this.renderer.camera, this.renderer.renderer.domElement, this.frame, eyePos);
    this.camera.setMode(this.player ? (settings.camera ?? 'driver') : 'overhead');
    this.seasonHud = season.createHud(this.ctx, this.rules, this.hud.slots);
    if (this.state === 'waiting') this.hud.showBanner('WAITING FOR PLAYERS…', 60);
    else this.hud.showBanner('ROBOTS READY', PRE_MATCH_COUNTDOWN);
    this.hud.toggleHelp(true);
    setTimeout(() => !this.disposed && this.hud.toggleHelp(false), 6000);

    if (this.role === 'client') net!.client.send({ t: 'ready' });
  }

  // ─────────────────────────── HostSync source ───────────────────────────

  get netState(): NetGameState {
    return this.state;
  }
  get countdownLeft(): number {
    return this.countdown;
  }
  get lastResults(): MatchResults | null {
    return this.results;
  }

  // ─────────────────────────── loop ───────────────────────────

  start(): void {
    this.last = this.lastDraw = performance.now();
    if (this.role === 'host') {
      // The simulation must keep running when the host tab is hidden (rAF stops) — drive it from a worker.
      this.ticker = new Ticker((now) => !this.disposed && this.tick(now));
      this.ticker.start();
    }
    const loop = (now: number) => {
      if (this.disposed) return;
      this.raf = requestAnimationFrame(loop);
      if (this.role !== 'host') this.tick(now);
      this.draw(now);
    };
    this.raf = requestAnimationFrame(loop);
  }

  /** Input + simulation (host/local) or input + command send (client). */
  private tick(now: number): void {
    const dt = clamp((now - this.last) / 1000, 0, 0.1);
    this.last = now;
    const inp = this.input.read();
    this.handleUiInput(inp);

    if (this.role === 'client') {
      this.clientTick(inp, now);
      return;
    }

    if (this.state === 'countdown' || this.state === 'running') {
      const fixed = this.physics.dt;
      this.acc += dt;
      let steps = 0;
      while (this.acc >= fixed && steps < 5) {
        this.step(fixed, inp);
        this.acc -= fixed;
        steps++;
        this.simTime += fixed;
        this.stepsSinceSnap++;
        if (this.hostSync && this.stepsSinceSnap >= SNAPSHOT_EVERY_STEPS) {
          this.stepsSinceSnap = 0;
          this.hostSync.sendSnapshot(this.simTime);
        }
        // Edge-triggered inputs apply to the first step only.
        inp.humanPlayer = false;
        inp.humanPlayerAlt = 0;
      }
      if (steps === 5) this.acc = 0;
    } else if (this.hostSync && now - this.lastIdleSnap > 200) {
      // Waiting / paused / results: keep clients in sync at a low rate.
      this.lastIdleSnap = now;
      this.hostSync.sendSnapshot(this.simTime);
    }
  }

  private draw(now: number): void {
    const dt = clamp((now - this.lastDraw) / 1000, 0, 0.1);
    this.lastDraw = now;
    this.time += dt;
    if (this.clientSync) {
      const predicted = this.predictor?.active ? this.player : null;
      this.clientSync.interpolate(now, predicted?.id ?? null);
      const latest = predicted && this.clientSync.latest.get(predicted.id);
      if (latest) predicted.applyNetDiscrete(latest);
      this.syncClientState();
    }
    this.rules.updateVisuals(dt, this.time);
    for (const r of this.robots) r.syncVisual();
    this.pool.syncVisuals();
    this.camera.update(dt, this.player?.pose ?? null, undefined, this.player?.elevation ?? 0);
    this.updateHud(dt);
    this.renderer.render();

    this.fpsAcc += dt;
    this.fpsFrames++;
    if (this.fpsAcc > 0.5) {
      this.hud.setFps(this.fpsFrames / this.fpsAcc);
      this.fpsAcc = 0;
      this.fpsFrames = 0;
    }
  }

  private handleUiInput(inp: DriverInput): void {
    if (inp.toggleHelp) this.hud.toggleHelp();
    if (inp.cameraNext) {
      const m = this.camera.next();
      this.hud.toast(`Camera: ${CAMERA_LABELS[m]}`);
    }
    if (inp.pause) {
      if (this.role === 'client') this.toggleClientMenu();
      else if (this.state === 'paused') this.resume();
      else if (this.state === 'running' || this.state === 'countdown' || this.state === 'waiting') this.pause();
    }
    if (inp.restart && (this.state === 'paused' || this.state === 'results')) {
      if (this.role === 'local') this.callbacks.onRestart(this.settings);
      else if (this.role === 'host') this.callbacks.onPlayAgain?.();
    }
    const maxLvl = Math.min(this.season.maxClimbLevel, this.player?.config.climber.maxLevel ?? 0);
    if (this.season.maxScoringLevel) {
      const maxScoring = Math.min(this.season.maxScoringLevel, this.player?.config.placement?.maxLevel ?? this.season.maxScoringLevel);
      if (inp.setLevel !== null) this.scoringLevel = clamp(inp.setLevel, 1, maxScoring);
      if (inp.levelUp) this.scoringLevel = clamp(this.scoringLevel + 1, 1, maxScoring);
      if (inp.levelDown) this.scoringLevel = clamp(this.scoringLevel - 1, 1, maxScoring);
    } else {
      if (inp.setLevel !== null) this.climbLevel = clamp(inp.setLevel, 1, Math.max(1, maxLvl));
      if (inp.levelUp) this.climbLevel = clamp(this.climbLevel + 1, 1, Math.max(1, maxLvl));
      if (inp.levelDown) this.climbLevel = clamp(this.climbLevel - 1, 1, Math.max(1, maxLvl));
    }
    if (inp.toggleIntake) {
      this.autoIntake = !this.autoIntake;
      this.hud.toast(`Auto-intake ${this.autoIntake ? 'ON' : 'OFF'}`);
    }
  }

  private playerCommand(inp: DriverInput, robot: Robot): RobotCommand {
    const ref = this.camera.referenceYaw;
    const scale = inp.precision ? 0.35 : 1;
    let f = inp.forward;
    let l = inp.left;
    const m = Math.hypot(f, l);
    if (m > 1) {
      f /= m;
      l /= m;
    }
    const sp = robot.config.maxSpeed * scale;
    return {
      vx: (f * Math.cos(ref) - l * Math.sin(ref)) * sp,
      vy: (f * Math.sin(ref) + l * Math.cos(ref)) * sp,
      omega: inp.rotate * robot.config.maxOmega * (inp.precision ? 0.35 : 0.75),
      intake: this.autoIntake || inp.intake,
      shoot: inp.shoot,
      pass: inp.pass,
      climb: inp.climb ? this.climbLevel : null,
      descend: inp.descend,
      ...(this.season.maxScoringLevel ? { scoringLevel: this.scoringLevel } : {}),
    };
  }

  /** Is robot `r` under driver control right now (vs. its AUTO routine)? */
  private manual(r: Robot): boolean {
    return this.clock.mode === 'teleop' || (this.robotSetups.get(r.id)?.manualAuto ?? false);
  }

  private step(dt: number, inp: DriverInput): void {
    if (this.state === 'countdown') {
      this.countdown -= dt;
      if (this.countdown <= 0) {
        this.state = 'running';
        this.onPeriodChange(this.clock.start());
      }
    } else {
      for (const ch of this.clock.advance(dt)) this.onPeriodChange(ch);
      if (this.clock.finished && this.state === 'running') {
        this.showResults();
      }
    }

    const mode = this.clock.mode;
    const enabled = mode !== 'disabled';

    if (inp.humanPlayer && this.player && this.state === 'running') this.rules.humanPlayerAction(this.player.alliance, 1);
    if (inp.humanPlayerAlt && inp.humanPlayerAlt <= (this.season.humanPlayerButtons ?? 1) && this.player && this.state === 'running') this.rules.humanPlayerAction(this.player.alliance, inp.humanPlayerAlt);

    for (const r of this.robots) {
      r.enabled = enabled;
      let cmd: RobotCommand = IDLE_COMMAND;
      if (enabled) {
        if (!this.manual(r)) cmd = this.autoPilots.get(r.id)?.update(dt) ?? IDLE_COMMAND;
        else if (r === this.player) cmd = this.playerCommand(inp, r);
        else cmd = this.hostSync?.command(r.id) ?? IDLE_COMMAND;
      }
      // Driver-assist layers: season assists (e.g. reef auto-align) then chassis auto-align onto the shot target.
      if (enabled && this.rules.adjustCommand) cmd = this.rules.adjustCommand(r, cmd, dt);
      const target = cmd.pass && !cmd.shoot && this.rules.passTarget ? this.rules.passTarget(r) : this.rules.aimTarget(r);
      if (enabled) cmd = r.autoAlign(cmd, target);
      r.lastCommand = cmd;
      r.drive(cmd, dt);
      if (enabled) {
        if (cmd.descend && r.isClimbing) this.rules.requestDescend(r);
        else if (cmd.climb !== null && !r.isClimbing && r.config.climber.maxLevel > 0) this.rules.requestClimb(r, cmd.climb);
      }
      r.tick(dt);
      r.aimTurretAt(target, dt);
      const handled = enabled && this.rules.handleMechanisms?.(r, cmd, dt);
      if (enabled && !handled && (cmd.shoot || cmd.pass)) {
        const shot = r.launch(target, this.rng);
        if (shot) {
          const idx = r.held.pop()!;
          this.pool.placeWorld(idx, shot.pos, shot.vel);
          r.noteLaunch(idx);
          this.rules.onLaunch(r, idx);
        }
      }
    }

    // Intake: robots swallow pieces inside their capture zone.
    if (enabled && !this.rules.handlesIntake) {
      const pool = this.pool;
      for (let i = 0; i < pool.count; i++) {
        if (pool.state[i] !== 'field') continue;
        const p = pool.position(i);
        for (const r of this.robots) {
          if (!r.lastCommand.intake || r.capacityLeft <= 0) continue;
          if (r.justLaunched(i)) continue;
          if ((p.y <= 0.4 && r.intakeContains(p, pool.radius)) || r.stationContains(p, pool.radius)) {
            pool.hold(i, r.id);
            r.held.push(i);
            break;
          }
        }
      }
    }

    this.rules.beforeStep(dt);
    this.pool.updateDamping();
    this.physics.step();
    this.rules.afterStep(dt);
  }

  private onPeriodChange(ch: PeriodChange): void {
    this.rules.onPeriodChange(ch);
    if (ch.to) this.hud.showBanner(ch.to.label, 2);
  }

  /** Show a toast here and (host) forward it — to one driver if `robot` is given, else to everyone. */
  private toast(msg: string, kind: ToastKind, alliance?: Alliance, robot?: Robot): void {
    if (robot && robot !== this.player) {
      const peer = this.hostSync?.peerForRobot(robot);
      if (peer) this.hostSync!.send({ t: 'toast', msg, kind, alliance }, peer);
      return;
    }
    this.hud.toast(msg, kind, alliance);
    if (this.hostSync && !robot) this.hostSync.send({ t: 'toast', msg, kind, alliance });
  }

  // ─────────────────────────── client ───────────────────────────

  private clientTick(inp: DriverInput, now: number): void {
    const cs = this.clientSync!;
    const p = this.player;
    if (!p || this.clientModal === 'closed') return;
    if (inp.humanPlayer && cs.netState === 'running') this.net!.client.send({ t: 'hp' });
    if (inp.humanPlayerAlt && inp.humanPlayerAlt <= (this.season.humanPlayerButtons ?? 1) && cs.netState === 'running') this.net!.client.send({ t: 'hp', n: inp.humanPlayerAlt });
    const live = cs.netState === 'running' || cs.netState === 'countdown';
    const cmd = live && this.manual(p) && p.enabled ? this.playerCommand(inp, p) : IDLE_COMMAND;
    p.lastCommand = cmd;
    const seq = cs.sendCommand(cmd, now);
    if (seq !== null) this.predictor?.onSent(seq, now);

    // Prediction: drive our own robot locally right away (the host stays authoritative).
    const pr = this.predictor;
    if (pr?.active) {
      const fixed = this.physics.dt;
      this.acc += clamp((now - this.lastPredict) / 1000, 0, 0.1);
      let steps = 0;
      while (this.acc >= fixed && steps < 5) {
        p.drive(cmd, fixed);
        this.physics.step();
        this.acc -= fixed;
        steps++;
      }
      if (steps === 5) this.acc = 0;
      if (steps) pr.record(now);
    } else this.acc = 0;
    this.lastPredict = now;
  }

  /** Mirror host game state (banners, pause/results modals) after snapshots are applied. */
  private syncClientState(): void {
    const cs = this.clientSync!;
    if (!cs.gotKeyframe) return;
    const st = cs.netState;
    this.countdown = cs.countdown;
    if (this.clientModal !== 'closed') this.state = st;
    if (st !== this.lastNetState) {
      const prev = this.lastNetState;
      this.lastNetState = st;
      if (st === 'waiting') this.hud.showBanner('WAITING FOR PLAYERS…', 60);
      if (st === 'countdown') this.hud.showBanner('ROBOTS READY', PRE_MATCH_COUNTDOWN);
      // Clear the constructor's "waiting" banner if we first see the match already under way.
      if ((prev === null || prev === 'waiting') && st !== 'countdown' && st !== 'waiting') this.hud.showBanner('', 0.01);
      if (st === 'paused' && this.clientModal !== 'closed') {
        this.clientModal = 'host-pause';
        this.hud.showModal('Paused by host', '<p>The host paused the match.</p>', [{ label: 'Leave match', onClick: () => this.callbacks.onExit() }]);
      } else if (prev === 'paused' && this.clientModal === 'host-pause') {
        this.clientModal = 'none';
        this.hud.hideModal();
      }
    }
    if (st === 'results' && cs.results && this.clientModal !== 'results' && this.clientModal !== 'closed') {
      this.clientModal = 'results';
      this.results = cs.results;
      this.hud.showModal('Match Results', Hud.resultsHtml(cs.results, { red: this.score.total('red'), blue: this.score.total('blue') }) + '<p class="dim">Waiting for the host…</p>', [
        { label: 'Leave room', onClick: () => this.callbacks.onExit() },
      ]);
    }
    const key = `${this.clock.started}:${this.clock.index}:${this.clock.finished}`;
    if (key !== this.lastClockKey) {
      const was = this.lastClockKey;
      this.lastClockKey = key;
      if (was && this.clock.started && !this.clock.finished) this.hud.showBanner(this.clock.current.label, 2);
    }
  }

  private toggleClientMenu(): void {
    if (this.clientModal === 'local') {
      this.clientModal = 'none';
      this.hud.hideModal();
      return;
    }
    if (this.clientModal !== 'none') return;
    this.clientModal = 'local';
    this.hud.showModal('Menu', '<p>The match keeps running — only the host can pause.</p>', [
      { label: 'Back to match', primary: true, onClick: () => this.toggleClientMenu() },
      { label: 'Leave room', onClick: () => this.callbacks.onExit() },
    ]);
  }

  // ─────────────────────────── HUD / modals ───────────────────────────

  private updateHud(dt: number): void {
    this.hud.update(dt);
    this.hud.setScores(this.score.total('red'), this.score.total('blue'));
    if (this.state === 'waiting') this.hud.setClock('WAITING', '—');
    else if (this.state === 'countdown' || (!this.clock.started && this.state === 'paused')) this.hud.setClock('PRE-MATCH', String(Math.max(0, Math.ceil(this.countdown))));
    else this.hud.setClock(this.clock.finished ? 'MATCH OVER' : this.clock.current.label, formatClock(this.clock.displayTime));
    const p = this.player;
    const net = this.role === 'local' ? '' : `<div>${this.role === 'host' ? 'Hosting' : 'Online'} · room <b>${this.net!.client.room || '—'}</b></div>`;
    if (p) {
      const rs = this.robotSetups.get(p.id)!;
      this.hud.setInfo(
        `<div><b>${p.config.teamNumber}</b> · ${p.alliance.toUpperCase()} ${p.station}</div>` +
          net +
          `<div>Camera: ${CAMERA_LABELS[this.camera.mode]} <span class="dim">(V)</span></div>` +
          `<div>AUTO: ${rs.manualAuto ? 'you drive' : 'routine'}</div>` +
          `<div>Intake: ${this.autoIntake ? 'auto' : 'manual (J)'} <span class="dim">(F)</span></div>` +
          (this.season.maxScoringLevel
            ? `<div>Reef target: L${this.scoringLevel} <span class="dim">(1-4)</span></div><div>Cage: ${this.season.climberLabels?.[p.config.climber.maxLevel] ?? 'Deep'} <span class="dim">(C)</span></div>`
            : this.season.climberLabels
              ? `<div>Climber: ${this.season.climberLabels[p.config.climber.maxLevel] ?? 'None'} <span class="dim">(C)</span></div>`
              : `<div>Climb target: L${this.climbLevel} <span class="dim">(1-${this.season.maxClimbLevel})</span></div>`) +
          `<div class="dim">? for controls</div>`,
      );
    } else {
      this.hud.setInfo(`<div><b>Spectating</b></div>${net}<div>Camera: ${CAMERA_LABELS[this.camera.mode]} <span class="dim">(V)</span></div>`);
    }
    this.seasonHud.update();
  }

  pause(): void {
    if (this.role === 'client') return;
    if (this.state !== 'running' && this.state !== 'countdown' && this.state !== 'waiting') return;
    this.pausedFrom = this.state;
    this.state = 'paused';
    if (this.role === 'host') {
      this.hud.showModal('Paused', `<p>Match is paused for everyone.</p>`, [
        { label: 'Resume', primary: true, onClick: () => this.resume() },
        { label: 'Restart match', onClick: () => this.callbacks.onPlayAgain?.() },
        { label: 'Back to lobby', onClick: () => this.callbacks.onBackToLobby?.() },
        { label: 'Close room', onClick: () => this.callbacks.onExit() },
      ]);
      return;
    }
    this.hud.showModal('Paused', `<p>Match is paused.</p>`, [
      { label: 'Resume', primary: true, onClick: () => this.resume() },
      { label: 'Restart match', onClick: () => this.callbacks.onRestart(this.settings) },
      { label: 'Main menu', onClick: () => this.callbacks.onExit() },
    ]);
  }

  resume(): void {
    if (this.state !== 'paused' || this.role === 'client') return;
    this.state = this.pausedFrom;
    this.last = performance.now();
    this.hud.hideModal();
  }

  private showResults(): void {
    this.state = 'results';
    const res = this.rules.results();
    this.results = res;
    const html = Hud.resultsHtml(res, { red: this.score.total('red'), blue: this.score.total('blue') });
    if (this.role === 'host') {
      this.hostSync?.requestKeyframe();
      this.hud.showModal('Match Results', html, [
        { label: 'Play again', primary: true, onClick: () => this.callbacks.onPlayAgain?.() },
        { label: 'Back to lobby', onClick: () => this.callbacks.onBackToLobby?.() },
        { label: 'Close room', onClick: () => this.callbacks.onExit() },
      ]);
      return;
    }
    this.hud.showModal('Match Results', html, [
      { label: 'Play again', primary: true, onClick: () => this.callbacks.onRestart({ ...this.settings, seed: this.settings.seed + 1 }) },
      { label: 'Main menu', onClick: () => this.callbacks.onExit() },
    ]);
  }

  /** Multiplayer stats for debugging (window.game.netStats()). */
  netStats(): Record<string, number> {
    return {
      bytesSent: this.hostSync?.bytesSent ?? 0,
      bytesReceived: this.clientSync?.bytesReceived ?? 0,
      rttMs: Math.round((this.predictor?.rtt ?? 0) * 1000),
      corrections: this.predictor?.corrections ?? 0,
      snaps: this.predictor?.snaps ?? 0,
      snapshots: this.clientSync?.snapshots ?? 0,
      simTime: this.simTime,
    };
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.ticker?.stop();
    for (const off of this.offs) off();
    this.hostSync?.dispose();
    this.input.dispose();
    this.camera.dispose();
    this.hud.dispose();
    this.renderer.dispose();
    this.physics.free();
  }
}
