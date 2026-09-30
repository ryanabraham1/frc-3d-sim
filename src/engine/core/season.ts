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
  /** Should this alliance's human player act automatically (vs. a driver pressing the HP button)? */
  humanPlayerIsAuto(alliance: Alliance): boolean;
}

export interface ResultsRow {
  label: string;
  red: string | number;
  blue: string | number;
  emphasis?: boolean;
}

export interface MatchResults {
  winner: Alliance | 'tie';
  rows: ResultsRow[];
  rp: Record<Alliance, number>;
  rpDetail: Record<Alliance, string[]>;
}

export interface SeasonRules {
  /** A placement/elevator season can own mechanisms and intake instead of the generic shooter. */
  handlesIntake?: boolean;
  handleMechanisms?(robot: Robot, command: RobotCommand, dt: number): boolean;
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
 * AUTO). Not an opponent AI: the sim is singleplayer until multiplayer lands.
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
  robotSummary?(config: RobotConfig): string;
  configureRobot?(robot: Robot): void;
  autoRoutines: AutoRoutine[];
  /** Optional top-down field features for the menu's starting-spot map. */
  mapShapes?: MapShape[];
  /** How the red half mirrors the blue `mapShapes`: rotational (default, L−x, W−y) or mirror (L−x, y). */
  mapSymmetry?: 'rotational' | 'mirror';
  /** Number of human-player buttons (1 = H only; 2 adds B / gamepad LB; 3 adds N). Default 1. */
  humanPlayerButtons?: number;
  /** Menu hint for the human-player option (auto / manual). */
  humanPlayerHint?: { auto: string; manual: string };

  startPose(alliance: Alliance, station: number): FieldPose;
  driverEye(alliance: Alliance, station: number): { x: number; y: number; z: number; yaw: number };

  buildField(ctx: SeasonContext): void;
  createRules(ctx: SeasonContext): SeasonRules;
  createAutoPilot(ctx: SeasonContext, rules: SeasonRules, robot: Robot, routine: string): AutoPilot;
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
