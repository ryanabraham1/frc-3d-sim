import { captureFields, restoreFields, type RecoveryFields } from '../net/recovery';
import { Alliance, opponent } from '../coords';
import type { SeasonContext } from '../core/season';
import type { Robot } from '../robot/robot';
import type { CardKind, FoulKind, FoulRecord } from './scoreboard';
import { bodiesTouching } from '../physics/contacts';
import { robotsTouching } from './pinning';

/**
 * THE REFEREE. Everything a head referee would call from what the robots physically did, in one place so every
 * season gets the same calls (a season only supplies its rule numbers and its season-specific rules):
 *
 *  - `call` writes the foul (and card) to the scoreboard, tells the players; cards never disable robots;
 *  - `ContactTracker` finds robot-to-robot hits through the real Rapier contacts, with the closing speed and who
 *    drove into whom;
 *  - "Don't tip or entangle": driving into an opponent that has started to tip, tipping the same robot twice, or
 *    pushing a robot that is lying on its side;
 *  - "Don't collude": two or more partners shutting something down for 3 s (`blockade`);
 *  - "Use SCORING ELEMENTS as directed" / "Keep SCORING ELEMENTS in bounds": launching a piece off-target into an
 *    opponent, and robots that keep throwing pieces off the FIELD;
 *  - `touching`: contact between two robots, direct or transitively through a SCORING ELEMENT both are touching, which
 *    is what the manuals' "protection" rules (TOWER, CAGE, ZONES, STAGE ...) are written in terms of.
 *
 * Ramming penalties are not enforced; physical collisions still use the normal physics model.
 */

/** Rule numbers of the generic calls, season by season. */
export interface RefereeRules {
  /** "Don't tip or entangle" (2024 G419 · 2025 G424 · 2026 G417). */
  tip: string;
  /** "Don't collude with your partners to shut down major parts of game play" (2024 G421 · 2025 G426 · 2026 G419). */
  collusion: string;
  /** Use SCORING ELEMENTS as directed: launching them at robots (2024 G406 · 2025 G406). Omitted = not called (2026 G404). */
  launchAtRobot?: string;
  /** Keep SCORING ELEMENTS in bounds (2024 G407 · 2025 G407). Omitted = not called (2026 G405). */
  eject?: string;
  /** What this season calls its penalties in messages (2024: 'FOUL' / 'TECH FOUL'). */
  labels?: { minor: string; major: string };
}

export type RefContext = Pick<SeasonContext, 'score' | 'toast' | 'clock' | 'robots' | 'physics' | 'pool'>;

export interface Call {
  rule: string;
  kind: FoulKind;
  /** The robot that committed the violation. */
  robot: Robot;
  /** What happened, for the toast and the foul log. */
  note: string;
  /** "MAJOR FOUL and YELLOW CARD". A second yellow card to the same robot is a red card. */
  card?: CardKind;
}

/** A new contact between two opposing robots. */
export interface Hit {
  a: Robot;
  b: Robot;
  /** Speed (m/s) each robot was closing on the other just before the hit; negative = moving away. */
  aToward: number;
  bToward: number;
  /** Combined closing speed. */
  closing: number;
  /** Unit vector from a to b. */
  nx: number;
  ny: number;
}

/** Chassis tilt (uprightness) at which a robot "starts to tip". */
export const TIP_STARTS = 0.9;
/** Seconds a robot keeps pushing an opponent that is lying on its side before it is CONTINUOUS (red card). */
export const TIP_CONTINUOUS = 2;
/** Seconds after contact that it still counts as the cause of a tip. */
export const TIP_CAUSE_WINDOW = 0.5;

/** Seconds a blockade has to last before the first call, and between further calls. */
export const BLOCKADE_COUNT = 3;

/** A launched piece heading this far (rad) away from where the robot was aiming is "launched at" something else. */
export const OFF_TARGET = 0.8;
/** How long a launched piece is watched for hitting an opponent (s) and remembered for leaving the FIELD (s). */
export const SHOT_WATCH = 2.5;
export const SHOT_MEMORY = 8;

/** How hard robot `a` is driving along (dx, dy) (length d): the faster of where it is going and where it is being driven. */
function drivingToward(a: Robot, dx: number, dy: number, d: number): number {
  const v = a.fieldVelocity, c = a.lastCommand;
  return Math.max((v.vx * dx + v.vy * dy) / d, (c.vx * dx + c.vy * dy) / d);
}

const key = (a: number, b: number) => (a < b ? `${a}:${b}` : `${b}:${a}`);

/** Finds new contacts between opposing robots, with how fast they were closing, from the real Rapier contacts. */
export class ContactTracker {
  recoveryState(): RecoveryFields { return captureFields(this, 'touching last vel'.split(' ')); }
  restoreRecovery(state: RecoveryFields): void { restoreFields(this, 'touching last vel'.split(' '), state); }

  private readonly touching = new Set<string>();
  private readonly last = new Map<string, number>();
  private readonly vel = new Map<number, { vx: number; vy: number }>();

  reset(): void {
    this.touching.clear();
    this.last.clear();
    this.vel.clear();
  }

  isTouching(a: Robot, b: Robot): boolean {
    return this.touching.has(key(a.id, b.id));
  }

  /** Seconds since these two last touched (Infinity if never). */
  since(a: Robot, b: Robot, now: number): number {
    const t = this.last.get(key(a.id, b.id));
    return t === undefined ? Infinity : now - t;
  }

  /** Call once per physics step (after stepping). Returns the contacts that began this step. */
  update(robots: Robot[], physics: RefContext['physics'], now: number): Hit[] {
    const hits: Hit[] = [];
    for (let i = 0; i < robots.length; i++) {
      for (let j = i + 1; j < robots.length; j++) {
        const a = robots[i], b = robots[j];
        if (a.alliance === b.alliance) continue;
        const k = key(a.id, b.id);
        const now_ = robotsTouching(physics, a, b);
        if (now_) {
          if (!this.touching.has(k)) {
            this.touching.add(k);
            const pa = a.pose, pb = b.pose;
            const dx = pb.x - pa.x, dy = pb.y - pa.y, d = Math.hypot(dx, dy) || 1;
            const nx = dx / d, ny = dy / d;
            // Velocities from before this step: the hit itself has already slowed them down.
            const va = this.vel.get(a.id) ?? a.fieldVelocity, vb = this.vel.get(b.id) ?? b.fieldVelocity;
            const aToward = va.vx * nx + va.vy * ny, bToward = -(vb.vx * nx + vb.vy * ny);
            hits.push({ a, b, aToward, bToward, closing: aToward + bToward, nx, ny });
          }
          this.last.set(k, now);
        } else this.touching.delete(k);
      }
    }
    for (const r of robots) this.vel.set(r.id, r.fieldVelocity);
    return hits;
  }
}

interface Flight {
  robot: Robot;
  t: number;
  /** Heading well away from where the robot was aiming (it is not shooting at its goal). */
  offTarget: boolean;
  hit: boolean;
}

export class Referee {
  recoveryState() {
    return { fields: captureFields(this, 'tilt tips pushing pushCalled blockades ejections shotCooldown'.split(' ')),
      contacts: this.contacts.recoveryState(), flights: [...this.flights].map(([idx, { robot, ...flight }]) => [idx, robot.id, flight] as const) };
  }
  restoreRecovery(state: ReturnType<Referee['recoveryState']>): void {
    restoreFields(this, 'tilt tips pushing pushCalled blockades ejections shotCooldown'.split(' '), state.fields);
    this.contacts.restoreRecovery(state.contacts);
    this.flights.clear();
    for (const [idx, id, flight] of state.flights) {
      const robot = this.ctx.robots.find(r => r.id === id);
      if (robot) this.flights.set(idx, { ...flight, robot });
    }
  }

  readonly contacts = new ContactTracker();
  private readonly tilt = new Map<number, { since: number | null; tipped: boolean }>();
  private readonly tips = new Map<string, number>();
  private readonly pushing = new Map<string, number>();
  private readonly pushCalled = new Set<string>();
  private readonly blockades = new Map<string, { time: number; clear: number }>();
  private readonly flights = new Map<number, Flight>();
  private readonly ejections = new Map<number, number>();
  private readonly shotCooldown = new Map<number, number>();

  constructor(
    private readonly ctx: RefContext,
    readonly rules: RefereeRules,
  ) {}

  /** A fresh match: forget all tracked violations. */
  reset(): void {
    this.contacts.reset();
    for (const m of [this.tilt, this.tips, this.pushing, this.blockades, this.flights, this.ejections, this.shotCooldown] as Map<unknown, unknown>[]) m.clear();
    this.pushCalled.clear();
  }

  // ─────────────────────────────── calls ───────────────────────────────

  /** Assess a foul (and card) against `c.robot`, credit the opponent, and tell everyone. */
  call(c: Call): FoulRecord {
    const { score, toast, clock } = this.ctx;
    let card = c.card;
    // A second yellow card is a red card.
    if (card === 'yellow' && score.cardsFor(c.robot.id, 'yellow') >= 1) card = 'red';
    const rec: FoulRecord = { t: clock.elapsed, alliance: c.robot.alliance, kind: c.kind, rule: c.rule, robotId: c.robot.id, note: c.note, ...(card ? { card } : {}) };
    score.foul(rec);
    const pts = score.foulValues[c.kind];
    const second = c.card === 'yellow' && card === 'red' ? ' (2nd yellow)' : '';
    toast(
      `${c.rule} ${this.rules.labels?.[c.kind] ?? (c.kind === 'major' ? 'MAJOR FOUL' : 'MINOR FOUL')}${card ? ` + ${card.toUpperCase()} CARD${second}` : ''} · ${c.robot.config.teamNumber} ${c.note} · +${pts} ${opponent(c.robot.alliance).toUpperCase()}`,
      'foul',
      c.robot.alliance,
    );
    return rec;
  }

  // ─────────────────────────────── per step ───────────────────────────────

  /** Call once per physics step, after stepping. */
  update(dt: number): void {
    const { clock, robots, physics } = this.ctx;
    const now = clock.elapsed;
    this.contacts.update(robots, physics, now);
    if (!clock.started || clock.finished || clock.mode === 'disabled') {
      this.flights.clear();
      return;
    }
    this.updateTips(dt, now);
    this.updateShots(dt, now);
  }

  /** Contact between two opposing robots, directly or transitively through a SCORING ELEMENT both are touching. */
  touching(a: Robot, b: Robot): boolean {
    return this.contacts.isTouching(a, b) || this.viaPiece(a, b);
  }

  private viaPiece(a: Robot, b: Robot): boolean {
    const { pool, physics } = this.ctx;
    const pa = a.pose, pb = b.pose;
    const reach = (r: Robot) => Math.hypot(r.footprint.length, r.footprint.width) / 2 + 0.3;
    if (Math.hypot(pa.x - pb.x, pa.y - pb.y) > reach(a) + reach(b)) return false;
    const near = (r: Robot, p: { x: number; y: number; z: number }) => {
      const l = r.toLocal(p);
      const pad = pool.radius + 0.06;
      return Math.abs(l.f) <= r.footprint.length / 2 + pad && Math.abs(l.l) <= r.footprint.width / 2 + pad && l.h <= r.config.height + pad;
    };
    const touches = (i: number, r: Robot) => {
      return bodiesTouching(physics.world, pool.bodies[i], r.body);
    };
    for (let i = 0; i < pool.count; i++) {
      if (pool.state[i] !== 'field') continue;
      const p = pool.position(i);
      if (near(a, p) && near(b, p) && touches(i, a) && touches(i, b)) return true;
    }
    return false;
  }

  // ─────────────────────────────── "don't tip or entangle" ───────────────────────────────

  private updateTips(dt: number, now: number): void {
    const { robots } = this.ctx;
    for (const v of robots) {
      const s = this.tilt.get(v.id) ?? { since: null, tipped: false };
      this.tilt.set(v.id, s);
      const tipped = v.tippedOver;
      const tilted = !tipped && !v.isClimbing && v.uprightness < TIP_STARTS;
      if (tilted && s.since === null) s.since = now;
      else if (!tilted && !tipped) s.since = null;
      if (tipped && !s.tipped) this.onTipped(v, s.since, now);
      s.tipped = tipped;

      // Pushing a robot that is lying on its side: CONTINUOUS.
      for (const a of robots) {
        if (a.alliance === v.alliance) continue;
        const k = `${a.id}>${v.id}`;
        const p = a.pose, q = v.pose;
        const d = Math.hypot(q.x - p.x, q.y - p.y) || 1;
        const toward = drivingToward(a, q.x - p.x, q.y - p.y, d);
        if (tipped && a.enabled && this.contacts.isTouching(a, v) && toward > 0.3) {
          const t = (this.pushing.get(k) ?? 0) + dt;
          this.pushing.set(k, t);
          if (t >= TIP_CONTINUOUS && !this.pushCalled.has(k)) {
            this.pushCalled.add(k);
            this.call({ rule: this.rules.tip, kind: 'major', card: 'red', robot: a, note: `kept driving into ${v.config.teamNumber} while it lay on its side` });
          }
        } else if (!tipped) {
          this.pushing.delete(k);
          this.pushCalled.delete(k);
        }
      }
    }
  }

  private onTipped(v: Robot, tiltSince: number | null, now: number): void {
    // Who was on it when it went over?
    let cause: Robot | null = null, best = -Infinity;
    for (const a of this.ctx.robots) {
      if (a.alliance === v.alliance || !a.enabled || this.contacts.since(a, v, now) > TIP_CAUSE_WINDOW) continue;
      const p = a.pose, q = v.pose, d = Math.hypot(q.x - p.x, q.y - p.y) || 1;
      const toward = drivingToward(a, q.x - p.x, q.y - p.y, d);
      if (toward > best) { best = toward; cause = a; }
    }
    if (!cause) return;
    const k = `${cause.id}>${v.id}`;
    const before = this.tips.get(k) ?? 0;
    this.tips.set(k, before + 1);
    // "Contacting the ROBOT after it starts to tip, if that contact could have been avoided": the attacker was still
    // driving into it (it was touching it a moment ago) while it was leaning over. A single bumper-to-bumper hit that tips a robot is not a call.
    const kept = tiltSince !== null && now - tiltSince >= 0.1 && best > 0.3;
    if (kept) this.call({ rule: this.rules.tip, kind: 'major', card: 'yellow', robot: cause, note: `kept driving into ${v.config.teamNumber} after it started to tip` });
    else if (before >= 1) this.call({ rule: this.rules.tip, kind: 'major', card: 'yellow', robot: cause, note: `tipped ${v.config.teamNumber} over again` });
  }

  // ─────────────────────────────── "don't collude" ───────────────────────────────

  /**
   * Call every step with the partners (2 or more) currently shutting down `id`, or none. The first MAJOR FOUL comes
   * after `BLOCKADE_COUNT` seconds and another for every further count in which it isn't corrected.
   */
  blockade(dt: number, id: string, culprits: Robot[], note: string): void {
    const { clock } = this.ctx;
    const live = clock.started && !clock.finished && clock.mode !== 'disabled';
    const s = this.blockades.get(id) ?? { time: 0, clear: 0 };
    this.blockades.set(id, s);
    if (live && culprits.length >= 2) {
      s.clear = 0;
      const old = s.time;
      s.time += dt;
      if (Math.floor(old / BLOCKADE_COUNT) < Math.floor(s.time / BLOCKADE_COUNT)) {
        this.call({ rule: this.rules.collusion, kind: 'major', robot: culprits[0], note: `and ${culprits[1].config.teamNumber} ${note}` });
      }
    } else if ((s.clear += dt) > 1) s.time = 0;
  }

  /**
   * Partners walling off `spot` (the opponent's TOWER, CAGES, STAGE ...) from `victims` who are trying to get there: 2+
   * of alliance `by`'s robots near it while an opposing climber that wants in is stuck short of it. Call every step.
   */
  blockAccess(dt: number, id: string, by: Alliance, spot: { x: number; y: number }, note: string, reach = { wall: 2.2, want: 3.5, min: 0.9 }): void {
    const { robots } = this.ctx;
    const near = (r: Robot, d: number) => Math.hypot(r.pose.x - spot.x, r.pose.y - spot.y) < d;
    const walls = robots.filter((r) => r.alliance === by && r.enabled && !r.isClimbing && near(r, reach.wall));
    const stuck = walls.length >= 2 && robots.some((o) => o.alliance !== by && o.enabled && o.climbPhase === 'none' && o.config.climber.maxLevel > 0
      && near(o, reach.want) && !near(o, reach.min) && (o.lastCommand.climb !== null || Math.hypot(o.lastCommand.vx, o.lastCommand.vy) > 0.3) && o.speed < 0.3
      && walls.some((w) => this.contacts.isTouching(w, o) || Math.hypot(w.pose.x - o.pose.x, w.pose.y - o.pose.y) < 1.6));
    this.blockade(dt, id, stuck ? walls : [], note);
  }

  // ─────────────────────────────── scoring elements ───────────────────────────────

  /**
   * A robot just launched piece `idx` (call from the season's `onLaunch`, after the piece has its velocity).
   * `target` is where the robot's shot or feed was meant to go (world); a piece that leaves heading somewhere else
   * and hits an opponent was launched AT it.
   */
  launched(robot: Robot, idx: number, target: { x: number; y: number; z: number } | null, aimless = false): void {
    const { pool } = this.ctx;
    const p = pool.position(idx), v = pool.velocity(idx);
    // A piece thrown with no goal in mind (`aimless`, e.g. a CORAL) is off-target by definition.
    let offTarget = aimless;
    if (target) {
      const speed = Math.hypot(v.x, v.z);
      const dist = Math.hypot(target.x - p.x, target.z - p.z);
      if (speed > 0.5 && dist > 0.5) {
        const cos = (v.x * (target.x - p.x) + v.z * (target.z - p.z)) / (speed * dist);
        offTarget = Math.acos(Math.max(-1, Math.min(1, cos))) > OFF_TARGET;
      }
    }
    if (!this.rules.launchAtRobot) return;
    this.flights.set(idx, { robot, t: this.ctx.clock.elapsed, offTarget, hit: false });
  }

  private updateShots(_dt: number, now: number): void {
    const { pool, robots } = this.ctx;
    for (const [idx, f] of this.flights) {
      const age = now - f.t;
      if (age > SHOT_MEMORY || pool.state[idx] === 'held') { this.flights.delete(idx); continue; }
      if (!f.offTarget || f.hit || age > SHOT_WATCH || pool.state[idx] !== 'field') continue;
      const p = pool.position(idx);
      for (const o of robots) {
        if (o.alliance === f.robot.alliance || o.isClimbing) continue;
        const l = o.toLocal(p), pad = pool.radius + 0.03;
        if (Math.abs(l.f) > o.footprint.length / 2 + pad || Math.abs(l.l) > o.footprint.width / 2 + pad || l.h > o.config.height + pad) continue;
        f.hit = true;
        if ((this.shotCooldown.get(f.robot.id) ?? -Infinity) > now) break;
        this.shotCooldown.set(f.robot.id, now + 3);
        this.call({ rule: this.rules.launchAtRobot!, kind: 'major', robot: f.robot, note: `launched at ${o.config.teamNumber}` });
        break;
      }
    }
  }

  /**
   * Piece `idx` has left the FIELD (anywhere the manual doesn't allow). If a robot launched it, that is the robot
   * "ejecting" it. Intent is a judgement call, so one errant shot is let go; a robot that keeps doing it gets a
   * MINOR FOUL, then a MAJOR FOUL for every time after ("if REPEATED").
   */
  ejected(idx: number): void {
    const f = this.flights.get(idx);
    this.flights.delete(idx);
    const { clock } = this.ctx;
    if (!this.rules.eject || !f || !clock.started || clock.finished || clock.mode === 'disabled') return;
    const n = (this.ejections.get(f.robot.id) ?? 0) + 1;
    this.ejections.set(f.robot.id, n);
    if (n < 2) return;
    this.call({ rule: this.rules.eject!, kind: n === 2 ? 'minor' : 'major', robot: f.robot, note: n === 2 ? 'threw a game piece out of the FIELD' : `threw a game piece out of the FIELD again (${n})` });
  }

  /** Alliance of the opponent whose robots `r` would be touching. */
  static opposing(a: Alliance): Alliance {
    return opponent(a);
  }
}
