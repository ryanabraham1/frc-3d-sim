import type { GamePiecePool, PieceState } from '../gamepiece/pool';
import type { MatchClock } from '../match/clock';
import type { Scoreboard } from '../match/scoreboard';
import type { Robot } from '../robot/robot';
import type { MatchResults, SeasonRules } from '../core/season';
import {
  encodeSnapshot,
  quantize,
  quantizeRot,
  CLOCK_EVERY,
  ROT_QUANTUM,
  type NetGameState,
  type PieceStateEntry,
  type SnapshotMeta,
} from './protocol';

const STATE_CODE: Record<PieceState, number> = { field: 0, held: 1, reserve: 2 };

/** What a snapshot is built from: the match authority's world, on the page or in the simulation worker. */
export interface SnapshotSource {
  readonly pool: GamePiecePool;
  readonly robots: Robot[];
  readonly clock: MatchClock;
  readonly score: Scoreboard;
  readonly rules: SeasonRules;
  readonly netState: NetGameState;
  readonly countdownLeft: number;
  readonly lastResults: MatchResults | null;
}

/**
 * Builds snapshots: robots every time, only moved pieces, piece state/score/rules only when changed. Touches no network
 * or DOM, so it runs wherever the match does.
 */
export class SnapshotEncoder {
  private readonly lastQ: Int16Array;
  private readonly lastRot: Int16Array;
  private lastScore = '';
  private lastRules = '';
  /** JSON of each top-level rules key as last sent (for `rulesPatch`). */
  private readonly lastRulesKeys = new Map<string, string>();
  private seq = 0;
  private lastClockPhase = '';
  private forceKey = true;

  constructor(
    private readonly src: SnapshotSource,
    /** Pieces whose state changed since the last snapshot. */
    private readonly takeChanges: () => number[] = () => src.pool.takeChanges(),
  ) {
    this.lastQ = new Int16Array(src.pool.count * 3).fill(-32768);
    this.lastRot = new Int16Array(src.pool.count * 4).fill(-32768);
  }

  /** Force the next snapshot to carry everything (e.g. a client just (re)built its world). */
  requestKeyframe(): void {
    this.forceKey = true;
  }

  /** Build one snapshot. `time` = host sim time (s); `ack` = the last command sequence applied for a robot. */
  encode(time: number, ack: (robotId: number) => number): ArrayBuffer {
    const { pool, robots, score, rules, clock } = this.src;
    const key = this.forceKey;
    this.forceKey = false;

    const changed = this.takeChanges();
    const changedSet = key ? null : new Set(changed);
    const pieces: PieceStateEntry[] = [];
    const list = key ? Array.from({ length: pool.count }, (_, i) => i) : changed;
    for (const i of list) pieces.push([i, STATE_CODE[pool.state[i]], pool.owner[i], pool.tag[i]]);

    const pieceIdx: number[] = [];
    const piecePos: number[] = [];
    const rotations: [number, number, number, number, number][] = [];
    const { lastQ, lastRot } = this;
    for (let i = 0; i < pool.count; i++) {
      if (pool.state[i] !== 'field') continue;
      const body = pool.bodies[i];
      const fresh = key || changedSet!.has(i);
      // Every field piece is compared with what was last sent (never skipped as "asleep": that flag is not
      // proof a body hasn't moved), so clients always see pieces where the host has them.
      const p = body.translation();
      const qx = quantize(p.x);
      const qy = quantize(p.y);
      const qz = quantize(p.z);
      const k = i * 3;
      let moved = fresh || lastQ[k] !== qx || lastQ[k + 1] !== qy || lastQ[k + 2] !== qz;
      let rot: [number, number, number, number, number] | null = null;
      if (pool.specAt(i).shape === 'tube') {
        // Tubes (not round) also need their orientation — but only when it changed.
        const q = body.rotation();
        const r = i * 4;
        const a = quantizeRot(q.x);
        const b = quantizeRot(q.y);
        const c = quantizeRot(q.z);
        const d = quantizeRot(q.w);
        if (fresh || lastRot[r] !== a || lastRot[r + 1] !== b || lastRot[r + 2] !== c || lastRot[r + 3] !== d) {
          lastRot[r] = a;
          lastRot[r + 1] = b;
          lastRot[r + 2] = c;
          lastRot[r + 3] = d;
          rot = [i, a * ROT_QUANTUM, b * ROT_QUANTUM, c * ROT_QUANTUM, d * ROT_QUANTUM];
          moved = true;
        }
      }
      if (!moved) continue;
      lastQ[k] = qx;
      lastQ[k + 1] = qy;
      lastQ[k + 2] = qz;
      pieceIdx.push(i);
      piecePos.push(p.x, p.y, p.z);
      if (rot) rotations.push(rot);
    }

    const meta: SnapshotMeta = { st: this.src.netState, cd: this.src.countdownLeft };
    const ck = clock.snapshot();
    const phase = `${ck.i}:${ck.s}:${ck.f}`;
    if (key || phase !== this.lastClockPhase || (this.seq + 1) % CLOCK_EVERY === 0) {
      meta.clock = { ...ck, ep: Math.round(ck.ep * 1000) / 1000, e: Math.round(ck.e * 1000) / 1000 };
      this.lastClockPhase = phase;
    }
    if (rotations.length) meta.rotations = rotations;
    if (key) meta.key = true;
    if (pieces.length) meta.pieces = pieces;
    const sc = score.snapshot();
    const scJson = JSON.stringify(sc);
    if (key || scJson !== this.lastScore) {
      meta.score = sc;
      this.lastScore = scJson;
    }
    if (rules.netState) this.addRules(meta, rules.netState(), key);
    if (this.src.netState === 'results' && this.src.lastResults) meta.results = this.src.lastResults;

    return encodeSnapshot({
      seq: ++this.seq,
      time,
      robots: robots.map((r) => r.netState(ack(r.id))),
      pieceIdx,
      piecePos,
      meta,
    });
  }

  /**
   * Season rules state: a plain object is diffed per top-level key so a constantly-changing field (e.g. a
   * swinging cage) doesn't resend the rest (e.g. every scored piece) 30 times a second.
   */
  private addRules(meta: SnapshotMeta, rs: unknown, key: boolean): void {
    if (!rs || typeof rs !== 'object' || Array.isArray(rs)) {
      const json = JSON.stringify(rs);
      if (key || json !== this.lastRules) meta.rules = rs;
      this.lastRules = json;
      return;
    }
    const patch: Record<string, unknown> = {};
    let changed = false;
    for (const [k, v] of Object.entries(rs)) {
      const json = JSON.stringify(v);
      if (key || this.lastRulesKeys.get(k) !== json) {
        patch[k] = v;
        this.lastRulesKeys.set(k, json);
        changed = true;
      }
    }
    if (key) meta.rules = rs;
    else if (changed) meta.rulesPatch = patch;
  }
}
