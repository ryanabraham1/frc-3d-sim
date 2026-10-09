import type { MatchClock } from '../match/clock';
import type { Scoreboard } from '../match/scoreboard';
import type { GamePiecePool } from '../gamepiece/pool';
import type { Robot } from '../robot/robot';
import type { RobotArchetype } from './archetype';

/**
 * MATCH LOGGER — records what the humans did, plus enough world state to rebuild what they saw, as JSON Lines.
 * The point is a dataset for behaviour cloning (then RL fine-tuning); see docs/MATCH-LOGS.md for the format and
 * `tools/demos_to_dataset.py` for the trainer-side loader.
 *
 * Pure logic: no DOM, no Rapier. Game and HeadlessSim call `step()` once per physics step (after `physics.step()`)
 * and `launch()` next to `rules.onLaunch`. Cheap by design: robot rows every `STEPS_PER_FRAME` physics steps,
 * loose pieces every `PIECE_EVERY` frames, plain arrays (no per-frame objects), strings built once at the end.
 */

export const LOG_VERSION = 1;
/** Physics runs at 90 Hz; a robot row every 3 steps = 30 Hz. */
const STEPS_PER_FRAME = 3;
/** Loose-piece keyframe every N robot frames (30 / 15 = 2 Hz). */
const PIECE_EVERY = 15;

/** Who produced a robot's command. Only `human` rows are demonstrations. */
export const SRC = { human: 0, autopilot: 1, bot: 2 } as const;
export type CommandSource = (typeof SRC)[keyof typeof SRC];

/** Column order of a robot row `r` in a frame. Also written to the header so the file is self-describing. */
export const ROBOT_FIELDS = [
  'id', 'x', 'y', 'yaw', 'vx', 'vy', 'omega', 'held', 'climbPhase', 'climbLevel', 'tipped', 'turretYaw', 'src',
] as const;
/** Column order of a command `c` (actions); `climb` is -1 for "no request". Omitted for bots. */
export const COMMAND_FIELDS = ['vx', 'vy', 'omega', 'intake', 'shoot', 'pass', 'climb', 'descend', 'level', 'block', 'aim'] as const;
const CLIMB_PHASES = ['none', 'align', 'rise', 'hanging', 'lower'];

export interface LogSource {
  robots: readonly Robot[];
  pool: GamePiecePool;
  clock: MatchClock;
  score: Scoreboard;
}

export interface LogMeta {
  seasonId: string;
  seed: number;
  fieldLength: number;
  fieldWidth: number;
  /** Archetype of each robot (see archetype.ts); stored in the header so a policy can be conditioned on it. */
  describe: (r: Robot) => RobotArchetype;
  /** Free-form, e.g. 'solo' | 'host' | 'headless'. */
  mode?: string;
  /** Anything else worth keeping (build, difficulty, ...). */
  extra?: Record<string, unknown>;
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;
const r2 = (n: number) => Math.round(n * 100) / 100;

export class MatchLogger {
  /** JSON lines, header first. */
  private readonly lines: string[] = [];
  private steps = 0;
  private frames = 0;
  private scoreSeen = 0;
  private foulSeen = 0;
  private lastMode = '';
  private ended = false;
  private readonly humans = new Set<number>();

  /**
   * @param classify who drives each robot right now (called per frame): `human` robots are logged with their commands.
   */
  constructor(
    private readonly src: LogSource,
    private readonly classify: (r: Robot) => CommandSource,
    { describe, ...meta }: LogMeta,
  ) {
    this.lines.push(JSON.stringify({
      type: 'header',
      version: LOG_VERSION,
      createdAt: new Date().toISOString(),
      ...meta,
      hz: 90 / STEPS_PER_FRAME,
      pieceHz: 90 / STEPS_PER_FRAME / PIECE_EVERY,
      robotFields: ROBOT_FIELDS,
      commandFields: COMMAND_FIELDS,
      climbPhases: CLIMB_PHASES,
      src: SRC,
      robots: src.robots.map((r) => ({
        id: r.id,
        alliance: r.alliance,
        station: r.station,
        team: r.config.teamNumber,
        footprint: { length: r2(r.footprint.length), width: r2(r.footprint.width) },
        maxSpeed: r.config.maxSpeed,
        maxOmega: r.config.maxOmega,
        capacity: r.config.hopperCapacity,
        // What the robot is, so a policy can be conditioned on the archetype it's driving.
        archetype: describe(r),
      })),
    }));
  }

  get frameCount(): number { return this.frames; }
  get done(): boolean { return this.ended; }

  /** Call once per physics step, after `physics.step()`. */
  step(): void {
    if (this.ended) return;
    const { clock } = this.src;
    if (!clock.started || clock.finished) return;
    if (++this.steps % STEPS_PER_FRAME !== 0) return;
    this.frame();
  }

  /** A shot left `r`: the piece and its launch velocity (`vel` is a Rapier world vector; stored in field axes, z up). */
  launch(r: Robot, piece: number, vel: { x: number; y: number; z: number }): void {
    if (this.ended || !this.src.clock.started || this.src.clock.finished) return;
    this.lines.push(JSON.stringify({
      type: 'launch', t: r3(this.src.clock.elapsed), id: r.id, piece,
      v: [r2(vel.x), r2(-vel.z), r2(vel.y)], turretYaw: r3(r.turretYaw),
    }));
  }

  /** Close the log with the final scores. Idempotent. */
  finish(totals?: Record<string, number>): void {
    if (this.ended) return;
    this.drainScoreboard();
    this.lines.push(JSON.stringify({ type: 'end', t: r3(this.src.clock.elapsed), frames: this.frames, humans: this.humans.size, totals }));
    this.ended = true;
  }

  /** The whole log as JSON Lines text. */
  toJSONL(): string {
    return this.lines.join('\n') + '\n';
  }

  private frame(): void {
    const { robots, clock, pool } = this.src;
    const t = r3(clock.elapsed);
    if (clock.mode !== this.lastMode) {
      this.lastMode = clock.mode;
      this.lines.push(JSON.stringify({ type: 'period', t, mode: clock.mode, label: clock.current.label }));
    }
    const rows: unknown[] = [];
    for (const r of robots) {
      const p = r.pose;
      const v = r.fieldVelocity;
      const src = this.classify(r);
      if (src === SRC.human) this.humans.add(r.id);
      const row = [
        r.id, r2(p.x), r2(p.y), r3(p.yaw), r2(v.vx), r2(v.vy), r2(r.body.angvel().y), r.held.length,
        Math.max(0, CLIMB_PHASES.indexOf(r.climbPhase)), r.climbLevel, r.tippedOver ? 1 : 0, r3(r.turretYaw), src,
      ];
      if (src === SRC.bot) rows.push({ r: row });
      else {
        const c = r.lastCommand;
        rows.push({ r: row, c: [
          r2(c.vx), r2(c.vy), r3(c.omega), +c.intake, +c.shoot, +c.pass, c.climb ?? -1, +c.descend,
          c.scoringLevel ?? 0, +!!c.block, +!!c.aim,
        ] });
      }
    }
    this.lines.push(JSON.stringify({ type: 'frame', t, f: this.frames, rows }));
    if (this.frames % PIECE_EVERY === 0) this.pieces(t, pool);
    this.frames++;
    this.drainScoreboard();
  }

  /** Loose pieces on the field: flat [x, y, z, ...] in metres (field frame, z up). */
  private pieces(t: number, pool: GamePiecePool): void {
    const out: number[] = [];
    for (let i = 0; i < pool.count; i++) {
      if (pool.state[i] !== 'field') continue;
      const p = pool.position(i);
      const f = pool.frame.toField(p);
      out.push(r2(f.x), r2(f.y), r2(f.z));
    }
    this.lines.push(JSON.stringify({ type: 'pieces', t, p: out }));
  }

  private drainScoreboard(): void {
    const { score } = this.src;
    for (; this.scoreSeen < score.events.length; this.scoreSeen++) {
      const e = score.events[this.scoreSeen];
      this.lines.push(JSON.stringify({ type: 'score', t: r3(e.t), alliance: e.alliance, category: e.category, points: e.points }));
    }
    for (; this.foulSeen < score.fouls.length; this.foulSeen++) {
      const f = score.fouls[this.foulSeen];
      this.lines.push(JSON.stringify({ type: 'foul', t: r3(f.t), alliance: f.alliance, kind: f.kind, rule: f.rule, id: f.robotId, card: f.card }));
    }
  }
}
