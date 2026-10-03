import * as THREE from 'three';
import { ALLIANCES, opponent, type Alliance, type FieldPoint } from '@engine/coords';
import type { MatchResults, SeasonContext, SeasonRules } from '@engine/core/season';
import type { PeriodChange } from '@engine/match/clock';
import { PIN_SEPARATION, PinTracker, reportPins } from '@engine/match/pinning';
import type { AimTarget, Robot, RobotCommand } from '@engine/robot/robot';
import { clamp, inch } from '@engine/units';
import { convexOverlap } from '@engine/zones';
import * as C from './constants';
import { noteMesh, type CrescendoFieldRefs } from './field';
import { ampPoints, crescendoResults, speakerPoints, stagePoints, type StageRobot } from './scoring';

const DEG = Math.PI / 180;

/** Rules state multiplayer clients need for the HUD and field lights (score/clock sync separately). */
export interface CrescendoNetState {
  bank: Record<Alliance, number>;
  amp: Record<Alliance, number>;
  coop: Record<Alliance, boolean>;
  spot: Record<Alliance, boolean[]>;
  trap: Record<Alliance, boolean[]>;
  high: Record<Alliance, number>;
  anim: Record<Alliance, number>;
  ens: Record<Alliance, boolean>;
}

interface Launch {
  robotId: number;
  alliance: Alliance;
  t: number;
}

/**
 * CRESCENDO runtime rules (manual sections 6.4–6.5 and 7.4). Physically simulated: SPEAKER shots through the
 * hood opening, passes, SOURCE drops, HIGH NOTE throws. Assisted (animation): AMP deposits, chain climbs, TRAP.
 */
export class CrescendoRules implements SeasonRules {
  readonly handlesIntake = true;
  /** AMP NOTES banked toward AMPLIFICATION (0–2) [M 6.5.3]. */
  bank: Record<Alliance, number> = { blue: 0, red: 0 };
  /** Match time the current AMPLIFICATION nominally ends (−Infinity = never amplified). */
  amplifiedUntil: Record<Alliance, number> = { blue: -Infinity, red: -Infinity };
  coopUsed: Record<Alliance, boolean> = { blue: false, red: false };
  spotlit: Record<Alliance, boolean[]> = { blue: [false, false, false], red: [false, false, false] };
  trapScored: Record<Alliance, boolean[]> = { blue: [false, false, false], red: [false, false, false] };
  highNotesLeft: Record<Alliance, number> = { blue: C.HIGH_NOTES_PER_ALLIANCE, red: C.HIGH_NOTES_PER_ALLIANCE };
  forcedEnsemble: Record<Alliance, boolean> = { blue: false, red: false };
  private ampAnim: Record<Alliance, number> = { blue: 0, red: 0 };
  private readonly left = new Set<number>();
  private readonly launches = new Map<number, Launch>();
  private readonly g414: Record<Alliance, number> = { blue: 0, red: 0 };
  private readonly contacts = new Set<string>();
  /** G420: 5-count on PINS. */
  private readonly pins = new PinTracker({ rule: 'G420', countSeconds: 5, separation: PIN_SEPARATION });
  private readonly notices = new Map<number, number>();
  private sourceTimer: Record<Alliance, number> = { blue: 0, red: 0 };
  private autoHpTimer: Record<Alliance, number> = { blue: 0, red: 0 };
  /** HIGH NOTE index → previous height (for MICROPHONE ring detection). */
  private readonly prevZ = new Map<number, number>();
  private leaveAssessed = false;
  private stageAssessed = false;
  private readonly heldVisuals = new Map<number, THREE.Mesh>();

  constructor(readonly ctx: SeasonContext, readonly refs: CrescendoFieldRefs) {
    for (const r of ctx.robots) {
      r.hideHopperFill();
      const m = noteMesh(false);
      m.rotation.x = Math.PI / 2;
      m.position.set(0, r.config.bumperTop + C.NOTE_THICKNESS, 0);
      m.visible = false;
      // Real-team models carry the NOTE inside their shooter (it tilts and lifts with it).
      const anchor = r.modelHeldAnchor;
      if (anchor) m.position.set(0, 0, 0);
      (anchor ?? r.visual).add(m);
      this.heldVisuals.set(r.id, m);
    }
  }

  // ─────────────────────────── helpers ───────────────────────────

  get now(): number {
    return this.ctx.clock.elapsed;
  }
  private get period(): string {
    const c = this.ctx.clock;
    return !c.started ? 'pre' : c.finished ? 'done' : c.current.id;
  }
  isAuto(): boolean {
    return this.period === 'auto' || this.period === 'auto-pause';
  }
  isTeleop(): boolean {
    return this.period === 'teleop' || this.period === 'endgame';
  }
  isEndgame(): boolean {
    return this.period === 'endgame';
  }
  /** Seconds into TELEOP (Infinity outside TELEOP). */
  teleopElapsed(): number {
    const c = this.ctx.clock;
    if (this.period === 'teleop') return c.elapsedInPeriod;
    if (this.period === 'endgame') return C.TELEOP_SECONDS - C.ENDGAME_SECONDS + c.elapsedInPeriod;
    return Infinity;
  }
  coopWindowOpen(): boolean {
    return this.teleopElapsed() < C.COOP_WINDOW;
  }
  amplified(a: Alliance): boolean {
    return this.now < this.amplifiedUntil[a];
  }
  amplifyRemaining(a: Alliance): number {
    return Math.max(0, this.amplifiedUntil[a] - this.now);
  }
  coopBonus(): boolean {
    return this.coopUsed.blue && this.coopUsed.red;
  }
  /** NOTES may still be counted by the SPEAKER sensors (3 s after 0:00 of AUTO / TELEOP) [M 6.5 A/B]. */
  private speakerCounting(): boolean {
    const p = this.period;
    if (p === 'auto' || p === 'auto-pause' || p === 'teleop' || p === 'endgame') return true;
    return p === 'post' && this.ctx.clock.elapsedInPeriod <= C.SPEAKER_GRACE;
  }
  private tell(robot: Robot, msg: string): void {
    if (this.now < (this.notices.get(robot.id) ?? -1)) return;
    this.notices.set(robot.id, this.now + 1.8);
    this.ctx.toast(msg, 'info', robot.alliance, robot);
  }
  heldNote(robot: Robot): number | undefined {
    return robot.held.find((i) => !C.isHighNote(i));
  }
  private overlaps(robot: Robot, poly: FieldPoint[]): boolean {
    return convexOverlap(robot.corners(), poly);
  }
  inStageZone(robot: Robot, a: Alliance = robot.alliance): boolean {
    return this.overlaps(robot, C.stageZone(a));
  }
  inWing(robot: Robot, a: Alliance, completely = false): boolean {
    const x = robot.corners().map((p) => C.fromWall(a, p.x));
    return completely ? Math.max(...x) <= C.WING_DEPTH : Math.min(...x) <= C.WING_DEPTH;
  }
  nearAmp(robot: Robot): boolean {
    const amp = C.ampCenter(robot.alliance);
    const p = robot.pose;
    return Math.abs(p.x - amp.x) < C.AMP_POCKET_WIDTH / 2 + 0.45 && C.W - p.y < Math.max(robot.footprint.length, robot.footprint.width) / 2 + 0.35;
  }

  // ─────────────────────────── setup ───────────────────────────

  stage(): void {
    const { pool, robots } = this.ctx;
    this.bank = { blue: 0, red: 0 };
    this.amplifiedUntil = { blue: -Infinity, red: -Infinity };
    this.coopUsed = { blue: false, red: false };
    this.spotlit = { blue: [false, false, false], red: [false, false, false] };
    this.trapScored = { blue: [false, false, false], red: [false, false, false] };
    this.highNotesLeft = { blue: C.HIGH_NOTES_PER_ALLIANCE, red: C.HIGH_NOTES_PER_ALLIANCE };
    this.forcedEnsemble = { blue: false, red: false };
    this.ampAnim = { blue: 0, red: 0 };
    this.left.clear(); this.launches.clear(); this.contacts.clear(); this.pins.reset(); this.prevZ.clear();
    this.g414.blue = this.g414.red = 0;
    this.leaveAssessed = this.stageAssessed = false;
    for (let i = 0; i < pool.count; i++) pool.reserve(i);
    for (const r of robots) r.held.length = 0;
    // [M 6.3.4]: 6 WING + 5 CENTER LINE NOTES on SPIKE MARKS.
    const spots = [...C.wingSpikes('blue'), ...C.wingSpikes('red'), ...C.centerSpikes()];
    spots.forEach((p, i) => pool.placeField(i, p.x, p.y));
    // 45 NOTES per SOURCE AREA + each robot's preload; unused preloads join the SOURCE supply.
    for (const [k, a] of (['blue', 'red'] as const).entries()) {
      const base = C.FIELD_NOTES + k * (C.SOURCE_NOTES_PER_ALLIANCE + C.PRELOADS_PER_ALLIANCE);
      let i = base;
      for (const r of robots.filter((x) => x.alliance === a)) {
        if (r.config.preload > 0 && i < base + C.PRELOADS_PER_ALLIANCE) {
          pool.hold(i, r.id);
          r.held.push(i++);
        }
      }
      for (; i < base + C.SOURCE_NOTES_PER_ALLIANCE + C.PRELOADS_PER_ALLIANCE; i++) pool.reserve(i, `source:${a}`);
      for (let h = 0; h < C.HIGH_NOTES_PER_ALLIANCE; h++) pool.reserve(C.HIGH_NOTE_START + k * C.HIGH_NOTES_PER_ALLIANCE + h, `high:${a}`);
    }
  }

  // ─────────────────────────── robot mechanisms ───────────────────────────

  handleMechanisms(robot: Robot, cmd: RobotCommand, _dt: number): boolean {
    if (cmd.intake && robot.config.intake.enabled && !robot.isClimbing) this.intake(robot);
    if (robot.isClimbing) {
      if (cmd.shoot) this.scoreTrap(robot);
      return true;
    }
    const note = this.heldNote(robot);
    if (cmd.pass && !cmd.shoot && note !== undefined && this.nearAmp(robot)) {
      if (robot.config.options?.amp === false) this.tell(robot, 'This robot has no AMP mechanism');
      else if (robot.fireCooldown <= 0) this.scoreAmp(robot, note);
      return true;
    }
    return false;
  }

  private intake(robot: Robot): void {
    const { pool } = this.ctx;
    for (let i = 0; i < C.NOTE_COUNT && robot.capacityLeft > 0; i++) {
      if (pool.state[i] !== 'field') continue;
      const launched = this.launches.get(i);
      if (launched?.robotId === robot.id && this.now - launched.t < 0.6) continue;
      const p = pool.position(i);
      // Ground intake: NOTES on the carpet. SOURCE intake: NOTES falling out of the CHUTE in front of the robot.
      const ground = p.y <= 0.2 && robot.intakeContains(p, C.NOTE_OUTER_RADIUS * 0.6);
      if (ground || robot.stationContains(p, C.NOTE_OUTER_RADIUS * 0.6)) {
        pool.hold(i, robot.id);
        robot.held.push(i);
      }
    }
  }

  /** Assisted AMP deposit: a robot at its AMP presses G; the NOTE goes through the pocket's sensor [M 6.5.1]. */
  scoreAmp(robot: Robot, i: number): void {
    const a = robot.alliance;
    const { pool, score } = this.ctx;
    if (!this.isAuto() && !this.isTeleop()) return;
    robot.held.splice(robot.held.indexOf(i), 1);
    pool.reserve(i, `amp:${a}`);
    const auto = this.isAuto();
    score.add(a, auto ? 'autoAmp' : 'amp', ampPoints(auto), this.now, robot.id);
    score.tally(robot.id, 'scored');
    score.inc(a, 'notes');
    score.inc(a, 'ampNotes');
    // NOTES delivered during AMPLIFICATION earn points but don't count toward the next one [M 6.5.3].
    if (!this.amplified(a)) this.bank[a] = Math.min(2, this.bank[a] + 1);
    robot.fireCooldown = 0.45;
    this.ampAnim[a] = 0.45;
    this.ctx.toast(`AMP +${ampPoints(auto)}${this.bank[a] >= 2 && !this.amplified(a) ? ' · AMPLIFY ready (B)' : ''}`, 'good', a, robot);
  }

  /** Assisted TRAP deposit while ONSTAGE on the chain below it [M 6.5.1]. */
  private scoreTrap(robot: Robot): void {
    const a = robot.alliance;
    const c = robot.climbSlot;
    const note = this.heldNote(robot);
    if (robot.climbPhase !== 'hanging' || c === null || robot.fireCooldown > 0) return;
    if (robot.config.climber.maxLevel < 2) return this.tell(robot, 'No TRAP mechanism on this robot (Climber: Chain + TRAP)');
    if (note === undefined) return this.tell(robot, 'No NOTE to place in the TRAP');
    if (this.trapScored[a][c]) return this.tell(robot, 'This TRAP already holds a NOTE (max. 1 per TRAP)');
    robot.held.splice(robot.held.indexOf(note), 1);
    this.ctx.pool.reserve(note, `trap:${a}:${c}`);
    this.trapScored[a][c] = true;
    this.ctx.score.add(a, 'trap', C.POINTS.trap, this.now, robot.id);
    this.ctx.score.tally(robot.id, 'scored');
    robot.fireCooldown = 0.8;
    this.ctx.toast(`TRAP +${C.POINTS.trap} · ${C.chainLabel(a, c)}`, 'good', a);
  }

  // ─────────────────────────── aiming ───────────────────────────

  /**
   * SPEAKER aim. The opening is the gap between the wall top (78 in) and the hood lip (82⅞ in, 18 in out):
   * a flat NOTE must pass UNDER the lip and OVER the wall top, so the solver gets ceilings along the approach and
   * accepts rising entries (a descending lob hits the hood).
   */
  aimTarget(robot: Robot): AimTarget | null {
    const a = robot.alliance;
    const p = robot.pose;
    const sp = C.speakerCenter(a);
    // Aim the flight line through the MIDDLE of the 18 in-deep opening so oblique shots clear both hood cheeks.
    const mid = C.SPEAKER_OPENING_DEPTH / 2;
    const perp = Math.max(mid + 0.3, C.fromWall(a, p.x));
    const lateral = p.y - sp.y;
    const cos = (perp - mid) / Math.hypot(perp - mid, lateral);
    const dTarget = inch(7);
    const t = (dTarget - mid) / (perp - mid);
    const tx = C.side(a, dTarget, 0).x, ty = sp.y + lateral * t;
    const half = C.NOTE_THICKNESS / 2;
    const under = C.SPEAKER_OPENING_TOP - half - inch(0.3);
    return {
      point: this.ctx.frame.toWorld(tx, ty, inch(80.2)),
      allowRising: true,
      minEntryAngle: -3 * DEG,
      ceilings: [11, 18, 25].map((d) => ({ distance: inch(d - 7) / cos, height: under })),
    };
  }

  /**
   * Feed/pass (G away from the AMP): lob into our WING in front of the SPEAKER — or, with any bumper in the
   * opponent's WING, into the NEUTRAL ZONE short of our WING line (G414 forbids full-court passes).
   */
  passTarget(robot: Robot): AimTarget | null {
    const a = robot.alliance;
    const p = robot.pose;
    const inOpp = this.inWing(robot, opponent(a));
    const x = inOpp ? C.WING_DEPTH + 1.3 : 2.4;
    const y = inOpp ? clamp(p.y, 1.2, C.W - 1.2) : C.W / 2 + 1.75;
    const t = C.side(a, x, y);
    const target: AimTarget = { point: this.ctx.frame.toWorld(t.x, t.y, C.NOTE_THICKNESS / 2 + 0.01) };
    // Arc over a STAGE that lies between us and the landing spot.
    const clearances: { distance: number; height: number }[] = [];
    for (const s of ALLIANCES) {
      const c = C.stageCenter(s);
      const d = Math.hypot(t.x - p.x, t.y - p.y);
      const u = ((c.x - p.x) * (t.x - p.x) + (c.y - p.y) * (t.y - p.y)) / (d * d);
      const off = Math.abs((c.x - p.x) * (t.y - p.y) - (c.y - p.y) * (t.x - p.x)) / d;
      if (u > 0 && u < 1 && off < C.STAGE_LEG_RADIUS + 0.4) {
        for (const k of [-1, 0, 1]) clearances.push({ distance: d * (1 - u) + k * C.STAGE_LEG_RADIUS, height: C.STAGE_TRUSS_TOP + 0.35 });
      }
    }
    if (clearances.length) target.clearances = clearances.filter((q) => q.distance > 0.2);
    return target;
  }

  onLaunch(robot: Robot, i: number): void {
    const a = robot.alliance;
    this.launches.set(i, { robotId: robot.id, alliance: a, t: this.now });
    this.ctx.score.tally(robot.id, 'shots');
    const shot = robot.lastCommand.shoot;
    // G404: in AUTO, a robot completely outside its WING may not send NOTES into it (TECH FOUL).
    if (this.ctx.clock.mode === 'auto' && !this.inWing(robot, a)) this.foul(robot, 'major', 'G404', 'AUTO shot from outside your WING');
    // G414: no full-court shots — any bumper in the opponent's WING while sending a NOTE into our WING.
    if (shot && this.ctx.clock.mode === 'teleop' && this.inWing(robot, opponent(a))) {
      this.foul(robot, this.g414[a]++ === 0 ? 'minor' : 'major', 'G414', 'full-court shot from the opponent WING');
    }
  }

  private foul(robot: Robot, kind: 'minor' | 'major', rule: string, why: string, times = 1): void {
    for (let k = 0; k < times; k++) this.ctx.score.foul({ t: this.now, alliance: robot.alliance, kind, rule, robotId: robot.id });
    const pts = C.FOULS[kind] * times;
    this.ctx.toast(`${rule} ${kind === 'major' ? 'TECH FOUL' : 'FOUL'}${times > 1 ? ` ×${times}` : ''} · ${why} · +${pts} ${opponent(robot.alliance).toUpperCase()}`, 'foul', robot.alliance);
  }

  // ─────────────────────────── human players ───────────────────────────

  /**
   * Human player buttons: 1 (H) = SOURCE human player drops a NOTE down the CHUTE toward your robot,
   * 2 (B) = AMP button (AMPLIFY with 2 banked NOTES), 3 (N) = Coopertition button,
   * 4 (M) = throw a HIGH NOTE at a MICROPHONE (last 20 s only, G430).
   */
  humanPlayerAction(a: Alliance, button = 1): void {
    if (button === 1) this.dropNote(a, true);
    else if (button === 3) this.pressCoop(a, true);
    else if (button === 4) this.throwHighNote(a, true);
    else this.pressAmplify(a, true);
  }

  pressAmplify(a: Alliance, verbose = false): boolean {
    const say = (m: string, k: 'info' | 'good' = 'info') => verbose && this.ctx.toast(m, k, a);
    if (!this.isTeleop()) return say('AMP button works in TELEOP'), false;
    if (this.amplified(a)) return say('SPEAKER already AMPLIFIED'), false;
    if (this.bank[a] < 2) return say(`AMPLIFY needs 2 AMP NOTES (${this.bank[a]}/2)`), false;
    this.bank[a] = 0;
    this.amplifiedUntil[a] = this.now + C.AMPLIFY_SECONDS;
    this.ctx.toast(`${a.toUpperCase()} SPEAKER AMPLIFIED · 10 s · 5 pts per NOTE`, 'good', a);
    return true;
  }

  pressCoop(a: Alliance, verbose = false): boolean {
    const say = (m: string) => verbose && this.ctx.toast(m, 'info', a);
    if (this.coopUsed[a]) return say('Coopertition NOTE already used'), false;
    if (!this.coopWindowOpen()) return say('Coopertition only in the first 45 s of TELEOP'), false;
    if (this.bank[a] < 1) return say('Coopertition needs a NOTE banked in the AMP'), false;
    this.bank[a]--;
    this.coopUsed[a] = true;
    this.ctx.toast(`${a.toUpperCase()} pressed Coopertition${this.coopBonus() ? ' · BONUS earned — MELODY needs 15' : ''}`, 'good', a);
    return true;
  }

  /** Chain whose MICROPHONE a HIGH NOTE should target: most own robots on it, else CENTER STAGE. */
  private spotlightTarget(a: Alliance): number | null {
    const counts = [0, 1, 2].map((c) => this.ctx.robots.filter((r) => r.alliance === a && r.isClimbing && r.climbSlot === c).length);
    const free = [0, 1, 2].filter((c) => !this.spotlit[a][c]);
    if (!free.length) return null;
    return free.sort((x, y) => counts[y] - counts[x] || x - y)[0];
  }

  throwHighNote(a: Alliance, verbose = false): boolean {
    const say = (m: string) => verbose && this.ctx.toast(m, 'info', a);
    if (!this.isEndgame()) return say('HIGH NOTES may only be thrown in the last 20 s (G430)'), false;
    const idx = this.ctx.pool.indices('reserve', `high:${a}`)[0];
    if (idx === undefined) return say('No HIGH NOTES left'), false;
    const c = this.spotlightTarget(a);
    if (c === null) return say('Every MICROPHONE is already SPOTLIT'), false;
    const mic = C.micPoint(a, c);
    // Thrown by the AMP-side HUMAN PLAYER from in front of the COACH LINE, over the ALLIANCE WALL.
    const from = C.side(a, -0.3, C.W - 0.45);
    const flight = 1.25;
    const aim = { x: mic.x + this.ctx.rng.gauss(0, 0.075), y: mic.y + this.ctx.rng.gauss(0, 0.075), z: mic.z + 0.12 };
    const p0 = this.ctx.frame.toWorld(from.x, from.y, 2.1);
    const p1 = this.ctx.frame.toWorld(aim.x, aim.y, aim.z);
    const g = 9.81;
    const v = new THREE.Vector3((p1.x - p0.x) / flight, (p1.y - p0.y + 0.5 * g * flight * flight) / flight, (p1.z - p0.z) / flight);
    this.ctx.pool.placeWorld(idx, p0, v);
    this.prevZ.set(idx, p0.y);
    this.highNotesLeft[a]--;
    this.ctx.toast(`${a.toUpperCase()} HUMAN PLAYER throws a HIGH NOTE at the ${C.chainLabel(a, c)} MICROPHONE`, 'info', a);
    return true;
  }

  /** A NOTE still sliding down / sitting in front of this alliance's SOURCE. */
  private noteAtSource(a: Alliance): boolean {
    const { pool, frame } = this.ctx;
    const mid = C.sourcePoint(a, 0.5, 0);
    return pool.indices('field').some((i) => {
      const q = frame.toField(pool.position(i));
      return Math.hypot(q.x - mid.x, q.y - mid.y) < 1.4;
    });
  }

  /** The alliance robot the SOURCE human player feeds: the one nearest the SOURCE (player's robot first). */
  private sourceRobot(a: Alliance, maxDist = Infinity): Robot | undefined {
    const mid = C.sourcePoint(a, 0.5, 0);
    const d = (r: Robot) => Math.hypot(r.pose.x - mid.x, r.pose.y - mid.y);
    return this.ctx.robots.filter((r) => r.alliance === a && !r.isClimbing && d(r) < maxDist).sort((x, y) => d(x) - d(y))[0];
  }

  /**
   * SOURCE human player [M 5.4]: put a NOTE into the top of the 50° CHUTE, on the part of the 75¼ in opening nearest
   * the robot. It slides down and out of the opening; physics decides whether a SOURCE intake catches it or it
   * lands on the carpet. A manual press (`stack`) releases another NOTE even while earlier ones are still in the
   * CHUTE or in front of it, sliding along the opening to a free spot; the automatic human player waits for a clear
   * CHUTE.
   */
  dropNote(a: Alliance, verbose = false, robot = this.sourceRobot(a), stack = verbose): boolean {
    const say = (m: string) => verbose && this.ctx.toast(m, 'info', a);
    if (!this.isTeleop()) return say('SOURCE human players feed NOTES in TELEOP'), false;
    if (!stack && this.noteAtSource(a)) return false;
    const { pool, frame } = this.ctx;
    const idx = pool.indices('reserve', `source:${a}`)[0];
    if (idx === undefined) return say('The SOURCE is empty'), false;
    let t0 = 0.5;
    if (robot) {
      let bestD = Infinity;
      for (let k = 0.05; k <= 0.95; k += 0.025) {
        const q = C.sourcePoint(a, k, 0);
        const dd = Math.hypot(q.x - robot.pose.x, q.y - robot.pose.y);
        if (dd < bestD) { bestD = dd; t0 = k; }
      }
    }
    const span = (C.SOURCE_OPENING_WIDTH / 2 - C.NOTE_OUTER_RADIUS - inch(1)) / C.SOURCE_WALL_LENGTH;
    const spawnAt = (k: number) => C.chutePoint(a, clamp(k, 0.5 - span, 0.5 + span), C.CHUTE_LENGTH - C.NOTE_OUTER_RADIUS + inch(2));
    // Preferred spot first, then alternate sides of it, until one isn't occupied by a NOTE already released.
    const others = pool.indices('field').map((i) => frame.toField(pool.position(i)));
    const clear = (k: number) => {
      const q = spawnAt(k);
      return !others.some((o) => Math.hypot(o.x - q.x, o.y - q.y, o.z - q.z) < C.NOTE_OUTER_RADIUS * 2 + 0.03);
    };
    const step = (C.NOTE_OUTER_RADIUS * 2 + 0.05) / C.SOURCE_WALL_LENGTH;
    let t: number | undefined;
    for (let j = 0; j <= 2 * Math.ceil(span / step) && t === undefined; j++) {
      const k = clamp(t0 + (j % 2 ? 1 : -1) * Math.ceil(j / 2) * step, 0.5 - span, 0.5 + span);
      if (clear(k)) t = k;
    }
    if (t === undefined) return say('The top of the CHUTE is jammed with NOTES'), false;
    const n = C.sideYaw(C.sourceEnd(a), Math.atan2(C.SOURCE_NORMAL.y, C.SOURCE_NORMAL.x));
    const nrm = { x: Math.cos(n) * Math.sin(C.CHUTE_ANGLE), y: Math.sin(n) * Math.sin(C.CHUTE_ANGLE), z: Math.cos(C.CHUTE_ANGLE) };
    const q = spawnAt(t);
    const lift = C.NOTE_THICKNESS / 2 + 0.006;
    const down = 0.4; // released with a small push down the slope
    const dv = { x: Math.cos(n) * Math.cos(C.CHUTE_ANGLE) * down, y: Math.sin(n) * Math.cos(C.CHUTE_ANGLE) * down, z: -Math.sin(C.CHUTE_ANGLE) * down };
    pool.placeWorld(idx, frame.toWorld(q.x + nrm.x * lift, q.y + nrm.y * lift, q.z + nrm.z * lift), frame.velToWorld(dv.x, dv.y, dv.z));
    // Lay the NOTE flat on the CHUTE floor (its axis along the slope normal).
    const axis = frame.velToWorld(nrm.x, nrm.y, nrm.z).normalize();
    const rot = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis);
    pool.bodies[idx].setRotation({ x: rot.x, y: rot.y, z: rot.z, w: rot.w }, true);
    this.sourceTimer[a] = 1.2;
    return true;
  }

  /** Automatic SOURCE human player: feeds a robot of ours waiting near the SOURCE without a NOTE. */
  private feedSource(a: Alliance, dt: number): void {
    this.sourceTimer[a] -= dt;
    if (this.sourceTimer[a] > 0 || !this.isTeleop() || !this.ctx.humanPlayerIsAuto(a)) return;
    const robot = this.sourceRobot(a, 2.2);
    if (!robot || robot.capacityLeft <= 0) return;
    this.dropNote(a, false, robot);
  }

  /** Automatic AMP human player: Coopertition early, HIGH NOTES in END GAME. AMPLIFY is never automatic: press B. */
  private autoAmpHuman(a: Alliance, dt: number): void {
    // An alliance with no robots on the field (single player) has nothing for its human player to do.
    if (!this.ctx.humanPlayerIsAuto(a) || !this.isTeleop() || !this.ctx.robots.some((r) => r.alliance === a)) return;
    const oppHasRobots = this.ctx.robots.some((r) => r.alliance === opponent(a));
    if (oppHasRobots && !this.coopUsed[a] && this.coopWindowOpen() && this.bank[a] >= 1) this.pressCoop(a);
    this.autoHpTimer[a] -= dt;
    const endgameT = this.teleopElapsed() - (C.TELEOP_SECONDS - C.ENDGAME_SECONDS);
    if (this.isEndgame() && endgameT > 4 && this.autoHpTimer[a] <= 0 && this.highNotesLeft[a] > 0) {
      this.throwHighNote(a);
      this.autoHpTimer[a] = 3.5;
    }
  }

  // ─────────────────────────── STAGE ───────────────────────────

  /** Chain the robot is under (inside its STAGE ZONE, close to the chain line), or null. */
  chainFor(robot: Robot): { chain: number; along: number; dist: number } | null {
    const a = robot.alliance;
    const p = robot.pose;
    let best: { chain: number; along: number; dist: number } | null = null;
    for (let c = 0; c < 3; c++) {
      const g = C.chainGeometry(a, c);
      const dx = p.x - g.mid.x, dy = p.y - g.mid.y;
      const dist = dx * Math.cos(g.normal) + dy * Math.sin(g.normal);
      const along = dx * Math.cos(g.dir) + dy * Math.sin(g.dir);
      if (dist < -0.45 || dist > 0.8 || Math.abs(along) > g.span / 2 - C.STAGE_LEG_SIZE / 2) continue;
      if (!best || Math.abs(dist) < Math.abs(best.dist)) best = { chain: c, along, dist };
    }
    return best;
  }

  requestClimb(robot: Robot, _level: number): void {
    if (!this.isTeleop()) return this.tell(robot, 'Chains can be climbed in TELEOP');
    const hit = this.chainFor(robot);
    if (!hit) return this.tell(robot, 'Drive under one of your STAGE chains (inside your STAGE ZONE) to climb');
    const a = robot.alliance;
    const g = C.chainGeometry(a, hit.chain);
    const half = robot.footprint.width / 2;
    const room = g.span / 2 - C.STAGE_LEG_SIZE / 2 - half - inch(1);
    if (room < 0) return this.tell(robot, 'Robot too wide to hang between the STAGE legs');
    // Find a free spot along the chain near the robot (other robots on this chain keep their spots).
    const others = this.ctx.robots.filter((r) => r !== robot && r.isClimbing && r.alliance === a && r.climbSlot === hit.chain);
    const alongOf = (r: Robot) => (r.pose.x - g.mid.x) * Math.cos(g.dir) + (r.pose.y - g.mid.y) * Math.sin(g.dir);
    const free = (s: number) => others.every((o) => Math.abs(alongOf(o) - s) >= half + o.footprint.width / 2 + inch(1));
    let along: number | null = null;
    for (let k = 0; k <= 40 && along === null; k++) {
      for (const sgn of [1, -1]) {
        const s = clamp(hit.along + sgn * k * 0.05, -room, room);
        if (free(s)) { along = s; break; }
      }
    }
    if (along === null) return this.tell(robot, 'No room left on this chain');
    const hang = { x: g.mid.x + Math.cos(g.dir) * along + Math.cos(g.normal) * 0.05, y: g.mid.y + Math.sin(g.dir) * along + Math.sin(g.normal) * 0.05 };
    // Face the core so a TRAP mechanism reaches the TRAP above the robot.
    robot.startClimb({ ...hang, yaw: g.normal + Math.PI }, 0.3, 1, hit.chain);
  }

  requestDescend(robot: Robot): void {
    robot.startDescend();
  }

  /** ONSTAGE: hanging from a chain, off the carpet [M 6.5.2]. */
  onstageChain(robot: Robot): number | null {
    return robot.climbPhase === 'hanging' && robot.elevation > 0.05 && robot.climbSlot !== null ? robot.climbSlot : null;
  }

  private assessStage(): void {
    if (this.stageAssessed) return;
    this.stageAssessed = true;
    for (const a of ALLIANCES) {
      const robots: StageRobot[] = this.ctx.robots.filter((r) => r.alliance === a).map((r) => ({ chain: this.onstageChain(r), inStageZone: this.inStageZone(r) }));
      const traps = this.trapScored[a].filter(Boolean).length;
      const pts = stagePoints(robots, this.spotlit[a], traps);
      this.creditStage(a, robots);
      this.ctx.score.set(a, 'park', pts.park);
      this.ctx.score.set(a, 'onstage', pts.onstage);
      this.ctx.score.set(a, 'harmony', pts.harmony);
      this.ctx.score.counters[a].onstage = pts.onstageCount;
    }
  }

  /** Credit each robot with its own PARK / ONSTAGE / HARMONY points (mirrors `stagePoints`). */
  private creditStage(a: Alliance, stage: StageRobot[]): void {
    const { score, robots } = this.ctx;
    const mine = robots.filter((r) => r.alliance === a);
    const seen = [0, 0, 0];
    mine.forEach((r, k) => {
      const s = stage[k];
      let park = 0, onstage = 0, harmony = 0;
      if (s.chain !== null) {
        onstage = this.spotlit[a][s.chain] ? C.POINTS.onstageSpotlit : C.POINTS.onstage;
        if (seen[s.chain]++ > 0) harmony = C.POINTS.harmony;
      } else if (s.inStageZone) park = C.POINTS.park;
      score.setCredit(r.id, 'park', park);
      score.setCredit(r.id, 'onstage', onstage);
      score.setCredit(r.id, 'harmony', harmony);
    });
  }

  // ─────────────────────────── period changes / per step ───────────────────────────

  onPeriodChange(change: PeriodChange): void {
    if (change.from?.id === 'auto') this.assessLeave();
    if (!change.to) this.assessStage();
  }

  private assessLeave(): void {
    if (this.leaveAssessed) return;
    this.leaveAssessed = true;
    for (const r of this.ctx.robots) {
      if (!this.left.has(r.id)) continue;
      this.ctx.score.add(r.alliance, 'leave', C.POINTS.leave, this.now, r.id);
      this.ctx.score.inc(r.alliance, 'leave');
    }
  }

  beforeStep(dt: number): void {
    const c = this.ctx.clock;
    if (!c.started || c.finished) return;
    for (const a of ALLIANCES) {
      this.feedSource(a, dt);
      this.autoAmpHuman(a, dt);
      this.ampAnim[a] = Math.max(0, this.ampAnim[a] - dt);
    }
  }

  afterStep(dt: number): void {
    // Sensors always run (pieces entering goals are removed even outside a match); points need the match.
    const { pool, frame, score } = this.ctx;
    // LEAVE: BUMPERS completely clear of the ROBOT STARTING ZONE at any point in AUTO.
    if (this.period === 'auto') {
      for (const r of this.ctx.robots) if (!this.left.has(r.id) && !this.overlaps(r, C.startZone(r.alliance))) this.left.add(r.id);
    }
    for (let i = 0; i < pool.count; i++) {
      if (pool.state[i] !== 'field') continue;
      const p = frame.toField(pool.position(i));
      if (C.isHighNote(i)) {
        this.checkSpotlight(i, p);
        if (pool.state[i] !== 'field') continue;
      } else {
        // SPEAKER sensor: past the wall plane, inside the opening's width, at hood height.
        for (const a of ALLIANCES) {
          const behind = a === 'blue' ? p.x < -inch(1) : p.x > C.L + inch(1);
          if (!behind || Math.abs(p.y - C.SPEAKER_Y) > C.SPEAKER_OPENING_WIDTH / 2 || p.z < inch(64) || p.z > C.SPEAKER_HOOD_TOP + inch(4)) continue;
          pool.reserve(i, `speaker:${a}`);
          if (this.speakerCounting()) {
            const auto = this.isAuto();
            const amp = !auto && this.now <= this.amplifiedUntil[a] + 0.25;
            const pts = speakerPoints(auto, amp);
            const shooter = this.launches.get(i);
            const by = shooter?.alliance === a ? shooter.robotId : undefined;
            score.add(a, auto ? 'autoSpeaker' : amp ? 'speakerAmplified' : 'speaker', pts, this.now, by);
            if (by !== undefined) score.tally(by, 'scored');
            score.inc(a, 'notes');
            score.inc(a, 'speakerNotes');
            this.ctx.toast(`${a.toUpperCase()} SPEAKER +${pts}${amp ? ' · AMPLIFIED' : ''}`, 'good', a);
          }
          break;
        }
        if (pool.state[i] !== 'field') continue;
      }
      // NOTES that leave the FIELD are not returned to play [M 6.8].
      if (p.x < -0.35 || p.x > C.L + 0.35 || p.y < -0.35 || p.y > C.W + 0.35 || p.z < -0.3) pool.reserve(i, 'out');
    }
    if (this.ctx.clock.started && this.ctx.clock.mode !== 'disabled') {
      this.checkContacts();
      reportPins(this.pins.updateRobots(dt, this.ctx.robots, this.ctx.physics), this.ctx, this.now);
    }
  }

  /** A HIGH NOTE dropping over a MICROPHONE top (ring around the pipe) SPOTLIGHTS that chain [M 6.5.4]. */
  private checkSpotlight(i: number, p: { x: number; y: number; z: number }): void {
    const prev = this.prevZ.get(i) ?? p.z;
    this.prevZ.set(i, p.z);
    for (const a of ALLIANCES) {
      for (let c = 0; c < 3; c++) {
        const mic = C.micPoint(a, c);
        if (prev < C.MIC_TOP || p.z >= C.MIC_TOP || this.spotlit[a][c]) continue;
        if (Math.hypot(p.x - mic.x, p.y - mic.y) > C.NOTE_INNER_RADIUS - C.MIC_RADIUS) continue;
        this.ctx.pool.reserve(i, `spot:${a}:${c}`);
        this.spotlit[a][c] = true;
        this.ctx.toast(`${a.toUpperCase()} ${C.chainLabel(a, c)} SPOTLIT · ONSTAGE robots there earn 4`, 'good', a);
        return;
      }
    }
  }

  /** Protected-contact fouls G405, G422, G423, G424 (edge-triggered per robot pair and rule). */
  private checkContacts(): void {
    const { robots, physics, pool, clock } = this.ctx;
    const live = new Set<string>();
    const touching = (r: Robot, o: Robot) => {
      let hit = false;
      for (let i = 0; i < r.body.numColliders() && !hit; i++) for (let j = 0; j < o.body.numColliders() && !hit; j++) {
        physics.world.contactPair(r.body.collider(i), o.body.collider(j), (m) => { if (m.numContacts() > 0) hit = true; });
      }
      return hit;
    };
    const call = (key: string, fire: () => void) => {
      live.add(key);
      if (!this.contacts.has(key)) fire();
    };
    const auto = clock.mode === 'auto';
    for (const r of robots) {
      const opp = opponent(r.alliance);
      const crossed = r.corners().every((q) => (r.alliance === 'blue' ? q.x > C.L / 2 : q.x < C.L / 2));
      // G405: in AUTO, past the CENTER LINE — no contact with opponent robots or NOTES staged in their WING.
      if (auto && crossed) {
        for (const i of [0, 1, 2].map((k) => (opp === 'blue' ? k : 3 + k))) {
          if (pool.state[i] !== 'field') continue;
          const spot = C.wingSpikes(opp)[i % 3];
          const q = this.ctx.frame.toField(pool.position(i));
          if (Math.hypot(q.x - spot.x, q.y - spot.y) > 0.08) continue;
          let hit = false;
          for (let k = 0; k < r.body.numColliders() && !hit; k++) physics.world.contactPair(r.body.collider(k), pool.bodies[i].collider(0), (m) => { if (m.numContacts() > 0) hit = true; });
          if (hit) call(`G405n:${r.id}:${i}`, () => this.foul(r, 'major', 'G405', 'AUTO contact with a NOTE staged in the opponent WING'));
        }
      }
      for (const o of robots) {
        if (o.alliance === r.alliance || !touching(r, o)) continue;
        if (auto && crossed) call(`G405:${r.id}:${o.id}`, () => this.foul(r, 'major', 'G405', 'AUTO contact past the CENTER LINE'));
        // G422: before the last 20 s, hands off an opponent touching its PODIUM.
        if (!this.isEndgame() && this.touchingPodium(o)) call(`G422:${r.id}:${o.id}`, () => this.foul(r, 'major', 'G422', 'contact with a robot at its PODIUM'));
        // G423: no contact when either robot is in the opponent's SOURCE ZONE or AMP ZONE.
        const zones = [C.sourceZone(opp), C.ampZone(opp)];
        if (zones.some((z) => this.overlaps(r, z) || this.overlaps(o, z))) call(`G423:${r.id}:${o.id}`, () => this.foul(r, 'major', 'G423', 'contact in a protected SOURCE / AMP ZONE'));
        // G424: no contact with an opponent off the carpet, or in their STAGE ZONE in the last 20 s.
        const offCarpet = o.isClimbing && o.elevation > 0.02;
        const stageEnd = this.isEndgame() && (this.inStageZone(r, opp) || this.inStageZone(o, opp));
        if (offCarpet || stageEnd) {
          call(`G424:${r.id}:${o.id}`, () => {
            this.foul(r, 'major', 'G424', 'STAGE protection', 2);
            this.forcedEnsemble[opp] = true;
          });
        }
      }
    }
    this.contacts.clear();
    for (const k of live) this.contacts.add(k);
  }

  private touchingPodium(robot: Robot): boolean {
    const p = C.podium(robot.alliance);
    const s = C.PODIUM_WIDTH / 2 + inch(1.5), d = inch(2);
    const box = [{ x: p.x - d, y: p.y - s }, { x: p.x + d, y: p.y - s }, { x: p.x + d, y: p.y + s }, { x: p.x - d, y: p.y + s }];
    return this.overlaps(robot, box);
  }

  // ─────────────────────────── visuals ───────────────────────────

  updateVisuals(_dt: number, time: number): void {
    const { pool, frame } = this.ctx;
    const glow = (m: THREE.Mesh, on: boolean, strong = 2.4) => ((m.material as THREE.MeshStandardMaterial).emissiveIntensity = on ? strong : 0.05);
    for (const a of ALLIANCES) {
      const amp = this.amplified(a);
      for (const m of this.refs.speakerLights[a]) glow(m, amp);
      const left = Math.ceil(this.amplifyRemaining(a));
      this.refs.subwooferBars[a].forEach((m, k) => glow(m, amp && k < left));
      const L = this.refs.ampLights[a];
      glow(L.bottom, this.bank[a] >= 1 || amp);
      glow(L.top, amp ? Math.sin(time * Math.PI * 4) > 0 : this.bank[a] >= 2);
      const windowOpen = this.isAuto() || this.coopWindowOpen();
      const coopOn = windowOpen ? (this.coopUsed[a] ? true : Math.sin(time * Math.PI * 2) > 0) : this.coopBonus();
      glow(L.coop, coopOn, 2);
      this.refs.highNotes[a].forEach((m, k) => (m.visible = k < this.highNotesLeft[a]));
      this.refs.spotlights[a].forEach((m, c) => (m.visible = this.spotlit[a][c]));
      this.refs.trapNotes[a].forEach((m, c) => (m.visible = this.trapScored[a][c]));
      const an = this.refs.ampNotes[a];
      an.visible = this.ampAnim[a] > 0;
      if (an.visible) {
        const k = 1 - this.ampAnim[a] / 0.45;
        const ap = C.ampCenter(a);
        an.position.copy(frame.toWorld(ap.x, C.W - inch(10) + k * inch(12), C.AMP_POCKET_BOTTOM + inch(9)));
        an.rotation.set(0, 0, 0);
      }
    }
    for (const r of this.ctx.robots) {
      const m = this.heldVisuals.get(r.id)!;
      m.visible = r.held.some((i) => i < 0 || (!C.isHighNote(i) && pool.state[i] === 'held'));
    }
  }

  results(): MatchResults {
    return crescendoResults(this.ctx.score, this.coopBonus(), this.forcedEnsemble);
  }

  netState(): CrescendoNetState {
    return {
      bank: { ...this.bank },
      amp: { ...this.amplifiedUntil },
      coop: { ...this.coopUsed },
      spot: { blue: [...this.spotlit.blue], red: [...this.spotlit.red] },
      trap: { blue: [...this.trapScored.blue], red: [...this.trapScored.red] },
      high: { ...this.highNotesLeft },
      anim: { ...this.ampAnim },
      ens: { ...this.forcedEnsemble },
    };
  }

  applyNetState(state: unknown): void {
    const s = state as CrescendoNetState;
    this.bank = { ...s.bank };
    // JSON turns -Infinity into null.
    this.amplifiedUntil = { blue: s.amp.blue ?? -Infinity, red: s.amp.red ?? -Infinity };
    this.coopUsed = { ...s.coop };
    this.spotlit = { blue: [...s.spot.blue], red: [...s.spot.red] };
    this.trapScored = { blue: [...s.trap.blue], red: [...s.trap.red] };
    this.highNotesLeft = { ...s.high };
    this.ampAnim = { ...s.anim };
    this.forcedEnsemble = { ...s.ens };
  }
}
