import type { Alliance, FieldPoint } from '../coords';
import type { AiSkill, GameSettings, SeasonContext } from '../core/season';
import type { Robot } from '../robot/robot';
import { dist } from './steering';

/** Orders for one AI alliance after defaults are applied. */
export interface ResolvedOrders {
  skill: AiSkill;
  strategy: string;
  /** Role per driver station; 'auto' (or missing) lets the alliance plan it. */
  roles: Record<number, string>;
}

/** Your alliance follows `aiAlly` (teammates default to Normal); the other follows `aiOpponent` and the difficulty. */
export function aiOrders(s: GameSettings, a: Alliance): ResolvedOrders {
  const mine = a === s.alliance;
  const o = (mine ? s.aiAlly : s.aiOpponent) ?? {};
  return { skill: o.skill ?? (mine ? 'normal' : s.aiDifficulty ?? 'normal'), strategy: o.strategy || 'auto', roles: { ...(o.roles ?? {}) } };
}

/** How well an AI skill level drives: share of top speed, re-planning interval, and whether it runs the full plan. */
export const SKILL: Record<AiSkill, { pace: number; retarget: number; smart: boolean; aggressive: boolean }> = {
  easy: { pace: 0.6, retarget: 0.6, smart: false, aggressive: false },
  normal: { pace: 0.85, retarget: 0.35, smart: true, aggressive: false },
  hard: { pace: 1, retarget: 0.2, smart: true, aggressive: true },
  elite: { pace: 1, retarget: 0.12, smart: true, aggressive: true },
};

export interface RadioMessage {
  seq: number;
  t: number;
  alliance: Alliance;
  from: string;
  text: string;
}

/** Alliance radio: the callouts AI robots use to coordinate, which the HUD shows (both alliances share one log). */
export class Radio {
  readonly messages: RadioMessage[] = [];
  private seq = 0;
  private readonly last = new Map<string, number>();

  say(t: number, alliance: Alliance, from: string, text: string, key = `${alliance}:${from}:${text}`, every = 6): boolean {
    if (t < (this.last.get(key) ?? -Infinity) + every) return false;
    this.last.set(key, t);
    this.messages.push({ seq: ++this.seq, t, alliance, from, text });
    if (this.messages.length > 200) this.messages.splice(0, this.messages.length - 200);
    return true;
  }

  since(seq: number): RadioMessage[] {
    return this.messages.filter((m) => m.seq > seq);
  }
}

const radios = new WeakMap<SeasonContext, Radio>();
export function radioFor(ctx: SeasonContext): Radio {
  let r = radios.get(ctx);
  if (!r) radios.set(ctx, (r = new Radio()));
  return r;
}

/** Per-robot movement health, tracked for every alliance robot (the human driver too). */
export interface Health {
  /** Seconds this robot has been trying to move without moving (or lying tipped / beached). */
  stuck: number;
  why: 'stalled' | 'beached' | 'tipped' | 'pinned' | null;
  /** An opponent touching it while it is stuck. */
  pinnedBy: Robot | null;
  /** Rescue bookkeeping. */
  helper: Robot | null;
  helpTime: number;
  noHelpUntil: number;
  anchor: FieldPoint;
}

/** Decides a role (season role id) for each alliance robot, keyed by robot id. Called about once a second. */
export type RolePlanner = (team: TeamBrain) => Map<number, string>;

const brains = new WeakMap<SeasonContext, Map<Alliance, TeamBrain>>();

/**
 * Shared alliance brain. Every AI robot on an alliance consults the same instance: it assigns roles (from the season's
 * planner and the player's orders), keeps a blackboard for the season's plan (amplify timing, feeding lanes...), tracks
 * which teammates are stuck and sends the best-placed robot to push them free (backing off if that fails), and voices
 * the coordination as radio callouts.
 */
export class TeamBrain {
  readonly orders: ResolvedOrders;
  readonly radio: Radio;
  readonly health = new Map<number, Health>();
  private readonly roles = new Map<number, string>();
  private readonly data = new Map<string, unknown>();
  private planner: RolePlanner | null = null;
  private lastTick = -1;
  private readonly pushingUntil = new Map<number, number>();
  private replanAt = 0;

  static for(ctx: SeasonContext, alliance: Alliance): TeamBrain {
    let m = brains.get(ctx);
    if (!m) brains.set(ctx, (m = new Map()));
    let b = m.get(alliance);
    if (!b) m.set(alliance, (b = new TeamBrain(ctx, alliance)));
    return b;
  }

  private constructor(readonly ctx: SeasonContext, readonly alliance: Alliance) {
    this.orders = aiOrders(ctx.settings, alliance);
    this.radio = radioFor(ctx);
  }

  get skill(): AiSkill { return this.orders.skill; }
  get strategy(): string { return this.orders.strategy; }
  get members(): Robot[] { return this.ctx.robots.filter((r) => r.alliance === this.alliance); }
  get opponents(): Robot[] { return this.ctx.robots.filter((r) => r.alliance !== this.alliance); }
  get now(): number { return this.ctx.clock.elapsed; }

  usePlanner(planner: RolePlanner): void {
    if (!this.planner) { this.planner = planner; this.replanAt = 0; }
  }

  /** Season blackboard entry, created on first use. */
  memo<T>(key: string, init: () => T): T {
    if (!this.data.has(key)) this.data.set(key, init());
    return this.data.get(key) as T;
  }

  /** The role the player assigned to this station ('auto' when none). */
  orderedRole(r: Robot): string {
    return this.orders.roles[r.station] || 'auto';
  }

  role(r: Robot): string {
    this.tick();
    const ordered = this.orderedRole(r);
    return ordered !== 'auto' ? ordered : this.roles.get(r.id) ?? 'auto';
  }

  label(r: Robot): string {
    return r === this.ctx.playerRobot ? 'You' : `${r.alliance === 'blue' ? 'Blue' : 'Red'} ${r.station}`;
  }

  say(r: Robot | null, text: string, key?: string, every = 6): void {
    this.radio.say(this.now, this.alliance, r ? this.label(r) : 'Drive coach', text, key ? `${this.alliance}:${key}` : undefined, every);
  }

  /** This robot is pushing on purpose (defense, a rescue): don't treat its stall as being stuck. */
  pushing(r: Robot, seconds = 0.4): void {
    this.pushingUntil.set(r.id, this.now + seconds);
  }

  /** Runs once per physics step, whichever teammate asks first. */
  tick(): void {
    const t = this.now;
    if (t === this.lastTick) return;
    const dt = this.lastTick < 0 ? 0 : Math.max(0, t - this.lastTick);
    this.lastTick = t;
    this.trackHealth(dt);
    if (this.planner && t >= this.replanAt) {
      this.replanAt = t + 1;
      const next = this.planner(this);
      for (const [id, role] of next) {
        const before = this.roles.get(id);
        this.roles.set(id, role);
        const r = this.ctx.robots.find((x) => x.id === id);
        if (r && before && before !== role && r.controller === 'bot' && this.orderedRole(r) === 'auto') this.say(r, `Switching to ${role.toUpperCase()}`, `role:${id}:${role}`, 10);
      }
    }
  }

  private trackHealth(dt: number): void {
    for (const r of this.members) {
      let h = this.health.get(r.id);
      if (!h) this.health.set(r.id, (h = { stuck: 0, why: null, pinnedBy: null, helper: null, helpTime: 0, noHelpUntil: 0, anchor: r.pose }));
      const cmd = r.lastCommand;
      const wants = Math.hypot(cmd.vx, cmd.vy) > 0.6;
      const slow = r.speed < 0.2;
      const beached = r.traction < 0.5 && slow;
      const blocked = wants && slow && !r.isClimbing && r.enabled && this.now > (this.pushingUntil.get(r.id) ?? -1);
      const touching = this.opponents.find((o) => dist(o.pose, r.pose) < (Math.max(o.footprint.length, o.footprint.width) + Math.max(r.footprint.length, r.footprint.width)) / 2 + 0.12) ?? null;
      if (r.tippedOver || (beached && r.enabled && !r.isClimbing) || blocked) {
        h.stuck += dt;
        h.why = r.tippedOver ? 'tipped' : beached ? 'beached' : touching ? 'pinned' : 'stalled';
        h.pinnedBy = touching;
      } else {
        h.stuck = Math.max(0, h.stuck - dt * 3);
        if (h.stuck === 0) { h.why = null; h.pinnedBy = null; h.anchor = r.pose; }
      }
    }
    this.assignHelpers(dt);
  }

  /** Send the nearest free AI teammate to anyone stuck for a while; give up after a few seconds without progress. */
  private assignHelpers(dt: number): void {
    if (!SKILL[this.skill].smart) return;
    for (const r of this.members) {
      const h = this.health.get(r.id)!;
      // Beached (wheels off the carpet) or pinned: a push helps. Plain stalls against something get a while to sort
      // themselves out first (the robot's own escape moves usually do).
      const needs = !r.isClimbing && this.now >= h.noHelpUntil && h.why !== 'tipped' && h.why !== null &&
        (h.why === 'stalled' ? h.stuck > 4 : h.stuck > 1.6);
      if (!needs) {
        if (h.helper && h.stuck === 0) this.say(h.helper, `${this.label(r)} is free — back to work`, `freed:${r.id}`, 8);
        h.helper = null;
        h.helpTime = 0;
        continue;
      }
      if (h.helper && (h.helper.isClimbing || h.helper.tippedOver)) h.helper = null;
      if (!h.helper) {
        const candidates = this.members.filter((o) => o !== r && o.controller === 'bot' && !o.isClimbing && !o.tippedOver &&
          (this.health.get(o.id)?.stuck ?? 0) < 0.5 && ![...this.health.values()].some((x) => x.helper === o));
        candidates.sort((a, b) => dist(a.pose, r.pose) - dist(b.pose, r.pose));
        const helper = candidates[0];
        if (!helper || dist(helper.pose, r.pose) > 9) continue;
        h.helper = helper;
        h.helpTime = 0;
        const where = h.why === 'beached' ? 'beached' : h.why === 'pinned' ? 'pinned' : 'stuck';
        this.say(r, `I'm ${where} — need a push!`, `help:${r.id}`, 10);
        this.say(helper, `On my way, ${this.label(r)}`, `omw:${helper.id}:${r.id}`, 10);
      }
      h.helpTime += dist(h.helper.pose, r.pose) < 1.5 ? dt : dt * 0.5;
      // A teammate that won't come free after ~5 s of pushing is left alone for a while (don't burn the match on it).
      if (h.helpTime > 6) {
        this.say(h.helper, `Can't free ${this.label(r)} — backing off`, `giveup:${r.id}`, 10);
        h.helper = null;
        h.noHelpUntil = this.now + 12;
      }
    }
  }

  /** The teammate this robot has been sent to rescue, with how to push. */
  rescueFor(helper: Robot): { target: Robot; push: Robot; dir: { x: number; y: number } } | null {
    this.tick();
    for (const r of this.members) {
      const h = this.health.get(r.id);
      if (h?.helper !== helper) continue;
      if (h.why === 'pinned' && h.pinnedBy) {
        // Shove the pinning robot off our teammate.
        const dx = h.pinnedBy.pose.x - r.pose.x, dy = h.pinnedBy.pose.y - r.pose.y, d = Math.hypot(dx, dy) || 1;
        return { target: r, push: h.pinnedBy, dir: { x: dx / d, y: dy / d } };
      }
      // Push the way it is trying to drive; otherwise straight through it from where the helper is.
      const c = r.lastCommand, s = Math.hypot(c.vx, c.vy);
      let dx = s > 0.3 ? c.vx / s : r.pose.x - helper.pose.x, dy = s > 0.3 ? c.vy / s : r.pose.y - helper.pose.y;
      const d = Math.hypot(dx, dy) || 1;
      dx /= d; dy /= d;
      return { target: r, push: r, dir: { x: dx, y: dy } };
    }
    return null;
  }
}
