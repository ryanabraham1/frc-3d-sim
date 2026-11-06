import type { Alliance } from '../coords';
import type { GameSettings, MatchResults, ToastKind } from '../core/season';
import type { PeriodChange } from '../match/clock';
import type { MatchSetup, NetGameState, RobotNetState } from '../net/protocol';
import type { RadioMessage } from '../ai/team';
import type { RobotCommand } from '../robot/robot';
import type { RobotVisualFrame } from './robotMirror';
import type { GhostRun } from '../ghost/format';
import type { SimRecovery } from '../core/matchSim';

/** Per piece in a frame: drawn (0/1), position (3), quaternion (4). */
export const PIECE_STRIDE = 8;

export type HopperPhysics = 'none' | 'player' | 'all';

/** Screen → worker. */
export type ToWorker =
  | { t: 'warm'; models: readonly (string | undefined)[]; cadDetail?: 'full' | 'match' }
  | { t: 'start' }
  | {
      t: 'init';
      settings: GameSettings;
      setup: MatchSetup;
      /** 'host' adds the multiplayer half: remote drivers, snapshots, checkpoints, and the light world multiplayer uses. */
      role: 'local' | 'host';
      /** The robot driven from the screen (null = a spectating host). */
      playerId: number | null;
      cadDetail?: 'full' | 'match';
      /** Real-body hoppers: none, the player's robot, or every robot. */
      hopper: HopperPhysics;
      /** Which real-body hopper (see WorldOptions.hopperMode). */
      hopperMode?: 'mech' | 'stowbay';
      /** StowBay.ACTIVE_MAX for this device. */
      activeMax: number;
      log: boolean;
      /** Record the driver for the solo leaderboard. */
      ghost: boolean;
      speed: number;
    }
  | { t: 'input'; cmd: RobotCommand; hp: number[]; boost?: boolean }
  | { t: 'pause' }
  | { t: 'resume' }
  | { t: 'finishLog'; totals?: Record<string, number> }
  // Host only.
  | { t: 'remoteCmd'; robot: number; cmd: RobotCommand; seq: number }
  | { t: 'dropCmds'; robot?: number }
  | { t: 'remoteHp'; alliance: Alliance; button: number }
  | { t: 'keyframe' }
  | { t: 'link'; connected: boolean; clear: boolean }
  | { t: 'snapshotSent' }
  | { t: 'frameDone' }
  | { t: 'allReady' }
  | { t: 'checkpoint' }
  | { t: 'restore'; state: SimRecovery };

export type SimEvent =
  | { k: 'toast'; msg: string; kind: ToastKind; alliance?: Alliance; robot?: number }
  | { k: 'cue'; robot: number; text: string; cls?: string }
  | { k: 'period'; ch: PeriodChange }
  | { k: 'ghost'; run: GhostRun }
  | { k: 'results'; res: MatchResults }
  | { k: 'radio'; m: RadioMessage }
  /** Host: every driver is ready and the countdown has begun. */
  | { k: 'countdown' }
  /** Host: a recovery checkpoint was applied. */
  | { k: 'restored'; paused: boolean };

/** HUD readouts of a robot that the screen can't derive from its posed copy. */
export interface RobotHudState {
  overheadLimit: number;
  hopperRaised: boolean;
  blockerDeploy: number;
  hopperCapacity: number;
  packLimit: boolean;
}

/** Worker → screen, after every batch of physics steps. */
export interface SimFrame {
  t: 'frame';
  /** Sim time (s) at the end of the batch. */
  time: number;
  st: NetGameState;
  cd: number;
  clock: ReturnType<import('../match/clock').MatchClock['snapshot']>;
  /** Only when it changed. */
  score?: ReturnType<import('../match/scoreboard').Scoreboard['snapshot']>;
  /** Season rules' replicated state, only when it changed. */
  rules?: unknown;
  robots: RobotNetState[];
  hud: RobotHudState[];
  visuals: RobotVisualFrame[];
  pieces: Float32Array;
  /** [index, state code (0 field · 1 held · 2 reserve), owner, tag] for pieces that changed state. */
  pieceStates: [number, number, number, string | null][];
  events: SimEvent[];
  boost: boolean;
  /**
   * Worker timings (ms, smoothed): one physics step, building and posting a frame. One pass of the loop (smoothed, and
   * the longest of the last window). The last checkpoint's capture. Fraction of wall time the loop was busy. And
   * real-body hoppers running.
   */
  perf: { stepMs: number; frameMs: number; tickMs: number; tickMaxMs: number; checkpointMs: number; load: number; realHoppers: number };
}

export type FromWorker =
  | { t: 'ready'; shapes: string[] }
  | SimFrame
  /** Host: an encoded snapshot for the page to send (the buffer is transferred). */
  | { t: 'snapshot'; buf: ArrayBuffer }
  /** Host: a recovery checkpoint, compressed here so the page only forwards it. */
  | { t: 'checkpoint'; data: unknown }
  | { t: 'log'; text: string; frames: number }
  | { t: 'error'; message: string };
