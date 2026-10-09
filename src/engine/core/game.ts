import { bodyState, restoreBody, captureFields, restoreFields, capturePilot, restorePilot } from '../net/recovery';
import { spawnClearance } from '../robot/spawnClearance';
import { cleanAutoPlan, PlannedAutoPilot } from '../ai/autoPlan';
import { Mesh, Vector3 } from 'three';
import { CameraRig } from '../camera/cameras';
import { Alliance, FieldFrame } from '../coords';
import { FieldBuilder } from '../field/builder';
import { GamePiecePool } from '../gamepiece/pool';
import { Hud } from '../hud/hud';
import { cueFor, Sfx } from '../audio/sfx';
import { TouchControls, isTouchDevice } from '../input/touchControls';
import { DEFAULT_CONTROLS_HELP, DriverInput, InputManager } from '../input/input';
import { MatchClock, PeriodChange } from '../match/clock';
import { buildPlayerResults } from '../match/playerResults';
import { Scoreboard } from '../match/scoreboard';
import { ClientSync } from '../net/clientSync';
import { HostSync } from '../net/hostSync';
import { Predictor } from '../net/prediction';
import type { NetClient } from '../net/netClient';
import type { ClientMsg, HostMsg, MatchSetup, NetGameState, RobotSetup } from '../net/protocol';
import { slotId } from '../net/protocol';
import { Ticker } from '../net/ticker';
import { describeArchetype } from '../telemetry/archetype';
import { MatchLogger, SRC } from '../telemetry/matchLogger';
import { downloadText, installConsoleHelpers, logFileName, saveLog } from '../telemetry/store';
import { PhysicsWorld, RapierModule } from '../physics/world';
import { Rng } from '../random';
import { OcclusionFader } from '../render/occlusionFader';
import { Renderer } from '../render/renderer';
import { footprint, sanitizeConfig } from '../robot/config';
import { StowBay } from '../robot/stowBay';
import { QUALITY, QualityGovernor, resolveTier, type QualityProfile } from './quality';
import { IDLE_COMMAND, intakeZoneContains, Robot, RobotCommand, type IntakeZone } from '../robot/robot';
import { resolveStartPose } from '../startPose';
import { clamp, formatClock } from '../units';
import { turnToward } from '../ai/steering';
import { radioFor } from '../ai/team';
import { fillBotStations } from '../ai/matchSetup';
import { drainSpilled } from '../robot/spill';
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
  /** A replacement host uses logical inventory, independent of the departing host's hopper bodies. */
  recovering?: boolean;
  onCheckpoint?: (state: GameRecovery) => void;
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
  /** Multiplayer: the match ended (host and clients both call this once). Used to report ranked results. */
  onResults?: (res: MatchResults, scores: Record<Alliance, number>) => void;
}

const PRE_MATCH_COUNTDOWN = 3;
export { AI_SPEED, AI_AIM } from '../ai/matchSetup';
/** Minimum ms between rendered frames (~60 fps; the 2 ms slack keeps a 60 Hz display drawing every refresh). */
const MIN_FRAME_MS = 1000 / 60 - 2;
/** Host streams a snapshot every N physics steps (90 Hz / 3 = 30 Hz). */
const SNAPSHOT_EVERY_STEPS = 3;

/** Singleplayer: the driver plus five AI robots, or a solo practice field. */
export function localSetup(s: GameSettings, season: SeasonDefinition): MatchSetup {
  const fp = footprint(s.robot);
  const setup: MatchSetup = {
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
        autoPlan: s.autoPlan,
        manualAuto: s.manualAuto,
        start: resolveStartPose(
          { length: season.fieldLength, width: season.fieldWidth, symmetry: season.mapSymmetry },
          season.startArea,
          s.alliance,
          s.startSpot,
          season.startPose(s.alliance, s.station),
          fp.length,
          fp.width,
        ),
        peerId: '',
        name: 'You',
      },
    ],
  };
  fillBotStations(setup, s, season);
  return setup;
}

/**
 * Orchestrates one match: builds the world from a SeasonDefinition, runs a fixed-step simulation,
 * routes input (or the AUTO autopilot, or remote drivers) to robots, and drives HUD + camera. Year-agnostic.
 */
/** How long a live driver cue stays up without being refreshed. */
const CUE_SECONDS = 0.6;

/** Touch intake assist: how far (m) to look for a loose piece. */
const TOUCH_CHASE_RANGE = 4;

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
  /** Fades field elements that hide the player's robot from the camera. */
  private fader!: OcclusionFader;
  private readonly fadeTargets = [new Vector3(), new Vector3()];
  readonly input = new InputManager();
  private boostOn = false;
  private boostBase: { cap: number; rate: number } | null = null;
  private applyBoost(): void {
    const c = this.player?.config;
    if (!c || this.season.id !== '2026-rebuilt') return;
    if (this.input.justPressed('Period')) this.boostOn = !this.boostOn;
    const on = this.boostOn;
    if (on && !this.boostBase) {
      this.boostBase = { cap: c.hopperCapacity, rate: c.launcher.rate };
      c.hopperCapacity = this.boostBase.cap * 3;
      c.launcher.rate = this.boostBase.rate * 3;
    } else if (!on && this.boostBase) {
      c.hopperCapacity = this.boostBase.cap;
      c.launcher.rate = this.boostBase.rate;
      this.boostBase = null;
    }
  }
  /** AUTO-period drivers per robot id (drivers can't control robots in AUTO). */
  private readonly autoPilots = new Map<number, AutoPilot>();
  private readonly botPilots = new Map<number, AutoPilot>();
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
  private touch: TouchControls | null = null;

  private state: GameState = 'countdown';
  private countdown = PRE_MATCH_COUNTDOWN;
  private raf = 0;
  private last = 0;
  private lastDraw = 0;
  private acc = 0;
  /**
   * Simulation speed (1 = real time). Players always run at 1; the sim is optimised to sustain 1.5 so a slower
   * machine still has headroom, and `?speed=1.5` (single player only) runs it that fast to check. Not synced.
   */
  simSpeed = 1;
  private time = 0;
  /** Records the humans' commands and the world for imitation learning (host / solo only). `?log=0` turns it off. */
  private matchLog: MatchLogger | null = null;
  private savedLog: { name: string; text: string } | null = null;
  /** Host sim time (s) — advances only while stepping. */
  private simTime = 0;
  private stepsSinceSnap = 0;
  private lastIdleSnap = 0;
  private lastCheckpoint = -Infinity;
  private lastPredict = 0;
  /** Host: fraction of wall time spent simulating, measured over ~0.5 s windows. */
  private simLoad = 0;
  private simBusyMs = 0;
  private simWindowStart = 0;
  private fpsAcc = 0;
  private fpsFrames = 0;
  private autoIntake: boolean;
  /** Driver's shot blocker toggle (F); only robots with config.shotBlocker act on it. */
  private blockerUp = false;
  /** Player was told their robot tipped over (reset once it is back on its wheels). */
  private tipNotified = false;
  climbLevel: number;
  scoringLevel = 4;
  /** Driver-selected shot target (season `aimTargets` id), -1 = automatic. */
  aimChoice = -1;
  private results: MatchResults | null = null;
  private pausedFrom: GameState = 'countdown';
  /** Client-side modal currently shown. */
  private clientModal: 'none' | 'local' | 'host-pause' | 'results' | 'closed' = 'none';
  private lastClockKey = '';
  private lastNetState: GameState | null = null;
  private disposed = false;
  private readonly perfPanel = new URLSearchParams(location.search).has('perf') ? document.createElement('pre') : null;
  private readonly timings = { tickMs: 0, drawMs: 0, faderMs: 0, renderMs: 0 };
  private lastPerfUpdate = 0;

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
    if (this.role === 'local') this.simSpeed = clamp(Number(new URLSearchParams(location.search).get('speed')) || 1, 0.25, 3);
    this.setup = net?.setup ?? localSetup(settings, season);
    this.frame = new FieldFrame(season.fieldLength, season.fieldWidth);
    this.quality = QUALITY[resolveTier()];
    StowBay.ACTIVE_MAX = this.quality.activeMax;
    this.renderer = new Renderer(container, season.fieldLength, season.fieldWidth, {
      shadows: settings.shadows && this.quality.shadows,
      pixelRatioCap: this.quality.pixelRatioCap,
      minPixelRatio: this.quality.minPixelRatio,
    });
    this.physics = new PhysicsWorld(R, 1 / 90);
    this.builder = new FieldBuilder(this.physics, this.renderer.scene, this.frame);
    this.rng = new Rng(this.setup.seed);
    this.clock = new MatchClock(season.timeline);
    this.score = new Scoreboard(season.foulValues);
    this.hud = new Hud(container, season.controlsHelp ?? DEFAULT_CONTROLS_HELP);
    this.pool = new GamePiecePool(this.physics, this.renderer.scene, this.frame, season.gamePiece);
    this.autoIntake = settings.autoIntake;
    if (isTouchDevice()) {
      this.touch = new TouchControls(container, this.input, {
        humanPlayerButtons: season.humanPlayerButtons ?? 1,
        levels: season.maxScoringLevel ?? season.maxClimbLevel,
        blocker: () => !!this.player && (!!this.player.config.shotBlocker || this.player.manualHopper),
        labels: season.touchLabels,
        climber: () => (this.player?.config.climber.maxLevel ?? 0) > 0,
      });
    }

    // Local AI fills the other stations; network matches retain their human drivers.
    for (const rs of this.setup.robots) {
      const cfg = season.normalizeRobotConfig?.(rs.config) ?? sanitizeConfig(rs.config, season.maxRobotHeight, season.maxRobotPerimeter);
      const robot = new Robot(this.physics, this.renderer.scene, this.frame, cfg, rs.alliance, rs.id, rs.station, rs.start ?? season.startPose(rs.alliance, rs.station));
      robot.projectile = { radius: season.gamePiece.radius, airDamping: season.gamePiece.airDamping ?? 0.02 };
      robot.shootWhileTracking = season.id === '2026-rebuilt';
      robot.controller = rs.bot ? 'bot' : 'player';
      season.configureRobot?.(robot);
      // Held FUEL becomes real physics bodies only where it is worth the step time (see QualityProfile); everyone else
      // draws the visual particle pile, which is also what every multiplayer client sees.
      if (this.wantsRealHopper(rs, net)) robot.attachPool(this.pool);
      if (season.pieceFlow !== false) {
        const piece = this.pool.mesh;
        const round = season.gamePiece.shape !== 'ring' && season.gamePiece.shape !== 'tube';
        robot.enablePieceFlow(() => {
          const m = new Mesh(piece.geometry, piece.material);
          m.castShadow = true;
          return m;
        }, round);
      }
      // Bake each robot's static parts into a few meshes (draw calls dominate the frame cost).
      robot.optimizeVisual();
      this.robots.push(robot);
      this.robotSetups.set(rs.id, rs);
    }
    const mine = net ? this.setup.robots.find((r) => r.peerId === net.client.peerId) : this.setup.robots[0];
    this.player = mine ? this.robots.find((r) => r.id === mine.id)! : null;
    this.player?.showIntakeGuide(true);
    if (this.role !== 'client' && new URLSearchParams(location.search).get('log') !== '0') {
      this.matchLog = new MatchLogger(
        this,
        (r) => r.controller === 'bot' ? SRC.bot : this.manual(r) ? SRC.human : SRC.autopilot,
        { describe: (r) => describeArchetype(season, r.config), seasonId: season.id, seed: this.setup.seed, fieldLength: season.fieldLength, fieldWidth: season.fieldWidth, mode: this.role },
      );
      installConsoleHelpers();
    }
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
      settings: this.setup.botDifficulty ? { ...settings, aiDifficulty: this.setup.botDifficulty, aiAlly: { skill: this.setup.botDifficulty }, aiOpponent: { skill: this.setup.botDifficulty } } : settings,
      playerRobot: this.player,
      toast(msg: string, kind: ToastKind = 'info', alliance?: Alliance, robot?: Robot) {
        self.toast(msg, kind, alliance, robot);
      },
      cue(robot: Robot, text: string, cls?: string) {
        self.cue(robot, text, cls);
      },
      humanPlayerIsAuto(a: Alliance) {
        if (self.role === 'local') return !self.player || a !== self.player.alliance || self.settings.autoHumanPlayer;
        return self.setup.autoHumanPlayer || !self.setup.robots.some((r) => r.alliance === a && !r.bot);
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
          if (mine) this.predictor!.queueSnapshot(mine, now, snap!.meta.st === 'running');
        }),
      );
      this.offs.push(
        net!.client.on('msg', ({ data }) => {
          const m = data as HostMsg;
          if (m?.t === 'toast') this.hud.toast(m.msg, m.kind, m.alliance);
          if (m?.t === 'cue') this.hud.showBanner(m.text, CUE_SECONDS, m.cls);
          if (m?.t === 'notice') this.hud.toast(m.message, 'warn');
        }),
      );
    } else {
      this.rules.stage();
      for (const r of this.robots) {
        const rs = this.robotSetups.get(r.id)!;
        const plan = rs.autoRoutine === 'custom' ? cleanAutoPlan(rs.autoPlan, season) : undefined;
        this.autoPilots.set(r.id, plan ? new PlannedAutoPilot(this.ctx, this.rules, r, season, plan) : season.createAutoPilot(this.ctx, this.rules, r, rs.autoRoutine));
        if (r.controller === 'bot' && season.createBotPilot) this.botPilots.set(r.id, season.createBotPilot(this.ctx, this.rules, r));
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
      const netClient = this.net.client;
      this.offs.push(
        netClient.on('reconnecting', () => this.hud.toast('Connection lost — reconnecting…', 'warn')),
        netClient.on('reconnected', () => {
          this.hud.toast('Reconnected', 'info');
          if (this.role === 'client') netClient.send({ t: 'resync' } satisfies ClientMsg);
        }),
        netClient.on('rating', (r) => {
          if (r.status === 'void') this.hud.toast(`Ranked: match voided${r.reason ? ' — ' + r.reason : ''}`, 'warn');
          else this.hud.toast(`Ranked: ${r.before} → ${r.after} (${r.delta > 0 ? '+' : ''}${r.delta})`, r.delta >= 0 ? 'good' : 'warn');
        }),
        netClient.on('host-lost', () => this.hud.toast('The host lost connection — waiting for them to return…', 'warn')),
        netClient.on('host-back', () => this.hud.toast('The host is back', 'info')),
        netClient.on('peer-lost', ({ peerId }) => {
          const rs = this.setup.robots.find((r) => r.peerId === peerId);
          if (rs) this.hud.toast(`${rs.name} lost connection — waiting for them to return…`, 'warn');
        }),
      );
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
    this.fader = new OcclusionFader(this.ctx.builder.root);
    this.seasonHud = season.createHud(this.ctx, this.rules, this.hud.slots);
    if (this.state === 'waiting') this.hud.showBanner('WAITING FOR PLAYERS…', 60);
    else this.hud.showBanner('ROBOTS READY', PRE_MATCH_COUNTDOWN);
    this.offs.push(this.hud.showIntro(6));

    if (this.role === 'client') net!.client.send({ t: 'ready' });
  }

  /** Full gameplay state, independent of rendering and the local driver's camera/input. */
  recoveryState() {
    if (!this.rules.recoveryState) throw new Error('Season does not support host recovery');
    return { version: 1 as const, seasonId: this.season.id,
      fields: captureFields(this, ['state', 'pausedFrom', 'countdown', 'simTime', 'results']),
      clock: this.clock.snapshot(), score: this.score.snapshot(), rng: this.rng.snapshot(),
      pool: this.pool.recoveryState(), rules: this.rules.recoveryState(),
      robots: this.robots.map(r => ({ id: r.id, body: bodyState(r.body), fields: r.recoveryState() })),
      auto: [...this.autoPilots].map(([id, pilot]) => [id, capturePilot(pilot)] as const),
      bots: [...this.botPilots].map(([id, pilot]) => [id, capturePilot(pilot)] as const),
    };
  }

  restoreRecovery(state: GameRecovery): void {
    if (state.version !== 1 || state.seasonId !== this.season.id || !this.rules.restoreRecovery) throw new Error('Incompatible match checkpoint');
    this.clock.restore(state.clock); this.score.restore(state.score); this.rng.restore(state.rng);
    for (const robot of this.robots) robot.bay?.clear();
    this.pool.restoreRecovery(state.pool);
    this.rules.restoreRecovery(state.rules);
    for (const saved of state.robots) {
      const robot = this.robots.find(r => r.id === saved.id);
      if (!robot) throw new Error('Checkpoint robot missing');
      restoreBody(robot.body, saved.body); robot.restoreRecovery(saved.fields);
    }
    for (const [id, saved] of state.auto) { const pilot = this.autoPilots.get(id); if (pilot) restorePilot(pilot, saved); }
    for (const [id, saved] of state.bots) { const pilot = this.botPilots.get(id); if (pilot) restorePilot(pilot, saved); }
    restoreFields(this, ['state', 'pausedFrom', 'countdown', 'simTime', 'results'], state.fields);
    this.acc = 0;
    this.hud.hideModal();
    this.hud.showBanner('HOST RECOVERED', 2);
    this.hostSync?.requestKeyframe();
    if (this.state === 'paused') {
      const from = this.pausedFrom;
      this.state = from;
      this.pause();
    } else if (this.state === 'results') this.showResults();
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
    if (this.perfPanel) {
      this.perfPanel.style.cssText = 'position:fixed;right:8px;bottom:8px;z-index:1000;pointer-events:none;background:#000c;color:#fff;padding:8px;font:11px monospace';
      this.renderer.container.appendChild(this.perfPanel);
    }
    // The loop starts once shaders are compiled (during the intro), so the first frames don't freeze.
    void this.renderer.prewarm().then(() => { if (!this.disposed) this.startLoop(); });
  }

  private startLoop(): void {
    this.last = this.lastDraw = performance.now();
    if (this.role !== 'local') {
      // Multiplayer ticks run off a worker timer, not rAF. Host: the simulation must keep running when its
      // tab is hidden (rAF stops). Client: the driver's input, commands and prediction must not wait for a
      // slow rendered frame — tying them to rAF delayed commands (and key releases) by whole frames.
      this.ticker = new Ticker((now) => !this.disposed && this.tick(now));
      this.ticker.start();
    }
    const loop = (now: number) => {
      if (this.disposed) return;
      this.raf = requestAnimationFrame(loop);
      if (this.role === 'local') this.tick(now);
      // Render at most ~60 fps: on 120/144 Hz displays drawing every refresh doubled the CPU/GPU load for no gameplay
      // gain (physics runs on its own fixed 90 Hz step and input is read every refresh regardless).
      const minInterval = Math.max(MIN_FRAME_MS, this.role === 'host' ? this.hostFrameInterval() : 0);
      if (now - this.lastDraw < minInterval) return;
      this.draw(now);
    };
    this.raf = requestAnimationFrame(loop);
  }

  /**
   * Host: minimum ms between rendered frames. The host's simulation is everyone's game — when it needs a
   * big share of the main thread (e.g. hundreds of FUEL balls being pushed around), the host's own view
   * renders less often so the simulation and snapshots keep real time for every player.
   */
  private hostFrameInterval(): number {
    if (this.simLoad < 0.3) return 0;
    return this.simLoad < 0.5 ? 1000 / 30 - 4 : 1000 / 20 - 4;
  }

  /** Device quality tier in effect (set once; the governor only sheds work from it). */
  readonly quality: QualityProfile;
  private readonly governor = new QualityGovernor();

  /**
   * Real-body hopper for this robot? Never on a client (the host sends a count, not the balls). On a host, never for a
   * remote driver's robot: its hopper is invisible to the physics that matter, so it is drawn, not simulated.
   */
  private wantsRealHopper(rs: RobotSetup, net?: GameNet): boolean {
    if (this.role === 'client' || net?.recovering) return false;
    const mine = net ? this.setup.robots.find((r) => r.peerId === net.client.peerId) : this.setup.robots[0];
    const mode = this.role === 'host' ? this.quality.hopperHost : this.quality.hopperSolo;
    if (mode === 'none') return false;
    if (this.role === 'host' && rs.peerId && rs.peerId !== net!.client.peerId) return false;
    return mode === 'all' || rs.id === mine?.id;
  }

  /** The machine can't keep up: turn the farthest-from-the-player real hoppers into particle piles, the player's last. */
  private shedHopperPhysics(): boolean {
    const live = this.robots.filter((r) => r.bay);
    const victim = live.find((r) => r !== this.player) ?? live[0];
    if (!victim) return false;
    victim.detachPool(this.pool);
    return true;
  }

  /** Input + simulation (host/local) or input + command send (client). */
  private tick(now: number): void {
    const started = performance.now();
    this.updateTick(now);
    this.timings.tickMs += (performance.now() - started - this.timings.tickMs) * 0.05;
  }

  private updateTick(now: number): void {
    const dt = clamp((now - this.last) / 1000, 0, 0.1);
    this.last = now;
    if (now - this.simWindowStart >= 500) {
      this.simLoad = this.simWindowStart ? this.simBusyMs / (now - this.simWindowStart) : 0;
      this.simBusyMs = 0;
      this.simWindowStart = now;
    }
    this.applyBoost();
    const inp = this.input.read();
    this.handleUiInput(inp);

    if (this.role === 'client') {
      this.clientTick(inp, now);
      return;
    }

    if (this.state === 'countdown' || this.state === 'running') {
      const t0 = performance.now();
      const fixed = this.physics.dt;
      this.acc += dt * this.simSpeed;
      const maxSteps = Math.ceil(5 * Math.max(1, this.simSpeed));
      let steps = 0;
      while (this.acc >= fixed && steps < maxSteps) {
        for (const r of this.robots) r.capturePrevPose();
        this.pool.capturePrevPoses();
        this.step(fixed, inp);
        this.acc -= fixed;
        steps++;
        this.simTime += fixed;
        this.stepsSinceSnap++;
        // Edge-triggered inputs apply to the first step only.
        inp.humanPlayer = false;
        inp.humanPlayerAlt = 0;
      }
      // Catch-up steps share one fresh snapshot, avoiding bursts of obsolete intermediate poses after a stall.
      if (this.hostSync && this.stepsSinceSnap >= SNAPSHOT_EVERY_STEPS) {
        this.stepsSinceSnap %= SNAPSHOT_EVERY_STEPS;
        this.hostSync.sendSnapshot(this.simTime);
      }
      if (steps === maxSteps) this.acc = 0;
      this.simBusyMs += performance.now() - t0;
    } else if (this.hostSync && now - this.lastIdleSnap > 200) {
      // Waiting / paused / results: keep clients in sync at a low rate.
      this.lastIdleSnap = now;
      this.hostSync.sendSnapshot(this.simTime);
    }
    if (this.hostSync && this.net?.onCheckpoint && this.net.client.connected && this.net.client.buffered < 16 * 1024 && now - this.lastCheckpoint >= 2000) {
      this.lastCheckpoint = now;
      this.net.onCheckpoint(this.recoveryState());
    }
  }

  private draw(now: number): void {
    const started = performance.now();
    const elapsed = Math.max(0, (now - this.lastDraw) / 1000);
    const dt = Math.min(elapsed, 0.1);
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
    // Host / solo: draw between the last two fixed physics steps (clients draw their own interpolated snapshots).
    const alpha = this.role === 'client' ? 1 : clamp(this.acc / this.physics.dt, 0, 1);
    for (const r of this.robots) {
      r.climbReady = this.clock.started && !this.clock.finished && this.clock.current.mode === 'teleop' && this.clock.driveRemaining <= (this.season.endgameSeconds ?? 30);
      r.syncVisual(undefined, alpha);
    }
    this.pool.syncVisuals(alpha);
    this.camera.chaseIntakeOffset = this.player?.intakeYawOffset ?? 0;
    this.camera.update(dt, this.player?.visualPose ?? null, undefined, this.player?.visual.position.y ?? 0);
    const fadeStart = performance.now();
    this.updateFader(dt);
    this.timings.faderMs += (performance.now() - fadeStart - this.timings.faderMs) * 0.05;
    this.updateHud(dt);
    const renderStart = performance.now();
    this.renderer.render();
    this.timings.renderMs += (performance.now() - renderStart - this.timings.renderMs) * 0.05;
    this.timings.drawMs += (performance.now() - started - this.timings.drawMs) * 0.05;
    if (this.perfPanel && now - this.lastPerfUpdate > 500) {
      this.lastPerfUpdate = now;
      this.perfPanel.textContent = `${this.role} · CPU averages (ms)\n` + Object.entries(this.netStats()).map(([key, value]) => `${key}: ${value}`).join('\n');
    }

    // Real elapsed time: the clamped dt made 2 fps read as 10.
    this.fpsAcc += elapsed;
    this.fpsFrames++;
    if (this.fpsAcc > 0.5) {
      const fps = this.fpsFrames / this.fpsAcc;
      this.hud.setFps(fps);
      // A host capping its own frame rate for the simulation's sake isn't a slow GPU.
      const uncapped = this.role !== 'host' || this.hostFrameInterval() === 0;
      if (uncapped) this.renderer.adaptQuality(fps);
      const shed = this.governor.update(this.role === 'client' ? 0 : this.simLoad, uncapped ? fps : 0);
      if (shed === 'hopper') this.shedHopperPhysics();
      else if (shed === 'shadows' && this.renderer.atMinPixelRatio) this.renderer.disableShadows();
      this.fpsAcc = 0;
      this.fpsFrames = 0;
    }
  }

  /** See-through whatever field element is between the camera and the player's robot, in every view. */
  private updateFader(dt: number): void {
    const robot = this.player;
    if (robot) {
      const [low, high] = this.fadeTargets;
      low.copy(robot.visual.position).y += 0.25;
      high.copy(robot.visual.position).y += 0.9;
    }
    this.fader.update(dt, this.renderer.camera.position, robot ? this.fadeTargets : []);
  }

  private handleUiInput(inp: DriverInput): void {
    if (inp.toggleHelp) this.hud.toggleHelp();
    if (inp.cameraNext) {
      this.camera.next();
      this.hud.toast(`Camera: ${this.camera.label}`);
    }
    if (inp.cameraFlip && this.camera.mode === 'chase') {
      this.camera.toggleChaseFacing();
      this.hud.toast(`Camera: ${this.camera.label}`);
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
    const targets = this.season.aimTargets;
    if (targets?.length && (inp.targetStep || inp.targetAuto)) {
      if (inp.targetAuto) this.aimChoice = -1;
      else {
        // Cycle left ↔ right through the targets on this screen only.
        const seen = this.visibleTargets();
        const k = seen.findIndex((t) => t.id === this.aimChoice);
        if (seen.length) this.aimChoice = seen[k < 0 ? (inp.targetStep > 0 ? 0 : seen.length - 1) : (k + inp.targetStep + seen.length) % seen.length].id;
        else this.hud.toast('No shot target in view', 'info', undefined, 'aim-target');
      }
      if (this.aimChoice < 0 || this.visibleTargets().length) this.hud.toast(this.aimChoice < 0 ? 'Target: automatic' : `Target: ${targets.find((t) => t.id === this.aimChoice)!.label} · Z = automatic`, 'info', undefined, 'aim-target');
    }
    if (inp.toggleIntake) {
      this.autoIntake = !this.autoIntake;
      this.hud.toast(`Auto-intake ${this.autoIntake ? 'ON' : 'OFF'}`);
    }
    if (inp.toggleBlocker && this.player) {
      if (this.player.manualHopper) {
        if (this.blockerUp && this.player.held.length > this.player.config.hopperExpansion!.startCount) this.hud.toast(`Shoot down to ${this.player.config.hopperExpansion!.startCount} FUEL before lowering the hopper`);
        else if (!this.blockerUp && this.player.overheadLimit < this.player.config.hopperExpansion!.fullHeight) this.hud.toast('Cannot raise the hopper under the TRENCH');
        else {
          this.blockerUp = !this.blockerUp;
          const capacity = this.blockerUp ? this.player.config.hopperCapacity : this.player.config.hopperExpansion!.startCount;
          this.hud.toast(`Hopper ${this.blockerUp ? 'UP' : 'DOWN'} · ${capacity} FUEL`);
        }
      } else if (!this.player.config.shotBlocker) this.hud.toast('This robot has no shot blocker');
      else {
        this.blockerUp = !this.blockerUp;
        this.hud.toast(`Shot blocker ${this.blockerUp ? 'UP' : 'DOWN'}`);
      }
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
    let vx = (f * Math.cos(ref) - l * Math.sin(ref)) * sp;
    let vy = (f * Math.sin(ref) + l * Math.cos(ref)) * sp;
    let omega = inp.rotate * robot.config.maxOmega * (inp.precision ? 0.35 : 0.75);
    // Touch screens: holding INTAKE with hands off the stick chases the nearest floor piece, intake side first.
    if (this.touch && inp.intake && !m && !inp.rotate) {
      const chase = this.touchChase(robot);
      if (chase) ({ vx, vy, omega } = chase);
    }
    return {
      vx,
      vy,
      omega,
      // Shot blocker up (F) wins over the intake: they share the intake side and can't run together.
      intake: (this.autoIntake || inp.intake) && !(this.blockerUp && robot.config.shotBlocker),
      shoot: inp.shoot,
      pass: inp.pass,
      climb: inp.climb ? this.climbLevel : null,
      descend: inp.descend,
      ...(this.blockerUp && (robot.config.shotBlocker || robot.manualHopper) ? { block: true } : {}),
      ...(this.season.maxScoringLevel ? { scoringLevel: this.scoringLevel } : {}),
      ...(this.season.aimTargets?.length ? this.aimCommand() : {}),
    };
  }

  /**
   * Shot targets on this screen (projected inside the view, in front of the camera), left to right. A target is only
   * pickable while you can see it.
   */
  private visibleTargets(): { id: number; sx: number }[] {
    const cam = this.renderer.camera;
    cam.updateMatrixWorld();
    const out: { id: number; sx: number }[] = [];
    for (const t of this.season.aimTargets ?? []) {
      if (!t.point) { out.push({ id: t.id, sx: 0 }); continue; }
      const v = this.frame.toWorld(t.point.x, t.point.y, t.point.z, this.aimTmp).project(cam);
      if (v.z < 1 && Math.abs(v.x) <= 0.97 && Math.abs(v.y) <= 0.97) out.push({ id: t.id, sx: v.x });
    }
    return out.sort((a, b) => a.sx - b.sx);
  }
  private readonly aimTmp = new Vector3();

  /** The driver's pick (dropped back to automatic once it leaves the screen) and the on-screen set for the rules. */
  private aimCommand(): { aimTarget: number; aimVisible: number } {
    const seen = this.visibleTargets();
    if (this.aimChoice >= 0 && !seen.some((t) => t.id === this.aimChoice)) {
      this.aimChoice = -1;
      this.hud.toast('Target out of view · automatic', 'info', undefined, 'aim-target');
    }
    return { aimTarget: this.aimChoice, aimVisible: seen.reduce((m, t) => (t.id < 31 ? m | (1 << t.id) : m), 0) };
  }

  /** Velocity toward the nearest loose piece within reach of the intake (touch intake assist), or null. */
  private touchChase(robot: Robot): { vx: number; vy: number; omega: number } | null {
    if (robot.config.intake.ground === false || robot.intakeRoom <= 0) return null;
    const pool = this.pool;
    const frame = this.frame;
    const p = robot.pose;
    let best = -1;
    let bestD = TOUCH_CHASE_RANGE;
    for (let i = 0; i < pool.count; i++) {
      if (pool.state[i] !== 'field' || robot.justLaunched(i)) continue;
      const q = frame.toField(pool.position(i));
      if (q.z > 0.3 || q.x < 0 || q.x > frame.length || q.y < 0 || q.y > frame.width) continue;
      const d = Math.hypot(q.x - p.x, q.y - p.y);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    if (best < 0) return null;
    const q = frame.toField(pool.position(best));
    const yaw = Math.atan2(q.y - p.y, q.x - p.x) + robot.intakeYawOffset;
    const speed = robot.config.maxSpeed * 0.7;
    // Face the piece first; drive in only once roughly lined up, then straight through it.
    const err = Math.abs(Math.atan2(Math.sin(yaw - p.yaw), Math.cos(yaw - p.yaw)));
    const go = err < 0.6 ? speed : 0;
    const dir = Math.atan2(q.y - p.y, q.x - p.x);
    return { vx: Math.cos(dir) * go, vy: Math.sin(dir) * go, omega: turnToward(p.yaw, yaw, robot.config.maxOmega * 0.75) };
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
      const on = enabled;
      r.enabled = on;
      let cmd: RobotCommand = IDLE_COMMAND;
      if (on) {
        if (!this.manual(r)) cmd = this.autoPilots.get(r.id)?.update(dt) ?? IDLE_COMMAND;
        else if (r === this.player) cmd = this.playerCommand(inp, r);
        else if (r.controller === 'bot') cmd = this.botPilots.get(r.id)?.update(dt) ?? IDLE_COMMAND;
        else cmd = this.hostSync?.command(r.id) ?? IDLE_COMMAND;
      }
      // Driver-assist layers: season assists (e.g. reef auto-align) then chassis auto-align onto the shot target.
      if (on && this.rules.adjustCommand) cmd = this.rules.adjustCommand(r, cmd, dt);
      const target = cmd.pass && !cmd.shoot && this.rules.passTarget ? this.rules.passTarget(r) : this.rules.aimTarget(r);
      if (on) cmd = r.autoAlign(cmd, target);
      r.lastCommand = cmd;
      r.overheadLimit = this.rules.overheadClearance?.(r) ?? Infinity;
      r.drive(cmd, dt);
      if (on) {
        if (cmd.descend && r.isClimbing) this.rules.requestDescend(r);
        else if (cmd.climb !== null && !r.isClimbing && !r.tippedOver && r.config.climber.maxLevel > 0) this.rules.requestClimb(r, cmd.climb);
      }
      r.tick(dt);
      drainSpilled(r, this.pool);
      r.aimTurretAt(target, dt);
      if (!this.rules.handleMechanisms) r.advanceScoringMechanisms(dt);
      const handled = on && this.rules.handleMechanisms?.(r, cmd, dt);
      if (on && !handled && (cmd.shoot || cmd.pass)) {
        const shot = r.launch(target, this.rng);
        if (shot) {
          const idx = r.held.pop()!;
          this.pool.placeWorld(idx, shot.pos, shot.vel);
          if (r.config.launcher.exitInside) this.pool.releaseGhost(idx, () => spawnClearance(r, this.pool.position(idx), this.pool.colliderRadius, this.pool.colliderHalfHeight) > 0.02);
          r.noteLaunch(idx);
          this.rules.onLaunch(r, idx);
          this.matchLog?.launch(r, idx, shot.vel);
        }
      }
    }

    // Intake: robots swallow pieces inside their capture zone.
    if (enabled && !this.rules.handlesIntake) {
      const pool = this.pool;
      const zones: { r: Robot; z: IntakeZone }[] = [];
      for (const r of this.robots) {
        r.tickIntake(dt);
        const z = r.lastCommand.intake && r.intakeRoom > 0 ? r.intakeZone() : null;
        if (z) zones.push({ r, z });
      }
      for (let i = 0; i < pool.count && zones.length; i++) {
        if (pool.state[i] !== 'field') continue;
        const p = pool.position(i);
        for (let k = 0; k < zones.length; k++) {
          const { r, z } = zones[k];
          if (r.justLaunched(i)) continue;
          // Cheap zone test first; the shield test reads other robots' poses through WASM.
          if (intakeZoneContains(z, p, pool.radius, 0.4)) {
            if (this.robots.some(other => other !== r && other.shieldsPiece(p, pool.radius))) continue;
            r.noteCapture(p);
            pool.hold(i, r.id);
            r.held.push(i);
            if (r.intakeRoom <= 0) zones.splice(k, 1);
            break;
          }
        }
      }
    }

    this.rules.beforeStep(dt);
    this.pool.updateDamping();
    this.physics.step();
    this.rules.afterStep(dt);
    this.matchLog?.step();
  }

  private onPeriodChange(ch: PeriodChange): void {
    this.rules.onPeriodChange(ch);
    const cue = cueFor(ch.from, ch.to);
    if (cue) this.sfx.play(cue);
    if (ch.to) this.hud.showBanner(ch.to.label, 2);
  }

  /** Show a toast here and (host) forward it — to one driver if `robot` is given, else to everyone. */
  /** Live status for one driver (see SeasonContext.cue): only that robot's screen shows it. */
  private cue(robot: Robot, text: string, cls?: string): void {
    if (robot === this.player) this.hud.showBanner(text, CUE_SECONDS, cls);
    else {
      const peer = this.hostSync?.peerForRobot(robot);
      if (peer) this.hostSync!.send({ t: 'cue', text, cls }, peer);
    }
  }

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
    this.predictor?.flush();
    const cs = this.clientSync!;
    const p = this.player;
    if (!p || this.clientModal === 'closed') return;
    if (inp.humanPlayer && cs.netState === 'running') this.net!.client.send({ t: 'hp' });
    if (inp.humanPlayerAlt && inp.humanPlayerAlt <= (this.season.humanPlayerButtons ?? 1) && cs.netState === 'running') this.net!.client.send({ t: 'hp', n: inp.humanPlayerAlt });
    const linked = this.net!.client.connected && now - cs.lastReceivedAt < 1000;
    const live = linked && (cs.netState === 'running' || cs.netState === 'countdown');
    const cmd = live && this.manual(p) && p.enabled ? this.playerCommand(inp, p) : IDLE_COMMAND;
    p.lastCommand = cmd;
    const seq = cs.sendCommand(cmd, now);
    if (seq !== null) this.predictor?.onSent(seq, now);

    // Prediction: drive our own robot locally right away (the host stays authoritative).
    const pr = this.predictor;
    if (pr?.active && linked) {
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
      this.callbacks.onResults?.(cs.results, { red: this.score.total('red'), blue: this.score.total('blue') });
      this.hud.showModal('Match Results', Hud.resultsHtml(cs.results, { red: this.score.total('red'), blue: this.score.total('blue') }) + '<p class="dim">Waiting for the host…</p>', [
        { label: 'Leave room', onClick: () => this.callbacks.onExit() },
      ]);
    }
    const key = `${this.clock.started}:${this.clock.index}:${this.clock.finished}`;
    if (key !== this.lastClockKey) {
      const was = this.lastClockKey;
      this.lastClockKey = key;
      if (was && this.clock.started && !this.clock.finished) this.hud.showBanner(this.clock.current.label, 2);
      if (this.clock.started) {
        const now = this.clock.finished ? null : this.clock.current;
        const cue = was ? cueFor(this.lastPeriod, now) : null;
        if (cue) this.sfx.play(cue);
        this.lastPeriod = now;
      }
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

  private radioSeq = 0;
  private readonly sfx = new Sfx();
  /** Multiplayer client: period seen at the last clock snapshot (for sound cues). */
  private lastPeriod: { id: string; mode: string } | null = null;

  private updateHud(dt: number): void {
    this.hud.update(dt);
    if (this.role === 'local' && this.botPilots.size) {
      const show = this.settings.aiRadio ?? 'all';
      for (const m of radioFor(this.ctx).since(this.radioSeq)) {
        this.radioSeq = m.seq;
        if (show === 'all' || (show === 'team' && m.alliance === this.settings.alliance)) this.hud.radio(m.from, m.text, m.alliance);
      }
    }
    this.hud.setScores(this.score.total('red'), this.score.total('blue'));
    if (this.state === 'waiting') this.hud.setClock('WAITING', '—');
    else if (this.state === 'countdown' || (!this.clock.started && this.state === 'paused')) this.hud.setClock('PRE-MATCH', String(Math.max(0, Math.ceil(this.countdown))));
    else this.hud.setClock(this.clock.finished ? 'MATCH OVER' : this.clock.current.label, formatClock(this.clock.displayTime));
    const p = this.player;
    if (p && p.tippedTime > 0.5 && !this.tipNotified) {
      this.tipNotified = true;
      this.hud.toast(`Robot ${p.tippedOver ? 'tipped over' : 'stuck off its wheels'} — back on its wheels in ${Math.ceil(p.rightingIn)} s`, 'warn');
    } else if (p && p.tippedTime === 0) this.tipNotified = false;
    const link = this.net?.client.reconnecting ? 'Reconnecting…' :
      this.clientSync && performance.now() - this.clientSync.lastReceivedAt > 1000 ? 'Waiting for host…' : '';
    const net = this.role === 'local' ? '' : `<div>${this.role === 'host' ? 'Hosting' : 'Online'} · room <b>${this.net!.client.room || '—'}</b>${link ? ` · ${link}` : ''}</div>`;
    if (p) {
      const rs = this.robotSetups.get(p.id)!;
      this.hud.setInfo(
        `<div><b>${p.config.teamNumber}</b> · ${p.alliance.toUpperCase()} ${p.station}</div>` +
          (p.tippedTime > 0.5 ? `<div class="bad">${p.tippedOver ? 'TIPPED OVER' : 'STUCK'} · upright in ${Math.ceil(p.rightingIn)} s</div>` : '') +
          net +
          `<div>Camera: ${this.camera.label} <span class="dim">(V${this.camera.mode === 'chase' ? ' · T flips' : ''})</span></div>` +
          `<div>AUTO: ${rs.manualAuto ? 'you drive' : 'routine'}</div>` +
          `<div>Intake: ${this.autoIntake ? 'auto' : 'manual (J)'} <span class="dim">(I)</span></div>` +
          (p.manualHopper ? `<div>Hopper: ${p.hopperRaised ? 'UP' : 'down'} · ${p.held.length}/${p.hopperCapacity} FUEL <span class="dim">(F)</span></div>` : '') +
          (p.config.shotBlocker ? `<div>Shot blocker: ${this.blockerUp ? (p.blockerDeploy < 1 && p.overheadLimit < Infinity ? 'held down by TRENCH' : 'UP · intake off') : 'down'} <span class="dim">(F)</span></div>` : '') +
          (this.season.maxScoringLevel
            ? `<div>Reef target: L${this.scoringLevel} <span class="dim">(1-4)</span></div><div>Cage: ${this.season.climberLabels?.[p.config.climber.maxLevel] ?? 'Deep'} <span class="dim">(C)</span></div>`
            : this.season.climberLabels
              ? `<div>Climber: ${this.season.climberLabels[p.config.climber.maxLevel] ?? 'None'} <span class="dim">(C)</span></div>`
              : `<div>Climb target: L${this.climbLevel} <span class="dim">(1-${this.season.maxClimbLevel})</span></div>`) +
          `<div class="dim">? for controls</div>`,
      );
    } else {
      this.hud.setInfo(`<div><b>Spectating</b></div>${net}<div>Camera: ${this.camera.label} <span class="dim">(V${this.camera.mode === 'chase' ? ' · T flips' : ''})</span></div>`);
    }
    this.seasonHud.update();
  }

  pause(): void {
    if (this.role === 'client') return;
    if (this.state !== 'running' && this.state !== 'countdown' && this.state !== 'waiting') return;
    this.pausedFrom = this.state;
    this.state = 'paused';
    this.showPauseMenu();
  }

  private soundButton(reopen: () => void) {
    return { label: `Sound: ${this.sfx.muted ? 'off' : 'on'}`, onClick: () => { this.sfx.muted = !this.sfx.muted; reopen(); } };
  }

  private showPauseMenu(): void {
    if (this.role === 'host') {
      this.hud.showModal('Paused', `<p>Match is paused for everyone.</p>`, [
        { label: 'Resume', primary: true, onClick: () => this.resume() },
        { label: 'Restart match', onClick: () => this.callbacks.onPlayAgain?.() },
        { label: 'Back to lobby', onClick: () => this.callbacks.onBackToLobby?.() },
        { label: 'Leave room', onClick: () => this.callbacks.onExit() },
        this.soundButton(() => this.showPauseMenu()),
      ]);
      return;
    }
    this.hud.showModal('Paused', `<p>Match is paused.</p>`, [
      { label: 'Resume', primary: true, onClick: () => this.resume() },
      { label: 'Restart match', onClick: () => this.callbacks.onRestart(this.settings) },
      { label: 'Main menu', onClick: () => this.callbacks.onExit() },
      this.soundButton(() => this.showPauseMenu()),
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
    Object.assign(res, buildPlayerResults(res, this.score, this.setup.robots.map((rs) => ({ id: rs.id, alliance: rs.alliance, name: rs.name, team: rs.config.teamNumber })), this.season.foulValues, 'Game pieces'));
    this.results = res;
    this.persistLog({ red: this.score.total('red'), blue: this.score.total('blue') });
    const html = Hud.resultsHtml(res, { red: this.score.total('red'), blue: this.score.total('blue') });
    if (this.role === 'host') {
      this.hostSync?.requestKeyframe();
      this.callbacks.onResults?.(res, { red: this.score.total('red'), blue: this.score.total('blue') });
      // Ranked rooms have no rematch: the room ends when the host leaves.
      this.hud.showModal('Match Results', html, this.callbacks.onPlayAgain ? [
        { label: 'Play again', primary: true, onClick: () => this.callbacks.onPlayAgain?.() },
        { label: 'Back to lobby', onClick: () => this.callbacks.onBackToLobby?.() },
        { label: 'Leave room', onClick: () => this.callbacks.onExit() },
        ...this.logButton(),
      ] : [{ label: 'Leave', primary: true, onClick: () => this.callbacks.onExit() }, ...this.logButton()]);
      return;
    }
    this.hud.showModal('Match Results', html, [
      { label: 'Play again', primary: true, onClick: () => this.callbacks.onRestart({ ...this.settings, seed: this.settings.seed + 1 }) },
      { label: 'Main menu', onClick: () => this.callbacks.onExit() },
      ...this.logButton(),
    ]);
  }

  /** Finish the match log and store it (once); also runs when a match is abandoned. */
  private persistLog(totals?: Record<string, number>): void {
    const log = this.matchLog;
    if (!log || this.savedLog) return;
    log.finish(totals);
    const text = log.toJSONL();
    const createdAt = new Date().toISOString();
    this.savedLog = { name: logFileName(this.season.id, createdAt), text };
    void saveLog({ createdAt, seasonId: this.season.id, frames: log.frameCount, text });
  }

  private logButton(): { label: string; onClick: () => void }[] {
    return this.matchLog ? [{ label: 'Download match log', onClick: () => this.savedLog && downloadText(this.savedLog.name, this.savedLog.text) }] : [];
  }

  /** Multiplayer stats for debugging (window.game.netStats()). */
  netStats(): Record<string, number> {
    return {
      ...Object.fromEntries(Object.entries(this.timings).map(([key, value]) => [key, Math.round(value * 100) / 100])),
      relayRttMs: this.net?.client.rttMs ?? 0,
      socketQueuedBytes: this.net?.client.buffered ?? 0,
      bytesSent: this.hostSync?.bytesSent ?? 0,
      bytesReceived: this.clientSync?.bytesReceived ?? 0,
      rttMs: Math.round((this.predictor?.rtt ?? 0) * 1000),
      corrections: this.predictor?.corrections ?? 0,
      snaps: this.predictor?.snaps ?? 0,
      snapshots: this.clientSync?.snapshots ?? 0,
      missedSnapshots: this.clientSync?.missed ?? 0,
      interpDelayMs: Math.round((this.clientSync?.delay ?? 0) * 1000),
      jitterMs: Math.round((this.clientSync?.jitter ?? 0) * 1000),
      hostSimLoad: Math.round(this.simLoad * 100) / 100,
      pixelRatio: this.renderer.currentPixelRatio,
      tier: ['low', 'medium', 'high'].indexOf(this.quality.tier),
      realHoppers: this.robots.filter((r) => r.bay).length,
      shadows: Number(this.renderer.shadowsOn),
      simTime: this.simTime,
    };
  }

  dispose(): void {
    this.disposed = true;
    // Quitting mid-match still keeps the demonstration (skip trivially short ones).
    if (this.matchLog && (this.matchLog.frameCount > 300)) this.persistLog();
    this.perfPanel?.remove();
    cancelAnimationFrame(this.raf);
    this.ticker?.stop();
    for (const off of this.offs) off();
    this.hostSync?.dispose();
    this.input.dispose();
    this.touch?.dispose();
    this.camera.dispose();
    this.fader.clear();
    this.hud.dispose();
    this.sfx.dispose();
    this.renderer.dispose();
    this.physics.free();
  }
}

/** Data transferred once to the new host when authority changes. */
export type GameRecovery = ReturnType<Game['recoveryState']>;
