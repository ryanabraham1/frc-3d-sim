import { CameraRig, CAMERA_LABELS } from '../camera/cameras';
import { Alliance, FieldFrame } from '../coords';
import { FieldBuilder } from '../field/builder';
import { GamePiecePool } from '../gamepiece/pool';
import { Hud } from '../hud/hud';
import { DEFAULT_CONTROLS_HELP, DriverInput, InputManager } from '../input/input';
import { MatchClock, PeriodChange } from '../match/clock';
import { Scoreboard } from '../match/scoreboard';
import { PhysicsWorld, RapierModule } from '../physics/world';
import { Rng } from '../random';
import { Renderer } from '../render/renderer';
import { sanitizeConfig } from '../robot/config';
import { IDLE_COMMAND, Robot, RobotCommand } from '../robot/robot';
import { clamp, formatClock } from '../units';
import type { AutoPilot, GameSettings, SeasonContext, SeasonDefinition, SeasonHud, SeasonRules, ToastKind } from './season';

type GameState = 'countdown' | 'running' | 'paused' | 'results';

export interface GameCallbacks {
  onExit: () => void;
  onRestart: (settings: GameSettings) => void;
}

const PRE_MATCH_COUNTDOWN = 3;

/**
 * Orchestrates one match: builds the world from a SeasonDefinition, runs a fixed-step simulation,
 * routes input (or the AUTO autopilot) to robots, and drives HUD + camera. Year-agnostic.
 */
export class Game {
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
  private readonly seasonHud: SeasonHud;
  readonly player: Robot;

  private state: GameState = 'countdown';
  private countdown = PRE_MATCH_COUNTDOWN;
  private raf = 0;
  private last = 0;
  private acc = 0;
  private time = 0;
  private fpsAcc = 0;
  private fpsFrames = 0;
  private autoIntake: boolean;
  climbLevel: number;
  private disposed = false;

  constructor(
    container: HTMLElement,
    R: RapierModule,
    readonly season: SeasonDefinition,
    readonly settings: GameSettings,
    private readonly callbacks: GameCallbacks,
  ) {
    this.frame = new FieldFrame(season.fieldLength, season.fieldWidth);
    this.renderer = new Renderer(container, season.fieldLength, season.fieldWidth, { shadows: settings.shadows });
    this.physics = new PhysicsWorld(R, 1 / 90);
    this.builder = new FieldBuilder(this.physics, this.renderer.scene, this.frame);
    this.rng = new Rng(settings.seed);
    this.clock = new MatchClock(season.timeline);
    this.score = new Scoreboard(season.foulValues);
    this.hud = new Hud(container, season.controlsHelp ?? DEFAULT_CONTROLS_HELP);
    this.pool = new GamePiecePool(this.physics, this.renderer.scene, this.frame, season.gamePiece);
    this.autoIntake = settings.autoIntake;
    this.climbLevel = Math.min(season.maxClimbLevel, settings.robot.climber.maxLevel);

    // Singleplayer: only the player's robot is on the field. The robots array + per-robot commands
    // are kept so multiplayer can add remote robots later (see engine/net/adapter.ts).
    const cfg = sanitizeConfig(settings.robot, season.maxRobotHeight, season.maxRobotPerimeter);
    const robot = new Robot(this.physics, this.renderer.scene, this.frame, cfg, settings.alliance, 0, settings.station, season.startPose(settings.alliance, settings.station));
    robot.controller = 'player';
    this.robots.push(robot);
    this.player = robot;

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
      toast(msg: string, kind?: ToastKind, alliance?: Alliance) {
        self.hud.toast(msg, kind, alliance);
      },
    };

    season.buildField(this.ctx);
    this.rules = season.createRules(this.ctx);
    this.rules.stage();

    for (const r of this.robots) this.autoPilots.set(r.id, season.createAutoPilot(this.ctx, this.rules, r, settings.autoRoutine));

    this.camera = new CameraRig(this.renderer.camera, this.renderer.renderer.domElement, this.frame, season.driverEye(settings.alliance, settings.station));
    this.camera.setMode(settings.camera ?? 'driver');
    this.seasonHud = season.createHud(this.ctx, this.rules, this.hud.slots);
    this.hud.showBanner('ROBOTS READY', PRE_MATCH_COUNTDOWN);
    this.hud.toggleHelp(true);
    setTimeout(() => !this.disposed && this.hud.toggleHelp(false), 6000);
  }

  start(): void {
    this.last = performance.now();
    const loop = (now: number) => {
      if (this.disposed) return;
      this.raf = requestAnimationFrame(loop);
      this.frameTick(now);
    };
    this.raf = requestAnimationFrame(loop);
  }

  private frameTick(now: number): void {
    const dt = clamp((now - this.last) / 1000, 0, 0.1);
    this.last = now;
    this.time += dt;
    const inp = this.input.read();
    this.handleUiInput(inp);

    if (this.state === 'countdown' || this.state === 'running') {
      const fixed = this.physics.dt;
      this.acc += dt;
      let steps = 0;
      while (this.acc >= fixed && steps < 5) {
        this.step(fixed, inp);
        this.acc -= fixed;
        steps++;
        // Edge-triggered inputs apply to the first step only.
        inp.humanPlayer = false;
      }
      if (steps === 5) this.acc = 0;
    }

    this.rules.updateVisuals(dt, this.time);
    for (const r of this.robots) r.syncVisual();
    this.pool.syncVisuals();
    this.camera.update(dt, this.player.pose, undefined, this.player.elevation);
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
      if (this.state === 'paused') this.resume();
      else if (this.state === 'running' || this.state === 'countdown') this.pause();
    }
    if (inp.restart && (this.state === 'paused' || this.state === 'results')) this.callbacks.onRestart(this.settings);
    const maxLvl = Math.min(this.season.maxClimbLevel, this.player?.config.climber.maxLevel ?? 0);
    if (inp.setLevel !== null) this.climbLevel = clamp(inp.setLevel, 1, Math.max(1, maxLvl));
    if (inp.levelUp) this.climbLevel = clamp(this.climbLevel + 1, 1, Math.max(1, maxLvl));
    if (inp.levelDown) this.climbLevel = clamp(this.climbLevel - 1, 1, Math.max(1, maxLvl));
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
    };
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

    if (inp.humanPlayer && this.player && this.state === 'running') this.rules.humanPlayerAction(this.player.alliance);

    for (const r of this.robots) {
      r.enabled = enabled;
      let cmd: RobotCommand = IDLE_COMMAND;
      if (enabled) {
        const manual = r.controller === 'player' && (mode === 'teleop' || this.settings.manualAuto);
        cmd = manual ? this.playerCommand(inp, r) : (this.autoPilots.get(r.id)?.update(dt) ?? IDLE_COMMAND);
      }
      r.lastCommand = cmd;
      r.drive(cmd, dt);
      if (enabled) {
        if (cmd.descend && r.isClimbing) this.rules.requestDescend(r);
        else if (cmd.climb !== null && !r.isClimbing && r.config.climber.maxLevel > 0) this.rules.requestClimb(r, cmd.climb);
      }
      r.tick(dt);
      const target = cmd.pass && !cmd.shoot && this.rules.passTarget ? this.rules.passTarget(r) : this.rules.aimTarget(r);
      r.aimTurretAt(target, dt);
      if (enabled && (cmd.shoot || cmd.pass)) {
        const shot = r.launch(target, this.rng);
        if (shot) {
          const idx = r.held.pop()!;
          this.pool.placeWorld(idx, shot.pos, shot.vel);
          this.rules.onLaunch(r, idx);
        }
      }
    }

    // Intake: robots swallow pieces inside their capture zone.
    if (enabled) {
      const pool = this.pool;
      for (let i = 0; i < pool.count; i++) {
        if (pool.state[i] !== 'field') continue;
        const p = pool.position(i);
        if (p.y > 0.4) continue;
        for (const r of this.robots) {
          if (!r.lastCommand.intake || r.capacityLeft <= 0) continue;
          if (r.intakeContains(p, pool.radius)) {
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

  private updateHud(dt: number): void {
    this.hud.update(dt);
    this.hud.setScores(this.score.total('red'), this.score.total('blue'));
    if (this.state === 'countdown') this.hud.setClock('PRE-MATCH', String(Math.ceil(this.countdown)));
    else this.hud.setClock(this.clock.finished ? 'MATCH OVER' : this.clock.current.label, formatClock(this.clock.displayTime));
    const p = this.player;
    if (p) {
      this.hud.setInfo(
        `<div><b>${p.config.teamNumber}</b> · ${p.alliance.toUpperCase()} ${p.station}</div>` +
          `<div>Camera: ${CAMERA_LABELS[this.camera.mode]} <span class="dim">(V)</span></div>` +
          `<div>AUTO: ${this.settings.manualAuto ? 'you drive' : 'routine'}</div>` +
          `<div>Intake: ${this.autoIntake ? 'auto' : 'manual (J)'} <span class="dim">(F)</span></div>` +
          `<div>Climb target: L${this.climbLevel} <span class="dim">(1-3)</span></div>` +
          `<div class="dim">? for controls</div>`,
      );
    }
    this.seasonHud.update();
  }

  pause(): void {
    if (this.state !== 'running' && this.state !== 'countdown') return;
    const prev = this.state;
    this.state = 'paused';
    this.hud.showModal('Paused', `<p>Match is paused.</p>`, [
      { label: 'Resume', primary: true, onClick: () => this.resume(prev) },
      { label: 'Restart match', onClick: () => this.callbacks.onRestart(this.settings) },
      { label: 'Main menu', onClick: () => this.callbacks.onExit() },
    ]);
  }

  resume(to: GameState = this.clock.started ? 'running' : 'countdown'): void {
    if (this.state !== 'paused') return;
    this.state = to;
    this.last = performance.now();
    this.hud.hideModal();
  }

  private showResults(): void {
    this.state = 'results';
    const res = this.rules.results();
    this.hud.showModal('Match Results', Hud.resultsHtml(res, { red: this.score.total('red'), blue: this.score.total('blue') }), [
      { label: 'Play again', primary: true, onClick: () => this.callbacks.onRestart({ ...this.settings, seed: this.settings.seed + 1 }) },
      { label: 'Main menu', onClick: () => this.callbacks.onExit() },
    ]);
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.input.dispose();
    this.camera.dispose();
    this.hud.dispose();
    this.renderer.dispose();
    this.physics.free();
  }
}
