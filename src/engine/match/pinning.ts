import { Alliance, opponent } from '../coords';
import type { SeasonContext } from '../core/season';
import { collisionGroups, Group, type PhysicsWorld } from '../physics/world';
import type { Robot, RobotCommand } from '../robot/robot';
import type { FoulKind } from './scoreboard';

/**
 * PINNING (2024 G420 · 2025 G425 · 2026 G418): a ROBOT may not prevent an opponent's movement by contact (direct, or
 * against a FIELD element) for longer than the count. The first time the count runs out is a MINOR FOUL, then a MAJOR
 * FOUL for every further count in which the situation isn't corrected.
 *
 * The count ENDS when (A) the robots have been 6 ft apart for longer than the count, (B) either robot has moved 6 ft
 * from where the pin began for longer than the count, or (C) the pinning robot itself gets pinned. For A and B the
 * count PAUSES while that distance holds and resumes if the robots come back inside it.
 *
 * What the sim calls "pinned": a robot that is barely moving, is being driven, touches an opponent, and is boxed in, with
 * contacts on roughly opposite sides (an opponent on one side, a wall / FIELD element / another robot on the other, or
 * two opponents). Once established, sliding or twisting while still boxed in does not interrupt the count.
 * A robot that can still back away from a single opponent is being blocked or shoved, not pinned.
 */
export interface PinRule {
  /** Manual rule id used on the foul, e.g. 'G420'. */
  rule: string;
  /** Seconds before the first foul and between further fouls (5 in 2024, 3 since). */
  countSeconds: number;
  /** The manual's 6 ft / 72 in separation distance (m). */
  separation: number;
}

/** 6 ft, the separation distance in all three manuals. */
export const PIN_SEPARATION = 1.83;

/** Allow slow sliding / twisting when recognizing a pin (m/s and rad/s). */
export const PIN_MAX_SPEED = 0.5;
export const PIN_MAX_TURN = 1.2;
/** The driver has to be asking for motion: otherwise the robot is just parked next to an opponent. */
export const PIN_MIN_COMMAND = 0.2;
/** Two contact directions this far apart (dot product ≤ this) box a robot in. */
export const PIN_OPPOSED = -0.5;
/**
 * Sim approximation of the referee's judgement that a robot has escaped: once the pinned robot has been free for this
 * long the count starts over (a pin that keeps re-establishing itself within this window keeps counting).
 */
export const PIN_RELEASE_GRACE = 1;
/** The pinner is told about its pin once it has lasted this long, then refreshed this often. */
export const PIN_CUE_AFTER = 0.3;
export const PIN_CUE_EVERY = 0.25;
/** Fraction of the count after which the cue turns into a "back off" alarm. */
export const PIN_DANGER = 0.6;

/** One horizontal contact on a robot: unit direction from the robot toward what it touches. */
export interface PinContact {
  nx: number;
  ny: number;
}

/** What the tracker needs to know about a robot; `Robot` satisfies it through `pinAgent`. */
export interface PinAgent {
  id: number;
  alliance: Alliance;
  /** Team number, for messages. */
  team: number;
  /** Match is running and this robot can move. */
  enabled: boolean;
  /** Not a candidate for being pinned: climbing (off the carpet) or tipped over. */
  exempt: boolean;
  x: number;
  y: number;
  /** Half the bumper length: used to turn centre distance into bumper-to-bumper separation. */
  halfLength: number;
  speed: number;
  turn: number;
  /** Magnitude of the translation (or rotation) the driver or autopilot is asking for. */
  commanded: number;
  commandedTurn: number;
  /** Horizontal contact directions on this robot (only asked for when the robot is stopped, driven and touching). */
  contacts(): PinContact[];
}

export interface PinFoul {
  pinner: PinAgent;
  pinned: PinAgent;
  /** 1 for the first foul of this pin, 2, 3 ... for each further count. */
  n: number;
  kind: FoulKind;
  rule: string;
  /** Seconds the pin has been counted for. */
  seconds: number;
}

/** Live status for the pinning robot's driver. */
export interface PinCue {
  pinner: PinAgent;
  pinned: PinAgent;
  /** Seconds counted so far. */
  seconds: number;
  limit: number;
  /** Fouls already assessed for this pin. */
  fouls: number;
}

export interface PinResult {
  fouls: PinFoul[];
  cues: PinCue[];
}

interface PinRecord {
  pinnerId: number;
  pinnedId: number;
  start: { pinner: { x: number; y: number }; pinned: { x: number; y: number } };
  count: number;
  /** Time spent separated (A) or displaced (B) beyond the separation distance. */
  away: number;
  /** Time since the pinned robot was last actually held. */
  free: number;
  fouls: number;
  cueIn: number;
}

export class PinTracker {
  private readonly records = new Map<string, PinRecord>();

  constructor(readonly rule: PinRule) {}

  reset(): void {
    this.records.clear();
  }

  /** Seconds currently counted against `pinnerId` for pinning (its longest pin), 0 if none. */
  countFor(pinnerId: number): number {
    let c = 0;
    for (const r of this.records.values()) if (r.pinnerId === pinnerId) c = Math.max(c, r.count);
    return c;
  }

  /** Advance every pin by `dt`. `touching(a, b)` reports real contact between two robots. */
  update(dt: number, agents: PinAgent[], touching: (a: PinAgent, b: PinAgent) => boolean): PinResult {
    const out: PinResult = { fouls: [], cues: [] };
    const { countSeconds, separation, rule } = this.rule;
    const byId = new Map(agents.map((a) => [a.id, a]));
    const contact = new Map<string, boolean>();
    const isTouching = (a: PinAgent, b: PinAgent) => {
      const k = a.id < b.id ? `${a.id}:${b.id}` : `${b.id}:${a.id}`;
      let v = contact.get(k);
      if (v === undefined) contact.set(k, (v = touching(a, b)));
      return v;
    };
    const boxedIn = (o: PinAgent) => {
      const c = o.contacts();
      return c.some((a, i) => c.slice(i + 1).some((b) => a.nx * b.nx + a.ny * b.ny <= PIN_OPPOSED));
    };

    // Who is held, and by whom: stopped, asking to move, touching an opponent and boxed in.
    const heldBy = new Map<number, PinAgent[]>();
    for (const o of agents) {
      if (!o.enabled || o.exempt) continue;
      if (o.commanded <= PIN_MIN_COMMAND && o.commandedTurn <= PIN_MIN_COMMAND) continue;
      const holders = agents.filter((r) => {
        if (r.alliance === o.alliance || !r.enabled || !isTouching(r, o)) return false;
        // Once established, a pin lasts while the opponent is still driven and boxed in.
        // Sliding or twisting inside the trap must not pause or reset the count.
        return this.records.has(`${r.id}:${o.id}`) || (o.speed < PIN_MAX_SPEED && o.turn < PIN_MAX_TURN);
      });
      if (holders.length && boxedIn(o)) heldBy.set(o.id, holders);
    }
    // C: a robot that is itself pinned isn't pinning.
    const pinning = new Set<string>();
    for (const [pinnedId, holders] of heldBy) {
      for (const r of holders) if (!heldBy.has(r.id)) pinning.add(`${r.id}:${pinnedId}`);
    }

    for (const k of pinning) {
      if (this.records.has(k)) continue;
      const [rid, oid] = k.split(':').map(Number);
      const r = byId.get(rid)!, o = byId.get(oid)!;
      this.records.set(k, { pinnerId: rid, pinnedId: oid, start: { pinner: { x: r.x, y: r.y }, pinned: { x: o.x, y: o.y } }, count: 0, away: 0, free: 0, fouls: 0, cueIn: PIN_CUE_AFTER });
    }

    for (const [k, rec] of this.records) {
      const r = byId.get(rec.pinnerId), o = byId.get(rec.pinnedId);
      if (!r || !o || !r.enabled) { this.records.delete(k); continue; }
      const now = pinning.has(k);
      rec.free = now ? 0 : rec.free + dt;
      // The pinning robot got pinned (C), or the pinned robot got away.
      if (heldBy.has(r.id) || rec.free > PIN_RELEASE_GRACE) { this.records.delete(k); continue; }

      const gap = Math.hypot(r.x - o.x, r.y - o.y) - r.halfLength - o.halfLength;
      const apart = gap >= separation;
      const moved = Math.hypot(r.x - rec.start.pinner.x, r.y - rec.start.pinner.y) >= separation || Math.hypot(o.x - rec.start.pinned.x, o.y - rec.start.pinned.y) >= separation;
      const paused = apart || moved;
      rec.away = paused ? rec.away + dt : 0;
      if (rec.away > countSeconds) { this.records.delete(k); continue; }
      if (paused || !now) continue;

      rec.count += dt;
      const due = Math.floor(rec.count / countSeconds);
      while (rec.fouls < due) {
        rec.fouls++;
        out.fouls.push({ pinner: r, pinned: o, n: rec.fouls, kind: rec.fouls === 1 ? 'minor' : 'major', rule, seconds: rec.count });
        rec.cueIn = 0;
      }
      rec.cueIn -= dt;
      if (rec.cueIn <= 0 && rec.count >= PIN_CUE_AFTER) {
        rec.cueIn = PIN_CUE_EVERY;
        out.cues.push({ pinner: r, pinned: o, seconds: rec.count, limit: countSeconds, fouls: rec.fouls });
      }
    }
    return out;
  }

  /** Same as `update`, for real robots in a physics world. */
  updateRobots(dt: number, robots: Robot[], physics: PhysicsWorld): PinResult {
    const agents = robots.map((r) => pinAgent(r, robots, physics));
    const byId = new Map(robots.map((r) => [r.id, r]));
    return this.update(dt, agents, (a, b) => robotsTouching(physics, byId.get(a.id)!, byId.get(b.id)!));
  }
}

export function robotsTouching(physics: PhysicsWorld, r: Robot, o: Robot): boolean {
  let hit = false;
  for (let i = 0; i < r.body.numColliders() && !hit; i++) for (let j = 0; j < o.body.numColliders() && !hit; j++) {
    physics.world.contactPair(r.body.collider(i), o.body.collider(j), (m) => { if (m.numContacts() > 0) hit = true; });
  }
  return hit;
}

/** How close (m) a wall, FIELD element or robot has to be to a robot's bumpers to count as holding it. */
export const PIN_REACH = 0.04;

/**
 * Horizontal directions in which something holds this robot: other robots and fixed / hanging FIELD elements within
 * `PIN_REACH` of its bumpers (not the carpet, not game pieces). This is a proximity test rather than Rapier's contact
 * manifolds, which drop out when a squeezed robot settles a hair beyond the 1 cm prediction distance.
 */
export function robotContacts(physics: PhysicsWorld, r: Robot): PinContact[] {
  const R = physics.R;
  const out: PinContact[] = [];
  const t = r.body.translation();
  const cfg = r.config;
  const mid = (cfg.bumperTop + cfg.bumperBottom) / 2;
  const half = (cfg.bumperTop - cfg.bumperBottom) / 2;
  const fp = r.footprint;
  const centre = { x: t.x, y: t.y + mid, z: t.z };
  physics.world.intersectionsWithShape(
    centre,
    r.body.rotation(),
    new R.Cuboid(fp.length / 2 + PIN_REACH, half, fp.width / 2 + PIN_REACH),
    (other) => {
      const p = other.projectPoint(centre, false);
      const dx = p ? p.point.x - centre.x : 0, dz = p ? p.point.z - centre.z : 0;
      const h = Math.hypot(dx, dz);
      // World (x, z) -> field (x, y): field y is -z.
      if (h > 1e-6) out.push({ nx: dx / h, ny: -dz / h });
      return true;
    },
    undefined,
    collisionGroups(Group.ROBOT, Group.FIELD | Group.ROBOT | Group.ROBOT_ONLY),
    undefined,
    r.body,
  );
  return out;
}

export function pinAgent(r: Robot, _robots: Robot[], physics: PhysicsWorld): PinAgent {
  const p = r.pose;
  const cmd: RobotCommand = r.lastCommand;
  return {
    id: r.id,
    alliance: r.alliance,
    team: r.config.teamNumber,
    enabled: r.enabled,
    exempt: r.isClimbing || r.tippedOver,
    x: p.x,
    y: p.y,
    halfLength: r.footprint.length / 2,
    speed: r.speed,
    turn: Math.abs(r.body.angvel().y),
    commanded: Math.hypot(cmd.vx, cmd.vy),
    commandedTurn: Math.abs(cmd.omega),
    contacts: () => robotContacts(physics, r),
  };
}

/** Assess the fouls and show the live PINNING cue of one `PinTracker.updateRobots` result. */
export function reportPins(res: PinResult, ctx: Pick<SeasonContext, 'score' | 'toast' | 'robots' | 'cue'>, t: number): void {
  const robot = (a: PinAgent) => ctx.robots.find((r) => r.id === a.id)!;
  for (const f of res.fouls) {
    const pts = ctx.score.foulValues[f.kind];
    ctx.score.foul({ t, alliance: f.pinner.alliance, kind: f.kind, rule: f.rule, robotId: f.pinner.id, note: `pinned ${f.pinned.team}` });
    ctx.toast(
      `${f.rule} ${f.kind === 'major' ? 'MAJOR' : 'MINOR'} FOUL · ${f.pinner.team} pinned ${f.pinned.team} for ${Math.floor(f.seconds)} s · +${pts} ${opponent(f.pinner.alliance).toUpperCase()}`,
      'foul',
      f.pinner.alliance,
    );
  }
  for (const c of res.cues) {
    const left = Math.max(0, c.limit - (c.seconds % c.limit));
    const danger = c.fouls > 0 || c.seconds >= c.limit * PIN_DANGER;
    ctx.cue?.(robot(c.pinner), `PINNING ${c.pinned.team} · ${c.fouls > 0 ? 'FOUL · RELEASE NOW' : `${left.toFixed(1)} s · back off`}`, danger ? 'pin danger' : 'pin');
  }
}
