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
import type { HostMsg, MatchSetup, NetGameState, RobotSetup } from '../net/protocol';
import { slotId } from '../net/protocol';
import { Ticker } from '../net/ticker';
import { PhysicsWorld, RapierModule } from '../physics/world';
import { Rng } from '../random';
import { OcclusionFader } from '../render/occlusionFader';
import { Renderer } from '../render/renderer';
import { cloneConfig, footprint, sanitizeConfig } from '../robot/config';
import { IDLE_COMMAND, intakeZoneContains, Robot, RobotCommand, type IntakeZone } from '../robot/robot';
import { checkStartSpot, fieldToSpot, footprintPoly, polysOverlap, resolveStartPose, spotToField } from '../startPose';
import { clamp, formatClock } from '../units';
import { turnToward } from '../ai/steering';
import { aiOrders, radioFor } from '../ai/team';
import { aiRobotChoices } from '../ai/robots';
import type { AiSkill, AutoPilot, GameSettings, MatchResults, SeasonContext, SeasonDefinition, SeasonHud, SeasonRules, ToastKind } from './season';

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
/**
 * AI robots drive the same robots players get: no skill-based speed or accuracy edge. Skill is how they play
 * (pace, planning, defense on the driver), not better hardware. Kept as tables so tests and benchmarks share them.
 */
export const AI_SPEED: Record<AiSkill, number> = { easy: 1, normal: 1, hard: 1, elite: 1, einstein: 1 };
export const AI_AIM: Record<AiSkill, number> = { easy: 1, normal: 1, hard: 1, elite: 1, einstein: 1 };
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
  if (s.aiOpponents !== false && season.createBotPilot) {
    for (const alliance of ['blue', 'red'] as const) {
      for (let station = 1; station <= 3; station++) {
        if (alliance === s.alliance && station === s.station) continue;
        const orders = aiOrders(s, alliance);
        const difficulty = orders.skill;
        // A real team's robot or a generic archetype: the player's pick for that station, else the season's lineup.
        const choices = aiRobotChoices(season);
        const wanted = orders.archetypes[station];
        const archetype = choices.find((p) => p.id === wanted) ?? choices.find((p) => p.id === season.botArchetype?.(difficulty, station, orders.roles[station], alliance === s.alliance));
        const config = cloneConfig(archetype?.config ?? season.botRobotConfig?.(difficulty, orders.roles[station]) ?? season.robotDefaults);
        config.maxSpeed *= AI_SPEED[difficulty];
        config.launcher.spread *= AI_AIM[difficulty];
        config.launcher.speedError *= AI_AIM[difficulty];
        // Real robots keep their team number unless it's already on the field.
        const real = archetype?.team;
        config.teamNumber = real && !setup.robots.some((o) => o.config.teamNumber === real) ? real : 9000 + setup.robots.length;
        const dims = { length: season.fieldLength, width: season.fieldWidth, symmetry: season.mapSymmetry };
        const botFootprint = footprint(config);
        let start = season.startPose(alliance, station);
        const overlaps = (pose: typeof start) => setup.robots.some((other) => {
          const otherFootprint = footprint(other.config);
          return polysOverlap(footprintPoly(pose, botFootprint.length + 0.1, botFootprint.width + 0.1),
            footprintPoly(other.start ?? season.startPose(other.alliance, other.station), otherFootprint.length, otherFootprint.width));
        });
        if (overlaps(start) && season.startArea) {
          const spot = fieldToSpot(dims, alliance, start);
          for (let y = season.startArea.rect.y0; y <= season.startArea.rect.y1; y += 0.15) {
            const candidate = { ...spot, y };
            const pose = spotToField(dims, alliance, candidate);
            if (checkStartSpot(season.startArea, candidate, botFootprint.length, botFootprint.width).ok && !overlaps(pose)) { start = pose; break; }
          }
        }
        setup.robots.push({
          id: setup.robots.length, slot: slotId(alliance, station), alliance, station, config,
          autoRoutine: season.botAutoRoutine?.(station, config) ?? season.autoRoutines[0]?.id ?? 'none', manualAuto: false,
          start, peerId: '', name: `AI ${alliance === 'blue' ? 'Blue' : 'Red'} ${station}`,
        });
      }
    }
    // AUTO routines are planned per alliance once every robot is known: who climbs depends on who CAN climb.
    if (season.botAutoRoutine) {
      for (const rs of setup.robots) {
        if (rs.id === 0) continue;
        const bots = setup.robots.filter((o) => o.alliance === rs.alliance && o.id !== 0).map((o) => ({ station: o.station, config: o.config }));
        rs.autoRoutine = season.botAutoRoutine(rs.station, rs.config, bots);
      }
    }
  }
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
  private time = 0;
  /** Host sim time (s) — advances only while stepping. */
  private simTime = 0;
  private stepsSinceSnap = 0;
  private lastIdleSnap = 0;
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
    this.setup = net?.setup ?? localSetup(settings, season);
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
    if (isTouchDevice()) {
      this.touch = new TouchControls(container, this.input, {
        humanPlayerButtons: season.humanPlayerButtons ?? 1,
        levels: season.maxScoringLevel ?? season.maxClimbLevel,
        blocker: () => !!this.player?.config.shotBlocker,
        climber: () => (this.player?.config.climber.maxLevel ?? 0) > 0,
      });
    }

    // Local AI fills the other stations; network matches retain their human drivers.
    for (const rs of this.setup.robots) {
      const cfg = season.normalizeRobotConfig?.(rs.config) ?? sanitizeConfig(rs.config, season.maxRobotHeight, season.maxRobotPerimeter);
      const robot = new Robot(this.physics, this.renderer.scene, this.frame, cfg, rs.alliance, rs.id, rs.station, rs.start ?? season.startPose(rs.alliance, rs.station));
      robot.projectile = { radius: season.gamePiece.radius, airDamping: season.gamePiece.airDamping ?? 0.02 };
      robot.controller = this.role === 'local' && rs.id !== 0 ? 'bot' : 'player';
      season.configureRobot?.(robot);
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
      cue(robot: Robot, text: string, cls?: string) {
        self.cue(robot, text, cls);
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

  /** Input + simulation (host/local) or input + command send (client). */
  private tick(now: number): void {
    const dt = clamp((now - this.last) / 1000, 0, 0.1);
    this.last = now;
    if (now - this.simWindowStart >= 500) {
      this.simLoad = this.simWindowStart ? this.simBusyMs / (now - this.simWindowStart) : 0;
      this.simBusyMs = 0;
      this.simWindowStart = now;
    }
    const inp = this.input.read();
    this.handleUiInput(inp);

    if (this.role === 'client') {
      this.clientTick(inp, now);
      return;
    }

    if (this.state === 'countdown' || this.state === 'running') {
      const t0 = performance.now();
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
      this.simBusyMs += performance.now() - t0;
    } else if (this.hostSync && now - this.lastIdleSnap > 200) {
      // Waiting / paused / results: keep clients in sync at a low rate.
      this.lastIdleSnap = now;
      this.hostSync.sendSnapshot(this.simTime);
    }
  }

  private draw(now: number): void {
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
    for (const r of this.robots) r.syncVisual();
    this.pool.syncVisuals();
    this.camera.chaseIntakeOffset = this.player?.intakeYawOffset ?? 0;
    this.camera.update(dt, this.player?.pose ?? null, undefined, this.player?.elevation ?? 0);
    this.updateFader(dt);
    this.updateHud(dt);
    this.renderer.render();

    // Real elapsed time: the clamped dt made 2 fps read as 10.
    this.fpsAcc += elapsed;
    this.fpsFrames++;
    if (this.fpsAcc > 0.5) {
      const fps = this.fpsFrames / this.fpsAcc;
      this.hud.setFps(fps);
      // A host capping its own frame rate for the simulation's sake isn't a slow GPU.
      if (this.role !== 'host' || this.hostFrameInterval() === 0) this.renderer.adaptQuality(fps);
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
    if (inp.toggleIntake) {
      this.autoIntake = !this.autoIntake;
      this.hud.toast(`Auto-intake ${this.autoIntake ? 'ON' : 'OFF'}`);
    }
    if (inp.toggleBlocker && this.player) {
      if (!this.player.config.shotBlocker) this.hud.toast('This robot has no shot blocker');
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
      ...(this.blockerUp && robot.config.shotBlocker ? { block: true } : {}),
      ...(this.season.maxScoringLevel ? { scoringLevel: this.scoringLevel } : {}),
    };
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
      const on = enabled && !r.sidelined; // a red-carded robot sits out the rest of the match
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
      r.aimTurretAt(target, dt);
      const handled = on && this.rules.handleMechanisms?.(r, cmd, dt);
      if (on && !handled && (cmd.shoot || cmd.pass)) {
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
          if (intakeZoneContains(z, p, pool.radius, 0.4)) {
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
    const net = this.role === 'local' ? '' : `<div>${this.role === 'host' ? 'Hosting' : 'Online'} · room <b>${this.net!.client.room || '—'}</b></div>`;
    if (p) {
      const rs = this.robotSetups.get(p.id)!;
      this.hud.setInfo(
        `<div><b>${p.config.teamNumber}</b> · ${p.alliance.toUpperCase()} ${p.station}</div>` +
          (p.tippedTime > 0.5 ? `<div class="bad">${p.tippedOver ? 'TIPPED OVER' : 'STUCK'} · upright in ${Math.ceil(p.rightingIn)} s</div>` : '') +
          net +
          `<div>Camera: ${this.camera.label} <span class="dim">(V${this.camera.mode === 'chase' ? ' · T flips' : ''})</span></div>` +
          `<div>AUTO: ${rs.manualAuto ? 'you drive' : 'routine'}</div>` +
          `<div>Intake: ${this.autoIntake ? 'auto' : 'manual (J)'} <span class="dim">(I)</span></div>` +
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
        { label: 'Close room', onClick: () => this.callbacks.onExit() },
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
      missedSnapshots: this.clientSync?.missed ?? 0,
      interpDelayMs: Math.round((this.clientSync?.delay ?? 0) * 1000),
      jitterMs: Math.round((this.clientSync?.jitter ?? 0) * 1000),
      hostSimLoad: Math.round(this.simLoad * 100) / 100,
      pixelRatio: this.renderer.currentPixelRatio,
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
    this.touch?.dispose();
    this.camera.dispose();
    this.fader.clear();
    this.hud.dispose();
    this.sfx.dispose();
    this.renderer.dispose();
    this.physics.free();
  }
}
