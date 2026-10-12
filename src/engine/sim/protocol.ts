import type { Alliance } from '../coords';
import type { GameSettings, MatchResults, ToastKind } from '../core/season';
import type { PeriodChange } from '../match/clock';
import type { MatchSetup, NetGameState, RobotNetState } from '../net/protocol';
import type { RadioMessage } from '../ai/team';
import type { RobotCommand } from '../robot/robot';
import type { RobotVisualFrame } from './robotMirror';

/** Per piece in a frame: drawn (0/1), position (3), quaternion (4). */
export const PIECE_STRIDE = 8;

export type HopperPhysics = 'none' | 'player' | 'all';

/** Screen → worker. */
export type ToWorker =
  | {
      t: 'init';
      settings: GameSettings;
      setup: MatchSetup;
      /** Real-body hoppers: none, the player's robot, or every robot. */
      hopper: HopperPhysics;
      /** Which real-body hopper (see WorldOptions.hopperMode). */
      hopperMode?: 'mech' | 'stowbay';
      /** StowBay.ACTIVE_MAX for this device. */
      activeMax: number;
      log: boolean;
      speed: number;
    }
  | { t: 'input'; cmd: RobotCommand; hp: number[]; boost?: boolean }
  | { t: 'pause' }
  | { t: 'resume' }
  | { t: 'finishLog'; totals?: Record<string, number> };

export type SimEvent =
  | { k: 'toast'; msg: string; kind: ToastKind; alliance?: Alliance; robot?: number }
  | { k: 'cue'; robot: number; text: string; cls?: string }
  | { k: 'period'; ch: PeriodChange }
  | { k: 'results'; res: MatchResults }
  | { k: 'radio'; m: RadioMessage };

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
  /** Worker timings (ms, smoothed): one physics step, building and posting a frame. And real-body hoppers running. */
  perf: { stepMs: number; frameMs: number; realHoppers: number };
}

export type FromWorker =
  | { t: 'ready'; shapes: string[] }
  | SimFrame
  | { t: 'log'; text: string; frames: number }
  | { t: 'error'; message: string };
