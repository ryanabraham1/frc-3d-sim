import * as THREE from 'three';
import { Alliance, ALLIANCES, opponent } from '@engine/coords';
import type { MatchResults, SeasonContext, SeasonRules } from '@engine/core/season';
import type { PeriodChange } from '@engine/match/clock';
import type { AimTarget, Robot } from '@engine/robot/robot';
import * as C from './constants';
import { dir, RebuiltFieldRefs, side, towerSlots } from './field';
import {
  decideFirstInactive,
  HubGrace,
  hubActive,
  hubLight,
  HubLight,
  isAutoScoringPeriod,
  secondsActiveRemaining,
  secondsUntilActive,
} from './hubLogic';
import { autoTowerPoints, POINTS, rankingPoints, teleopTowerPoints } from './scoring';
import { stageFuel } from './staging';
import { feedTarget, rowClearances } from './passing';

const CHUTE_TAG = (a: Alliance) => `chute-${a}`;
/** FUEL that left the FIELD is put back on the carpet this far inside the edge it crossed (m, [EST]). */
const OUT_OF_BOUNDS_INSET = 0.35;
const HUB_TAG = (a: Alliance) => `hub-${a}`;
const HP_RELEASE_INTERVAL = 0.14;

/** What multiplayer clients need from the rules (score/clock are synced by the engine). */
export interface RebuiltNetState {
  fi: Alliance | null;
  /** HubGrace.lastActive (null = never). */
  la: [number | null, number | null];
  co: [boolean, boolean];
}

interface Processing {
  idx: number;
  alliance: Alliance;
  releaseAt: number;
}

/**
 * Runtime rules for REBUILT: hub sensors / processing / exits, hub status & lights, fuel scoring
 * with grace windows, TOWER climbing + assessment, human player CHUTE/CORRAL, fouls G403 & G407.
 */
export class RebuiltRules implements SeasonRules {
  firstInactive: Alliance | null = null;
  readonly grace = new HubGrace();
  readonly chuteOpen: Record<Alliance, boolean> = { red: false, blue: false };
  private releaseTimer: Record<Alliance, number> = { red: 0, blue: 0 };
  private lastHpOpen: Record<Alliance, number> = { red: -99, blue: -99 };
  private processing: Processing[] = [];
  /** Recently launched FUEL → who launched it and whether from outside their ALLIANCE ZONE (for G407). */
  private launches = new Map<number, { robotId: number; alliance: Alliance; outside: boolean; t: number; team: number }>();
  private g407Cooldown = new Map<number, number>();
  private g403Called = new Set<number>();
  private climbHintAt = -99;
  private towerAuto: Record<Alliance, number> = { red: 0, blue: 0 };
  private towerTeleop: Record<Alliance, number> = { red: 0, blue: 0 };
  private readonly tmp = new THREE.Vector3();
  private readonly tmp2 = new THREE.Vector3();

  constructor(
    private readonly ctx: SeasonContext,
    readonly refs: RebuiltFieldRefs,
  ) {}

  // ─────────────────────────── helpers used by AI / HUD ───────────────────────────

  get now(): number {
    return this.ctx.clock.elapsed;
  }

  get periodId(): string | null {
    const c = this.ctx.clock;
    if (!c.started) return null;
    return c.finished ? 'done' : c.current.id;
  }

  hubActive(a: Alliance): boolean {
    const p = this.periodId;
    return p !== null && hubActive(p, a, this.firstInactive);
  }

  /** Would fuel entering `a`'s hub right now count? */
  hubCounts(a: Alliance): boolean {
    const p = this.periodId;
    if (p === null) return false;
    return this.grace.counts(a, this.now, p, this.firstInactive);
  }

  secondsUntilActive(a: Alliance): number {
    const c = this.ctx.clock;
    if (!c.started) return c.timeUntil('auto');
    if (c.finished) return Infinity;
    // Before SHIFT order is known, treat shifts as active for planning.
    return secondsUntilActive(c.periods, c.index, c.periodRemaining, a, this.firstInactive);
  }

  secondsActiveRemaining(a: Alliance): number {
    const c = this.ctx.clock;
    if (!c.started || c.finished) return 0;
    return secondsActiveRemaining(c.periods, c.index, c.periodRemaining, a, this.firstInactive);
  }

  light(a: Alliance): HubLight {
    const c = this.ctx.clock;
    if (!c.started) return 'off';
    if (c.finished) return 'off';
    return hubLight(c.current.id, c.periodRemaining, a, this.firstInactive, c.next()?.id ?? null);
  }

  fuelActive(a: Alliance): number {
    return this.ctx.score.counter(a, 'fuelActive');
  }

  towerPoints(a: Alliance): number {
    return this.ctx.score.category(a, 'towerAuto') + this.ctx.score.category(a, 'towerTeleop');
  }

  chuteCount(a: Alliance): number {
    return this.ctx.pool.countIn('reserve', CHUTE_TAG(a));
  }

  hubCenter(a: Alliance): { x: number; y: number } {
    return this.refs.hubs[a].center;
  }

  /** G407: bumpers partially or fully within own ALLIANCE ZONE. */
  inAllianceZone(r: Robot, a: Alliance = r.alliance): boolean {
    const cs = r.corners();
    return a === 'blue' ? cs.some((p) => p.x <= C.ALLIANCE_ZONE_DEPTH) : cs.some((p) => p.x >= C.FIELD_LENGTH - C.ALLIANCE_ZONE_DEPTH);
  }

  /** G403: bumpers completely across the CENTER LINE (toward the opponent). */
  acrossCenter(r: Robot): boolean {
    const cs = r.corners();
    return r.alliance === 'blue' ? cs.every((p) => p.x > C.CENTER_X) : cs.every((p) => p.x < C.CENTER_X);
  }

  /** Nearest free climb slot on the robot's own tower. */
  freeSlot(r: Robot): { idx: number; pose: { x: number; y: number; yaw: number }; dist: number } | null {
    const slots = towerSlots(r.alliance, r.footprint.length, r.footprint.width);
    const taken = new Set(this.ctx.robots.filter((o) => o !== r && o.alliance === r.alliance && o.climbSlot !== null).map((o) => o.climbSlot));
    const p = r.pose;
    let best: { idx: number; pose: { x: number; y: number; yaw: number }; dist: number } | null = null;
    slots.forEach((s, idx) => {
      if (taken.has(idx)) return;
      const d = Math.hypot(s.x - p.x, s.y - p.y);
      if (!best || d < best.dist) best = { idx, pose: s, dist: d };
    });
    return best;
  }

  liftHeight(r: Robot, level: number): number {
    const bb = r.config.bumperBottom;
    if (level <= 1) return 0.12;
    const rung = C.RUNG_HEIGHTS[level - 2] + C.RUNG_OD / 2;
    return rung + 0.04 - bb;
  }

  // ─────────────────────────── SeasonRules ───────────────────────────

  stage(): void {
    const { pool, robots, rng } = this.ctx;
    const st = stageFuel(
      robots.map((r) => Math.min(r.config.preload, r.config.hopperCapacity)),
      rng,
    );
    let k = 0;
    for (const p of st.neutral) pool.placeField(k++, p.x, p.y);
    for (const a of ALLIANCES) for (const p of st.depots[a]) pool.placeField(k++, p.x, p.y);
    for (const a of ALLIANCES) for (let i = 0; i < st.chutes[a]; i++) pool.reserve(k++, CHUTE_TAG(a));
    robots.forEach((r, ri) => {
      r.held.length = 0;
      for (let i = 0; i < st.preloads[ri]; i++) {
        pool.hold(k, r.id);
        r.held.push(k++);
      }
    });
    while (k < pool.count) pool.reserve(k++, 'spare');
  }

  onPeriodChange(ch: PeriodChange): void {
    const { score, toast, robots } = this.ctx;
    const from = ch.from?.id;
    const to = ch.to?.id;
    if (to === 'auto') this.grace.reset();

    if (from === 'auto') {
      // AUTO TOWER assessed at 0:00 [M 6.5 C]
      for (const a of ALLIANCES) {
        const levels = robots.filter((r) => r.alliance === a && r.climbPhase === 'hanging').map((r) => Math.min(1, r.climbLevel));
        this.towerAuto[a] = autoTowerPoints(levels);
        score.set(a, 'towerAuto', this.towerAuto[a]);
        // Only the first AUTO_TOWER_MAX_ROBOTS robots at LEVEL 1+ earn points.
        const hanging = robots.filter((r) => r.alliance === a);
        let paid = 0;
        for (const r of hanging) {
          const earns = r.climbPhase === 'hanging' && r.climbLevel >= 1 && paid < POINTS.autoTowerMaxRobots;
          if (earns) paid++;
          score.setCredit(r.id, 'towerAuto', earns ? POINTS.autoTowerL1 : 0);
        }
      }
      this.g403Called.clear();
    }

    if (to === 'transition') {
      const red = score.counter('red', 'autoFuel');
      const blue = score.counter('blue', 'autoFuel');
      this.firstInactive = decideFirstInactive(red, blue, this.ctx.rng.next());
      const tie = red === blue ? ' (tie → FMS random)' : '';
      toast(`AUTO fuel ${red}–${blue}. ${this.firstInactive.toUpperCase()} hub inactive in SHIFT 1${tie}`, 'info');
    }

    if (to && to.startsWith('shift') && this.firstInactive) {
      const active = ALLIANCES.filter((a) => hubActive(to, a, this.firstInactive));
      toast(`${ch.to!.label}: ${active.map((a) => a.toUpperCase()).join(' & ')} HUB ACTIVE`, 'info', active[0]);
    }
    if (to === 'endgame') toast('END GAME — both hubs active. Climb!', 'warn');

    if (to === 'post') {
      // TELEOP TOWER assessed at end of match [M 6.5 D]
      for (const a of ALLIANCES) {
        const levels = robots.filter((r) => r.alliance === a && r.climbPhase === 'hanging').map((r) => r.climbLevel);
        this.towerTeleop[a] = teleopTowerPoints(levels);
        score.set(a, 'towerTeleop', this.towerTeleop[a]);
        for (const r of robots.filter((x) => x.alliance === a)) {
          score.setCredit(r.id, 'towerTeleop', r.climbPhase === 'hanging' ? teleopTowerPoints([r.climbLevel]) : 0);
        }
      }
    }
  }

  beforeStep(dt: number): void {
    const { pool, frame, rng, clock } = this.ctx;
    const t = this.now;

    // Hub processing → exits into the NEUTRAL ZONE.
    for (let i = this.processing.length - 1; i >= 0; i--) {
      const pr = this.processing[i];
      if (pr.releaseAt > t) continue;
      const hub = this.refs.hubs[pr.alliance].center;
      const d = dir(pr.alliance);
      const exit = rng.int(0, C.HUB_EXIT_COUNT - 1);
      const oy = hub.y + (exit - (C.HUB_EXIT_COUNT - 1) / 2) * (C.HUB_SIZE / C.HUB_EXIT_COUNT);
      const ox = hub.x + d * (C.HUB_SIZE / 2 + pool.radius + 0.04);
      // Don't spawn inside a robot parked at the exit (it will be released when clear).
      const blocked = this.ctx.robots.some((r) => {
        const p = r.pose;
        return Math.hypot(p.x - ox, p.y - oy) < Math.max(r.footprint.length, r.footprint.width) / 2 + pool.radius;
      });
      if (blocked) {
        pr.releaseAt = t + 0.25;
        continue;
      }
      frame.toWorld(ox, oy, C.HUB_EXIT_HEIGHT, this.tmp);
      frame.velToWorld(d * rng.range(1.2, 3.2), rng.range(-1.0, 1.0), 0.3, this.tmp2);
      pool.placeWorld(pr.idx, this.tmp, this.tmp2);
      this.processing.splice(i, 1);
    }

    // Human players: automatic ones open the CHUTE when it has stock and their hub is (about to be) active.
    const running = clock.started && !clock.finished;
    for (const a of ALLIANCES) {
      const auto = this.ctx.humanPlayerIsAuto(a);
      const stock = this.chuteCount(a);
      if (auto && running && !this.chuteOpen[a] && stock >= 6 && t - this.lastHpOpen[a] > 5 && clock.mode !== 'disabled') {
        if (this.secondsUntilActive(a) < 4 || clock.mode === 'auto') {
          this.chuteOpen[a] = true;
          this.lastHpOpen[a] = t;
        }
      }
      if (!this.chuteOpen[a]) continue;
      if (stock === 0) {
        this.chuteOpen[a] = false;
        continue;
      }
      this.releaseTimer[a] -= dt;
      if (this.releaseTimer[a] > 0) continue;
      this.releaseTimer[a] = HP_RELEASE_INTERVAL;
      const idx = pool.indices('reserve', CHUTE_TAG(a))[0];
      const oc = side(a, 0, C.OUTPOST_CENTER_Y);
      const x = side(a, pool.radius + 0.03, 0).x;
      frame.toWorld(x, oc.y + rng.range(-0.25, 0.25), C.CHUTE_OPENING_Z + C.CHUTE_OPENING_H / 2, this.tmp);
      frame.velToWorld(dir(a) * rng.range(1.3, 2.3), rng.range(-0.35, 0.35), rng.range(0, 0.6), this.tmp2);
      pool.placeWorld(idx, this.tmp, this.tmp2);
    }
  }

  afterStep(dt: number): void {
    const { pool, frame, score, clock, robots, toast } = this.ctx;
    const t = this.now;
    const pid = this.periodId;
    if (pid && pid !== 'done') this.grace.update(t, pid, this.firstInactive);

    const inner = C.HUB_SIZE / 2 - C.HUB_WALL - 0.01;
    for (let i = 0; i < pool.count; i++) {
      if (pool.state[i] !== 'field') continue;
      const w = pool.position(i);
      const f = frame.toField(w);

      // HUB sensor array: FUEL inside the cup.
      if (f.z > C.HUB_CUP_FLOOR - 0.02 && f.z < C.HUB_RIM_HEIGHT - 0.01) {
        for (const a of ALLIANCES) {
          const hc = this.refs.hubs[a].center;
          if (Math.abs(f.x - hc.x) < inner && Math.abs(f.y - hc.y) < inner) {
            this.scoreFuel(a, i);
            break;
          }
        }
        continue;
      }

      // [M 5.9.2] CORRAL: FUEL pushed through the floor opening at the base of the OUTPOST lands in the
      // CORRAL behind the wall → its human player can load it into the CHUTE. Only FUEL physically in the
      // CORRAL counts — nothing else ever reaches a CHUTE.
      const behind = f.x < -C.WALL_THICK || f.x > C.FIELD_LENGTH + C.WALL_THICK;
      if (behind) {
        const a: Alliance = f.x < 0 ? 'blue' : 'red';
        if (Math.abs(f.y - side(a, 0, C.OUTPOST_CENTER_Y).y) < C.CORRAL_WIDTH / 2 && f.z < C.CORRAL_WALL_H) {
          pool.reserve(i, CHUTE_TAG(a));
          continue;
        }
      }
      // [M 6.8] FUEL that leaves the FIELD any other way (over a guardrail or the ALLIANCE WALL, or through a
      // gap) is placed back into the FIELD by FIELD STAFF approximately at the point of exit — NOT given to a
      // human player.
      if (behind || f.y < -0.25 || f.y > C.FIELD_WIDTH + 0.25 || f.z < -0.3) {
        const m = OUT_OF_BOUNDS_INSET;
        pool.placeField(i, Math.min(C.FIELD_LENGTH - m, Math.max(m, f.x)), Math.min(C.FIELD_WIDTH - m, Math.max(m, f.y)));
      }
    }

    // G403: completely crossing the CENTER LINE in AUTO.
    if (clock.started && clock.current.id === 'auto') {
      for (const r of robots) {
        if (this.g403Called.has(r.id) || !this.acrossCenter(r)) continue;
        this.g403Called.add(r.id);
        score.foul({ t, alliance: r.alliance, kind: 'major', rule: 'G403', robotId: r.id, note: 'crossed CENTER LINE in AUTO' });
        toast(`MAJOR FOUL G403 — ${r.config.teamNumber} crossed the CENTER LINE in AUTO`, 'foul', r.alliance);
      }
    }
    for (const [id, cd] of this.g407Cooldown) this.g407Cooldown.set(id, cd - dt);
    for (const [idx, l] of this.launches) if (pool.state[idx] !== 'field' || t - l.t > 8) this.launches.delete(idx);
  }

  private scoreFuel(a: Alliance, idx: number): void {
    const { score, pool } = this.ctx;
    // G407: FUEL launched into your own HUB while your bumpers were outside your ALLIANCE ZONE.
    const l = this.launches.get(idx);
    this.launches.delete(idx);
    if (l && l.outside && l.alliance === a && (this.g407Cooldown.get(l.robotId) ?? 0) <= 0) {
      this.g407Cooldown.set(l.robotId, 2.5);
      score.foul({ t: this.now, alliance: a, kind: 'major', rule: 'G407', robotId: l.robotId, note: 'launched into HUB from outside ALLIANCE ZONE' });
      this.ctx.toast(`MAJOR FOUL G407 — ${l.team} launched into its HUB from outside its ALLIANCE ZONE`, 'foul', a);
    }
    const pid = this.periodId ?? 'pre';
    const counts = this.hubCounts(a);
    if (counts) {
      const auto = isAutoScoringPeriod(pid);
      const by = l?.alliance === a ? l.robotId : undefined;
      score.add(a, auto ? 'fuelAuto' : 'fuelTeleop', 1, this.now, by);
      if (by !== undefined) score.tally(by, 'scored');
      score.inc(a, 'fuelActive');
      if (auto) score.inc(a, 'autoFuel');
    } else {
      score.inc(a, 'fuelInactive');
    }
    pool.reserve(idx, HUB_TAG(a));
    const [lo, hi] = C.HUB_PROCESS_TIME;
    this.processing.push({ idx, alliance: a, releaseAt: this.now + this.ctx.rng.range(lo, hi) });
  }

  onLaunch(robot: Robot, pieceIndex: number): void {
    // Launching anywhere is legal; G407 is assessed if this FUEL ends up in our HUB (see scoreFuel).
    this.ctx.score.tally(robot.id, 'shots');
    this.launches.set(pieceIndex, {
      robotId: robot.id,
      alliance: robot.alliance,
      outside: !this.inAllianceZone(robot),
      t: this.now,
      team: robot.config.teamNumber,
    });
  }

  /** FEED: lob FUEL back into our ALLIANCE ZONE, clearing any hub rows (hub + net, trench) on the way. */
  passTarget(robot: Robot): AimTarget {
    const p = robot.pose;
    const from = { x: p.x, y: p.y };
    const t = feedTarget(robot.alliance, from);
    return { point: this.ctx.frame.toWorld(t.x, t.y, 0.2), clearances: rowClearances(from, t) };
  }

  aimTarget(robot: Robot): AimTarget | null {
    const hc = this.refs.hubs[robot.alliance].center;
    const point = this.ctx.frame.toWorld(hc.x, hc.y, C.HUB_RIM_HEIGHT + 0.02);
    // The physical rim is the square cup wall (the hex funnel is visual only). Along the approach
    // direction the wall's outer edge is half/max(|cos|,|sin|) from center — up to √2× further at a
    // corner. The piece must be above rim + radius over the whole wall top, outer to inner edge.
    const p = robot.pose;
    const ang = Math.atan2(p.y - hc.y, p.x - hc.x);
    const k = 1 / Math.max(Math.abs(Math.cos(ang)), Math.abs(Math.sin(ang)), 1e-6);
    const r = this.ctx.pool.radius;
    const top = C.HUB_RIM_HEIGHT + r + 0.02;
    return {
      point,
      clearances: [
        { distance: (C.HUB_SIZE / 2) * k + r, height: top },
        { distance: (C.HUB_SIZE / 2 - C.HUB_WALL) * k, height: top },
      ],
    };
  }

  requestClimb(robot: Robot, level: number): void {
    const auto = this.ctx.clock.mode === 'auto';
    const lvl = Math.max(1, Math.min(auto ? 1 : 3, level, robot.config.climber.maxLevel));
    const slot = this.freeSlot(robot);
    if (!slot || slot.dist > 1.6) {
      if (robot.controller === 'player' && this.now - this.climbHintAt > 2) {
        this.climbHintAt = this.now;
        this.ctx.toast(slot ? 'Drive closer to your TOWER to climb' : 'No free climb position on your TOWER', 'warn', undefined, robot);
      }
      return;
    }
    robot.startClimb(slot.pose, this.liftHeight(robot, lvl), lvl, slot.idx);
  }

  requestDescend(robot: Robot): void {
    robot.startDescend();
  }

  humanPlayerAction(alliance: Alliance): void {
    if (this.chuteCount(alliance) === 0 && !this.chuteOpen[alliance]) {
      this.ctx.toast('CHUTE is empty — push FUEL into the CORRAL to refill it', 'warn');
      return;
    }
    this.chuteOpen[alliance] = !this.chuteOpen[alliance];
    this.lastHpOpen[alliance] = this.now;
    this.ctx.toast(`Human player: CHUTE door ${this.chuteOpen[alliance] ? 'OPEN' : 'closed'}`, 'info', alliance);
  }

  updateVisuals(_dt: number, time: number): void {
    for (const a of ALLIANCES) {
      const mat = this.refs.hubs[a].lights;
      const base = new THREE.Color(C.COLORS[a]);
      const st = this.light(a);
      switch (st) {
        case 'active':
          mat.emissive.copy(base);
          mat.emissiveIntensity = 2.4;
          break;
        case 'warning':
          mat.emissive.copy(base);
          mat.emissiveIntensity = 0.2 + 2.4 * (0.5 + 0.5 * Math.sin(time * 14));
          break;
        case 'chase':
          mat.emissive.copy(base).lerp(new THREE.Color(0xffffff), 0.5 + 0.5 * Math.sin(time * 9));
          mat.emissiveIntensity = 2.2;
          break;
        case 'post':
          mat.emissive.set(0xffffff);
          mat.emissiveIntensity = 1.6;
          break;
        default:
          mat.emissive.copy(base);
          mat.emissiveIntensity = 0.04;
      }
      const door = this.refs.chuteDoors[a];
      door.visible = !this.chuteOpen[a];
    }
  }

  netState(): RebuiltNetState {
    const la = (a: Alliance) => (Number.isFinite(this.grace.lastActive[a]) ? this.grace.lastActive[a] : null);
    return { fi: this.firstInactive, la: [la('red'), la('blue')], co: [this.chuteOpen.red, this.chuteOpen.blue] };
  }

  applyNetState(state: unknown): void {
    const s = state as RebuiltNetState;
    this.firstInactive = s.fi;
    this.grace.lastActive = { red: s.la[0] ?? -Infinity, blue: s.la[1] ?? -Infinity };
    this.chuteOpen.red = s.co[0];
    this.chuteOpen.blue = s.co[1];
  }

  results(): MatchResults {
    const s = this.ctx.score;
    const rp = {} as Record<Alliance, ReturnType<typeof rankingPoints>>;
    for (const a of ALLIANCES) {
      rp[a] = rankingPoints({ fuelActive: this.fuelActive(a), towerPoints: this.towerPoints(a), ownScore: s.total(a), oppScore: s.total(opponent(a)) });
    }
    const row = (label: string, f: (a: Alliance) => string | number, emphasis = false, cats?: string[]) => ({ label, red: f('red'), blue: f('blue'), emphasis, cats });
    return {
      winner: s.winner(),
      rows: [
        row('AUTO FUEL', (a) => s.category(a, 'fuelAuto'), false, ['fuelAuto']),
        row('AUTO TOWER', (a) => s.category(a, 'towerAuto'), false, ['towerAuto']),
        row('TELEOP FUEL', (a) => s.category(a, 'fuelTeleop'), false, ['fuelTeleop']),
        row('TELEOP TOWER', (a) => s.category(a, 'towerTeleop'), false, ['towerTeleop']),
        row('Foul points received', (a) => s.foulPointsFor(a)),
        row('Fouls committed (minor / major)', (a) => `${s.foulCount(a, 'minor')} / ${s.foulCount(a, 'major')}`),
        row('FUEL into inactive hub (0 pts)', (a) => s.counter(a, 'fuelInactive')),
        row('TOTAL', (a) => s.total(a), true),
      ],
      rp: { red: rp.red.total, blue: rp.blue.total },
      rpDetail: { red: rp.red.detail, blue: rp.blue.detail },
    };
  }
}
