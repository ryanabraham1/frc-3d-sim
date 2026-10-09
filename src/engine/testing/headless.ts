import * as THREE from 'three';
import { spawnClearance } from '../robot/spawnClearance';
import type { Alliance, FieldPose } from '../coords';
import { FieldFrame } from '../coords';
import type { GameSettings, SeasonContext, SeasonDefinition, SeasonRules } from '../core/season';
import { FieldBuilder } from '../field/builder';
import { GamePiecePool } from '../gamepiece/pool';
import type { Hud } from '../hud/hud';
import { MatchClock } from '../match/clock';
import { Scoreboard } from '../match/scoreboard';
import { PhysicsWorld, RapierModule } from '../physics/world';
import { Rng } from '../random';
import { RobotConfig, sanitizeConfig } from '../robot/config';
import { IDLE_COMMAND, Robot, RobotCommand } from '../robot/robot';
import { drainSpilled } from '../robot/spill';
import { describeArchetype } from '../telemetry/archetype';
import { MatchLogger, SRC } from '../telemetry/matchLogger';

/**
 * HEADLESS SIMULATION — a season's real field + Rapier physics + one robot, in Node (no DOM, no renderer).
 * `step()` runs the same calls, in the same order, as Game.step for a robot (drive → climb requests →
 * tick → aim → launch → onLaunch → intake → beforeStep → updateDamping → physics.step → afterStep).
 * Keep it in sync if Game.step changes. Used by the automated physics tests for every registered season.
 */
export class HeadlessSim {
  readonly physics: PhysicsWorld;
  readonly frame: FieldFrame;
  readonly pool: GamePiecePool;
  readonly robot: Robot;
  readonly ctx: SeasonContext;
  readonly rules: SeasonRules;
  readonly rng: Rng;
  /** Launch stats. */
  fired = 0;
  allClear = true;
  spawnGap = Infinity;
  /** Match log (opt in with `log: true`; this also starts the match clock and advances it each step). */
  readonly log?: MatchLogger;

  constructor(
    readonly season: SeasonDefinition,
    R: RapierModule,
    opts: { robot: RobotConfig; alliance: Alliance; pose: FieldPose; seed?: number; station?: number; log?: boolean;
      extraRobots?: { config: RobotConfig; alliance: Alliance; station: number; pose: FieldPose; id: number }[] },
  ) {
    this.physics = new PhysicsWorld(R, 1 / 90);
    const scene = new THREE.Scene();
    this.frame = new FieldFrame(season.fieldLength, season.fieldWidth);
    const builder = new FieldBuilder(this.physics, scene, this.frame);
    this.pool = new GamePiecePool(this.physics, scene, this.frame, season.gamePiece);
    const cfg = season.normalizeRobotConfig?.(opts.robot) ?? sanitizeConfig(opts.robot, season.maxRobotHeight, season.maxRobotPerimeter);
    this.robot = new Robot(this.physics, scene, this.frame, cfg, opts.alliance, 0, opts.station ?? 1, opts.pose);
    this.robot.projectile = { radius: season.gamePiece.radius, airDamping: season.gamePiece.airDamping ?? 0.02 };
    this.robot.shootWhileTracking = false; // settled-aim shots; game.ts enables shoot-while-tracking for REBUILT, tests opt in
    this.robot.controller = 'player';
    season.configureRobot?.(this.robot);
    this.robot.attachPool(this.pool);
    this.rng = new Rng(opts.seed ?? 1);
    const settings: GameSettings = {
      seasonId: season.id,
      alliance: opts.alliance,
      station: 1,
      robot: cfg,
      autoRoutine: 'none',
      manualAuto: true,
      camera: 'driver',
      autoHumanPlayer: false,
      autoIntake: false,
      seed: opts.seed ?? 1,
      shadows: false,
    };
    this.ctx = {
      physics: this.physics,
      scene,
      frame: this.frame,
      builder,
      pool: this.pool,
      robots: [this.robot],
      clock: new MatchClock(season.timeline),
      score: new Scoreboard(season.foulValues),
      rng: this.rng,
      hud: null as unknown as Hud, // rules must only talk to the HUD through ctx.toast
      settings,
      playerRobot: this.robot,
      toast() {},
      humanPlayerIsAuto: () => false,
    };
    for (const extra of opts.extraRobots ?? []) {
      const config = season.normalizeRobotConfig?.(extra.config) ?? sanitizeConfig(extra.config, season.maxRobotHeight, season.maxRobotPerimeter);
      const robot = new Robot(this.physics, scene, this.frame, config, extra.alliance, extra.id, extra.station, extra.pose);
      robot.projectile = { radius: season.gamePiece.radius, airDamping: season.gamePiece.airDamping ?? 0.02 };
      robot.shootWhileTracking = false;
      robot.controller = 'bot';
      season.configureRobot?.(robot);
      robot.attachPool(this.pool);
      this.ctx.robots.push(robot);
    }
    season.buildField(this.ctx);
    this.rules = season.createRules(this.ctx);
    if (opts.log) {
      this.log = new MatchLogger(this.ctx, (r) => (r.controller === 'bot' ? SRC.bot : SRC.human),
        { describe: (r) => describeArchetype(season, r.config), seasonId: season.id, seed: opts.seed ?? 1, fieldLength: season.fieldLength, fieldWidth: season.fieldWidth, mode: 'headless' });
      this.rules.onPeriodChange(this.ctx.clock.start());
    }
  }

  /** Give the robot n pieces straight from the reserve (nothing staged on the field). */
  load(n: number): void {
    for (const i of this.pool.indices('reserve').slice(0, n)) {
      this.pool.hold(i, this.robot.id);
      this.robot.held.push(i);
    }
  }

  /** Put n reserve pieces on the field at the given FIELD points. */
  scatter(points: { x: number; y: number }[]): void {
    const free = this.pool.indices('reserve');
    points.forEach((p, k) => free[k] !== undefined && this.pool.placeField(free[k], p.x, p.y));
  }

  step(cmd: RobotCommand = IDLE_COMMAND): void {
    const { robot, pool, rules, physics } = this;
    const dt = physics.dt;
    if (this.log) for (const ch of this.ctx.clock.advance(dt)) rules.onPeriodChange(ch);
    robot.enabled = true;
    if (rules.adjustCommand) cmd = rules.adjustCommand(robot, cmd, dt);
    const target = cmd.pass && !cmd.shoot && rules.passTarget ? rules.passTarget(robot) : rules.aimTarget(robot);
    cmd = robot.autoAlign(cmd, target);
    robot.lastCommand = cmd;
    robot.overheadLimit = rules.overheadClearance?.(robot) ?? Infinity;
    robot.drive(cmd, dt);
    if (cmd.descend && robot.isClimbing) rules.requestDescend(robot);
    else if (cmd.climb !== null && !robot.isClimbing && !robot.tippedOver && robot.config.climber.maxLevel > 0) rules.requestClimb(robot, cmd.climb);
    robot.tick(dt);
    drainSpilled(robot, pool);
    robot.aimTurretAt(target, dt);
    if (!rules.handleMechanisms) robot.advanceScoringMechanisms(dt);
    const handled = rules.handleMechanisms?.(robot, cmd, dt);
    if (!handled && (cmd.shoot || cmd.pass)) {
      const shot = robot.launch(target, this.rng);
      if (shot) {
        const idx = robot.held.pop()!;
        pool.placeWorld(idx, shot.pos, shot.vel);
        if (robot.config.launcher.exitInside) pool.releaseGhost(idx, () => spawnClearance(robot, pool.position(idx), pool.colliderRadius, pool.colliderHalfHeight) > 0.02);
        robot.noteLaunch(idx);
        rules.onLaunch(robot, idx);
        this.log?.launch(robot, idx, shot.vel);
        this.fired++;
        this.allClear &&= robot.lastShotClear;
        // Pieces leave from the real launcher height, inside the chassis box, and pass through robots briefly (releaseGhost):
        // the gap now measures only a launcher placed outside the frame, so it is no longer a spawn-overlap check.
      }
    }
    robot.tickIntake(dt);
    if (!rules.handlesIntake && cmd.intake && robot.intakeRoom > 0) {
      for (let i = 0; i < pool.count; i++) {
        if (pool.state[i] !== 'field') continue;
        const p = pool.position(i);
        if (robot.justLaunched(i)) continue;
        if ((p.y < 0.4 && robot.intakeContains(p, pool.radius)) || robot.stationContains(p, pool.radius)) {
          pool.hold(i, robot.id);
          robot.held.push(i);
          if (robot.intakeRoom <= 0) break;
        }
      }
    }
    rules.beforeStep(dt);
    pool.updateDamping();
    physics.step();
    rules.afterStep(dt);
    this.log?.step();
  }

  run(seconds: number, cmd: RobotCommand = IDLE_COMMAND, until?: () => boolean): void {
    for (let i = 0; i < Math.round(seconds / this.physics.dt); i++) {
      this.step(cmd);
      if (until?.()) break;
    }
  }

  dispose(): void {
    this.physics.free();
  }
}

export { spawnClearance };
