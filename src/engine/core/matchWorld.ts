import * as THREE from 'three';
import type { Alliance } from '../coords';
import { FieldFrame } from '../coords';
import { FieldBuilder } from '../field/builder';
import { GamePiecePool } from '../gamepiece/pool';
import type { Hud } from '../hud/hud';
import { MatchClock } from '../match/clock';
import { Scoreboard } from '../match/scoreboard';
import type { MatchSetup, RobotSetup } from '../net/protocol';
import { PhysicsWorld, type RapierModule } from '../physics/world';
import { Rng } from '../random';
import { sanitizeConfig } from '../robot/config';
import { Robot } from '../robot/robot';
import type { GameSettings, SeasonContext, SeasonDefinition, SeasonRules, ToastKind } from './season';

/** How the world talks back to whoever runs it (a view, a host, or a worker posting to a view). */
export interface WorldHooks {
  toast(msg: string, kind: ToastKind, alliance?: Alliance, robot?: Robot): void;
  cue(robot: Robot, text: string, cls?: string): void;
  humanPlayerIsAuto(alliance: Alliance): boolean;
}

export interface WorldOptions {
  /** Scene the field, robots and pieces are added to (a view's render scene, or an unrendered one). */
  scene: THREE.Scene;
  /** The id of the robot driven from this screen (null = spectator, or a worker with no screen). */
  playerId: number | null;
  /** Real-body hopper for this robot? */
  realHopper(rs: RobotSetup): boolean;
  /**
   * Which real-body hopper: 'stowbay' (default) = every FUEL robot's held balls are the field's own bodies in the main
   * world, drawn directly by the indexer and caught by roller contact where the model has roller hooks; 'mech' = the
   * separate-world mechanism hopper for models with hooks (`?hopper=mech`; robots without them keep the particle pile).
   */
  hopperMode?: 'mech' | 'stowbay';
  /** Draw pieces travelling through the robots (intake → hopper → shooter). */
  pieceFlow: boolean;
  /** Multiplayer uses visual held loads and bounded pile work, preserving field and robot physics. */
  lightweight?: boolean;
  /** Bake static robot parts into a few meshes (only worth it where the robots are drawn — and both sides of a mirror must agree). */
  optimize: boolean;
  /** HUD handed to the season context (rules only use ctx.toast; season HUDs get their own slots). */
  hud?: Hud | null;
  /** Settings the AI reads (a lobby's bot difficulty applied). */
  aiSettings: GameSettings;
}

/**
 * The match world: Rapier physics, the season's field, game pieces, robots and rules, with nothing about how it is
 * stepped or shown. The authority (MatchSim) steps it; views and multiplayer clients pose a replica of it.
 */
export class MatchWorld {
  readonly frame: FieldFrame;
  readonly physics: PhysicsWorld;
  readonly builder: FieldBuilder;
  readonly pool: GamePiecePool;
  readonly robots: Robot[] = [];
  readonly robotSetups = new Map<number, RobotSetup>();
  readonly clock: MatchClock;
  readonly score: Scoreboard;
  readonly rng: Rng;
  readonly ctx: SeasonContext;
  readonly rules: SeasonRules;
  readonly player: Robot | null;

  constructor(R: RapierModule, readonly season: SeasonDefinition, readonly setup: MatchSetup, opts: WorldOptions, hooks: WorldHooks) {
    const scene = opts.scene;
    this.frame = new FieldFrame(season.fieldLength, season.fieldWidth);
    this.physics = new PhysicsWorld(R, 1 / 90);
    this.builder = new FieldBuilder(this.physics, scene, this.frame);
    this.rng = new Rng(setup.seed);
    this.clock = new MatchClock(season.timeline);
    this.score = new Scoreboard(season.foulValues);
    this.pool = new GamePiecePool(this.physics, scene, this.frame, season.gamePiece);

    for (const rs of setup.robots) {
      const cfg = season.normalizeRobotConfig?.(rs.config) ?? sanitizeConfig(rs.config, season.maxRobotHeight, season.maxRobotPerimeter);
      const robot = new Robot(this.physics, scene, this.frame, cfg, rs.alliance, rs.id, rs.station, rs.start ?? season.startPose(rs.alliance, rs.station));
      robot.projectile = { radius: season.gamePiece.radius, airDamping: season.gamePiece.airDamping ?? 0.02 };
      robot.pieceMass = season.gamePiece.mass;
      robot.shootWhileTracking = season.id === '2026-rebuilt';
      robot.controller = rs.bot ? 'bot' : 'player';
      season.configureRobot?.(robot);
      // Held FUEL becomes real physics bodies only where it is worth the step time; everyone else draws the visual
      // particle pile.
      robot.setLightweight(opts.lightweight ?? false);
      if (!opts.lightweight && opts.realHopper(rs)) robot.attachPool(this.pool, opts.hopperMode ?? 'stowbay');
      if (opts.pieceFlow && season.pieceFlow !== false) {
        const piece = this.pool.mesh;
        const round = season.gamePiece.shape !== 'ring' && season.gamePiece.shape !== 'tube';
        robot.enablePieceFlow(() => {
          const m = new THREE.Mesh(piece.geometry, piece.material);
          m.castShadow = true;
          return m;
        }, round);
      }
      // Bake each robot's static parts into a few meshes (draw calls dominate the frame cost).
      if (opts.optimize) robot.optimizeVisual();
      this.robots.push(robot);
      this.robotSetups.set(rs.id, rs);
    }
    this.player = opts.playerId === null ? null : this.robots.find((r) => r.id === opts.playerId) ?? null;

    this.ctx = {
      physics: this.physics,
      scene,
      frame: this.frame,
      builder: this.builder,
      pool: this.pool,
      robots: this.robots,
      clock: this.clock,
      score: this.score,
      rng: this.rng,
      hud: (opts.hud ?? null) as Hud, // rules must only talk to the HUD through ctx.toast
      settings: opts.aiSettings,
      playerRobot: this.player,
      toast: (msg: string, kind: ToastKind = 'info', alliance?: Alliance, robot?: Robot) => hooks.toast(msg, kind, alliance, robot),
      cue: (robot: Robot, text: string, cls?: string) => hooks.cue(robot, text, cls),
      humanPlayerIsAuto: (a: Alliance) => hooks.humanPlayerIsAuto(a),
    };
    season.buildField(this.ctx);
    this.rules = season.createRules(this.ctx);
  }

  robot(id: number): Robot | undefined {
    return this.robots.find((r) => r.id === id);
  }

  free(): void {
    this.physics.free();
  }
}
