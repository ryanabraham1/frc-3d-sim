import type * as THREE from 'three';
import type { Alliance, FieldFrame, FieldPose } from '../coords';
import type { FieldBuilder } from '../field/builder';
import type { GamePiecePool, GamePieceSpec } from '../gamepiece/pool';
import type { Hud } from '../hud/hud';
import type { MatchClock, MatchPeriod, PeriodChange } from '../match/clock';
import type { FoulKind, Scoreboard } from '../match/scoreboard';
import type { PhysicsWorld } from '../physics/world';
import type { CameraMode } from '../camera/cameras';
import type { Rng } from '../random';
import type { RobotConfig } from '../robot/config';
import type { AimTarget, Robot, RobotCommand } from '../robot/robot';
import type { StartArea, StartSpot } from '../startPose';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE SEASON CONTRACT
 *  Everything year-specific lives behind this interface. At kickoff, create
 *  src/seasons/<year>-<name>/index.ts exporting a SeasonDefinition and register
 *  it in src/seasons/index.ts. The engine handles rendering, physics, input,
 *  cameras, robots, the match clock, HUD chrome and the game loop.
 * ═══════════════════════════════════════════════════════════════════════════
 */

export interface GameSettings {
  seasonId: string;
  alliance: Alliance;
  station: number;
  /** Custom starting position (blue frame, see startPose.ts); null/undefined = the driver station's preset. */
  startSpot?: StartSpot | null;
  robot: RobotConfig;
  /** Player robot's autonomous routine id. */
  autoRoutine: string;
  /** Player drives during AUTO instead of running an autonomous routine. */
  manualAuto: boolean;
  /** Starting camera. */
  camera: CameraMode;
  /** Human player for the player's alliance acts automatically. */
  autoHumanPlayer: boolean;
  /** Intake runs whenever there's room (otherwise hold J). */
  autoIntake: boolean;
  seed: number;
  shadows: boolean;
  /** Fill the remaining single-player stations with AI (default true). */
  aiOpponents?: boolean;
  aiDifficulty?: 'easy' | 'normal' | 'hard';
}

export type ToastKind = 'info' | 'good' | 'foul' | 'warn';

export interface SeasonContext {
  readonly physics: PhysicsWorld;
  readonly scene: THREE.Scene;
  readonly frame: FieldFrame;
  readonly builder: FieldBuilder;
  readonly pool: GamePiecePool;
  readonly robots: Robot[];
  readonly clock: MatchClock;
  readonly score: Scoreboard;
  readonly rng: Rng;
  readonly hud: Hud;
  readonly settings: GameSettings;
  /** The robot driven on THIS screen (null for a multiplayer spectator). */
  readonly playerRobot: Robot | null;
  /**
   * Show a toast. With `robot`, only that robot's driver sees it (hints like "drive closer"); otherwise
   * everyone does (in multiplayer the host forwards it to all clients).
   */
  toast(msg: string, kind?: ToastKind, alliance?: Alliance, robot?: Robot): void;
  /**
   * Live on-screen status for one robot's driver (e.g. "PINNING 254"): shown big in the middle of the screen, and it
   * fades if not refreshed within a moment. `cls` styles it ('pin', 'pin danger').
   */
  cue?(robot: Robot, text: string, cls?: string): void;
  /** Should this alliance's human player act automatically (vs. a driver pressing the HP button)? */
  humanPlayerIsAuto(alliance: Alliance): boolean;
}

export interface ResultsRow {
  label: string;
  red: string | number;
  blue: string | number;
  emphasis?: boolean;
  /**
   * Scoreboard categories this row sums. Rows that list them also appear in each player's breakdown, valued with
   * the points credited to that robot (`Scoreboard.add(..., robotId)` / `setCredit`).
   */
  cats?: string[];
}

/** One robot's line in the post-match player breakdown. */
export interface PlayerResults {
  id: number;
  alliance: Alliance;
  name: string;
  team: number;
  /** Points credited to this robot (alliance foul points and bonuses are not included). */
  total: number;
  rows: { label: string; value: number }[];
  stats: { label: string; value: string | number }[];
}

export interface MatchResults {
  winner: Alliance | 'tie';
  rows: ResultsRow[];
  rp: Record<Alliance, number>;
  rpDetail: Record<Alliance, string[]>;
  /** Per-robot breakdown, added by the engine once the match ends. */
  players?: PlayerResults[];
  /** Points an alliance earned that no robot could be credited with. */
  uncredited?: Record<Alliance, number>;
}

export interface SeasonRules {
  /** A placement/elevator season can own mechanisms and intake instead of the generic shooter. */
  handlesIntake?: boolean;
  handleMechanisms?(robot: Robot, command: RobotCommand, dt: number): boolean;
  /**
   * Optional driver assist applied to a robot's command BEFORE it drives (manual and AUTO), e.g. REEFSCAPE reef
   * auto-align. Chassis auto-align onto the shot target is applied by the engine afterwards.
   */
  adjustCommand?(robot: Robot, command: RobotCommand, dt: number): RobotCommand;
  /** Stage game pieces and robot preloads for a fresh match. */
  stage(): void;
  onPeriodChange(change: PeriodChange): void;
  /** Every physics step, before stepping. */
  beforeStep(dt: number): void;
  /** Every physics step, after stepping: sensors, zones, scoring, fouls. */
  afterStep(dt: number): void;
  /** A robot just launched game piece `pieceIndex`. */
  onLaunch(robot: Robot, pieceIndex: number): void;
  /** Where this robot's launcher should aim (world space), or null. */
  aimTarget(robot: Robot): AimTarget | null;
  /** Optional feed/pass target (e.g. lob game pieces back to your own zone). */
  passTarget?(robot: Robot): AimTarget | null;
  requestClimb(robot: Robot, level: number): void;
  requestDescend(robot: Robot): void;
  /** A human-player button was pressed (`button` 1 = H; 2 / 3 only for seasons declaring `humanPlayerButtons`). */
  humanPlayerAction(alliance: Alliance, button?: number): void;
  /** Per rendered frame: lights and other cosmetic effects. */
  updateVisuals(dt: number, time: number): void;
  results(): MatchResults;
  /**
   * Multiplayer: JSON-serializable rules state that clients need for HUD/visuals (not the score or clock —
   * the engine syncs those). Clients never run stage/beforeStep/afterStep; they only call applyNetState.
   */
  netState?(): unknown;
  applyNetState?(state: unknown): void;
}

/**
 * Drives a robot without driver input — used for the AUTO period (drivers may not control robots in
 * AUTO), or throughout TELEOP for an AI opponent.
 */
export interface AutoPilot {
  update(dt: number): RobotCommand;
}

export interface SeasonHud {
  update(): void;
}

export interface HudSlots {
  red: HTMLElement;
  blue: HTMLElement;
  center: HTMLElement;
  player: HTMLElement;
}

/** Menu minimap shape, in BLUE-side field coordinates (meters); the menu mirrors it for red. */
export interface MapShape {
  kind: 'zone' | 'hub' | 'bump' | 'trench' | 'tower' | 'depot' | 'outpost';
  points: [number, number][];
}

export interface TeamRobot {
  id: string;
  team: number;
  /** Robot name, e.g. "Vortex". */
  name: string;
  /** One-line summary for the menu. */
  description: string;
  /** Where the details came from (Chief Delphi thread, tech binder). */
  source: string;
  config: RobotConfig;
}

export interface RobotOption {
  id: string;
  label: string;
  hint?: string;
  choices: { id: string; label: string; title?: string }[];
  get(config: RobotConfig): string;
  set(config: RobotConfig, choice: string): void;
}

export interface AutoRoutine {
  id: string;
  label: string;
  description: string;
}

export interface SeasonDefinition {
  id: string;
  year: number;
  name: string;
  subtitle: string;
  manualVersion: string;
  summary: string;

  fieldLength: number;
  fieldWidth: number;
  carpetColor: number;
  maxRobotHeight: number;
  maxRobotPerimeter: number;
  /** Heaviest legal robot as it plays, WITH bumpers and battery (kg) — caps the menu's weight field. */
  maxRobotWeight?: number;
  foulValues: Record<FoulKind, number>;

  timeline: MatchPeriod[];
  gamePiece: GamePieceSpec;
  robotDefaults: RobotConfig;
  maxClimbLevel: number;
  maxScoringLevel?: number;
  climberLabels?: string[];
  robotHint?: string;
  robotLimits?: { capacity: number; preload: number };
  normalizeRobotConfig?(config: RobotConfig): RobotConfig;
  robotPresets?: { id: string; label: string; description: string; config: RobotConfig }[];
  /**
   * Real robots from that season (top teams), playable as-is: config approximates their capabilities and
   * `config.model` names a simplified animated 3D model (src/engine/robot/models.ts). Optional QoL for past seasons.
   */
  teamRobots?: TeamRobot[];
  robotSummary?(config: RobotConfig): string;
  configureRobot?(robot: Robot): void;
  autoRoutines: AutoRoutine[];
  /** Optional top-down field features for the menu's starting-spot map. */
  mapShapes?: MapShape[];
  /** How the red half mirrors the blue `mapShapes`: rotational (default, L−x, W−y) or mirror (L−x, y). */
  mapSymmetry?: 'rotational' | 'mirror';
  /** Number of human-player buttons (1 = H only; 2 adds B / gamepad LB; 3 adds N; 4 adds M). Default 1. */
  humanPlayerButtons?: number;
  /**
   * Robot-builder choices shown on the menu (archetype mechanisms: intake type, shooter type, aiming, climber…).
   * Each option is a segmented control; `get` reads the current choice from a config and `set` applies one.
   */
  robotOptions?: RobotOption[];
  /** Numeric robot fields shown on the menu (keys of the menu's field table). Default: the generic shooter set. */
  robotFields?: string[];
  /** Season-specific meaning of the menu's "Accuracy %" (e.g. calibrated to a real hit rate); default is a raw spread map. */
  shotAccuracy?: { get(config: RobotConfig): number; set(config: RobotConfig, percent: number): void };
  /** Spec bars summarizing a config on the menu. */
  robotSpecBars?(config: RobotConfig): { label: string; value: string; frac: number }[];
  /** Menu hint for the human-player option (auto / manual). */
  humanPlayerHint?: { auto: string; manual: string };

  startPose(alliance: Alliance, station: number): FieldPose;
  /** Where robots may legally start (blue frame): lets players place their robot anywhere inside it, at any heading. */
  startArea?: StartArea;
  driverEye(alliance: Alliance, station: number): { x: number; y: number; z: number; yaw: number };

  buildField(ctx: SeasonContext): void;
  createRules(ctx: SeasonContext): SeasonRules;
  createAutoPilot(ctx: SeasonContext, rules: SeasonRules, robot: Robot, routine: string): AutoPilot;
  botAutoRoutine?(station: number): string;
  botRobotConfig?(difficulty: NonNullable<GameSettings['aiDifficulty']>): RobotConfig;
  createBotPilot?(ctx: SeasonContext, rules: SeasonRules, robot: Robot): AutoPilot;
  createHud(ctx: SeasonContext, rules: SeasonRules, slots: HudSlots): SeasonHud;
  controlsHelp?: [string, string][];
  /** Key rules/points shown on the menu's "Game rules" page. */
  rulesSummary?: { title: string; detail: string; value?: string; tag?: string }[];
  /**
   * REQUIRED for the automated physics checks in tests/shooting.test.ts (every registered season is
   * tested): legal scoring positions and a way to count pieces that entered the goal.
   */
  testing?: SeasonTesting;
}

export interface SeasonTesting {
  /** Placement seasons use their mechanism suite rather than projectile-only trials. */
  mechanism?: 'projectile' | 'placement';
  /** Season-appropriate floor-piece scatter for traversal regression trials. */
  scatterCount?: number;
  /** Positions (FIELD frame) where a robot may legally score — e.g. a grid over its scoring zone. */
  scoringSpots(alliance: Alliance): FieldPose[];
  /** Total game pieces that have entered this alliance's goal so far (regardless of whether they scored points). */
  goalCount(ctx: SeasonContext, alliance: Alliance): number;
  /**
   * Optional: can a shot at the goal physically succeed from this FIELD position (e.g. not from far off the axis of
   * a goal with a deep opening)? The shot harness only fires from positions where this is true — as a driver would.
   */
  canScoreFrom?(alliance: Alliance, x: number, y: number): boolean;
  /** Goal center (FIELD frame) — used to point a turret-less chassis at the goal. */
  goalCenter(alliance: Alliance): { x: number; y: number };
  /**
   * Paths robots must be able to drive (e.g. over each bump, under each trench), optionally limited to
   * robots at or under `maxRobotHeight`. The tests drive them — also through scattered game pieces.
   */
  traversals(): { label: string; from: { x: number; y: number }; to: { x: number; y: number }; maxRobotHeight?: number }[];
}
