import { captureFields, restoreFields } from '@engine/net/recovery';
import * as THREE from 'three';
import { colliderTouchesBody } from '@engine/physics/contacts';
import { ALLIANCES, type Alliance, type FieldPoint } from '@engine/coords';
import type { MatchResults, SeasonContext, SeasonRules } from '@engine/core/season';
import type { PeriodChange } from '@engine/match/clock';
import { PIN_SEPARATION, PinTracker, reportPins } from '@engine/match/pinning';
import { Referee } from '@engine/match/referee';
import type { AimTarget, Robot, RobotCommand } from '@engine/robot/robot';
import { groundSideSign } from '@engine/robot/config';
import { convexOverlap, pointInPolygon } from '@engine/zones';
import { clamp, inch, wrapAngle } from '@engine/units';
import {
  BUBBLE_RADIUS, CLIMB_CLEARANCE, COLORS, FIELD_LENGTH, FIELD_WIDTH, MAX_EXTENSION, PANEL_RADIUS, TOWER_HEIGHT_LIMIT,
  legalPossession, pieceIdentity, type PieceKind,
} from './constants';
import { heroClass, legalClimbLevel, preloads, storage } from './config';
import {
  BLOCK_HALF, CHUTE, CX, DISTRICTS, LAUNCH_ZONES, PAD_Y, PANEL_SLOT_Z, ROLLER_CAPTURE, STAGED_BUBBLES, STAGED_PANELS, collectorZone, homeZone, inCityBlock,
  mirrorX, panelCenterAt, panelSlotX, towerZone, trussX, type District, type Mailbox, type Vec3,
} from './geometry';
import type { HeroFieldRefs } from './field';
import { DistrictOwnership, levelOf, type OwnershipSnapshot } from './ownership';
import { panelGeometry } from './pieces';
import { heroHeistResults, towerPoints } from './scoring';

/** Placement mechanism: `extend` raises/extends the end effector toward a MAILBOX; it is judged when it arrives. */
export interface PlaceState { phase: 'idle' | 'extend'; t: number; district: number; wait: number; noise: number; lift: number; reach: number }
interface Insertion { piece: number; district: number; robotId: number; t: number; from: [number, number, number]; fromQ: [number, number, number, number] }
export interface HeroNetState {
  own: OwnershipSnapshot;
  panels: [number, number[]][];
  place: [number, PlaceState][];
  inserts: Insertion[];
  tilt: [number, number][];
  forcedHigh: number[];
  noEndgame: number[];
  exited: number[];
  targets: [number, number][];
  chute?: [boolean, boolean];
}

const kindOf = (i: number): PieceKind => pieceIdentity(i).kind;
const colorOf = (i: number): Alliance => pieceIdentity(i).color;
const dc = (a: Alliance, kind: PieceKind) => `dc:${a}:${kind}`;
const BUBBLES = 60;
/** Seconds the rollers take to draw a captured panel in, and a FOOTHILL basket to tip back and return [EST]. */
const INSERT_SECONDS = 0.35;
const TILT_SECONDS = 1.2;
/** Mailbox tier: slits 1, low baskets 2, high baskets 3 (config.ts MAILBOX_TIER_TOP). */
export const mailboxTier = (m: Mailbox) => (m.family !== 'top' ? 1 : m.entry.z > 1.5 ? 3 : 2);
/** Horizontal reach past the wall face the panel's leading edge needs to be taken by the rollers / drop in. */
const faceReach = (m: Mailbox) => (m.family === 'diagonal' ? 0.09 + ROLLER_CAPTURE * Math.SQRT1_2 : m.family === 'horizontal' ? ROLLER_CAPTURE : 0.06);

export class HeroHeistRules implements SeasonRules {
  recoveryState() {
    return { visible: this.netState(), fields: captureFields(this, 'preferredBlock plannedMailbox launchedBy contactKeys towerHigh trussContact notices passPrev hpTimer hpQueue chuteLane towerAssessed simTime passThrough'.split(' ')),
      ref: this.ref.recoveryState(), pins: this.pins.recoveryState() };
  }
  restoreRecovery(state: unknown): void {
    const s = state as ReturnType<HeroHeistRules['recoveryState']>;
    this.applyNetState(s.visible);
    restoreFields(this, 'preferredBlock plannedMailbox launchedBy contactKeys towerHigh trussContact notices passPrev hpTimer hpQueue chuteLane towerAssessed simTime passThrough'.split(' '), s.fields);
    this.ref.restoreRecovery(s.ref);
    this.pins.restoreRecovery(s.pins);
  }

  readonly handlesIntake = true;
  readonly ownership = new DistrictOwnership();
  /** STORY PANELS held per robot (SPEECH BUBBLES live in `robot.held`, the generic launcher's hopper). */
  readonly panels = new Map<number, number[]>();
  readonly place = new Map<number, PlaceState>();
  readonly inserts: Insertion[] = [];
  /** FOOTHILL baskets tipping back (district → seconds into the tilt). */
  readonly tilt = new Map<number, number>();
  /** Robots awarded a HIGH CLIMB by G14 contact in their TOWER ZONE during the last 20 s. */
  readonly forcedHigh = new Set<number>();
  /** Robots that lose ENDGAME points (G18 above 78 in or G20 TOWER contact during the last 20 s). */
  readonly noEndgame = new Set<number>();
  /** Robots whose bumpers fully left their TOWER ZONE during AUTO (T01-D). */
  readonly exited = new Set<number>();
  /** Bubble target per robot (district id) and a bot's preferred target / mailbox. */
  readonly targets = new Map<number, number>();
  readonly preferredBlock = new Map<number, number>();
  readonly plannedMailbox = new Map<number, number>();
  readonly ref: Referee;
  private readonly pins = new PinTracker({ rule: 'G11', countSeconds: 3, separation: PIN_SEPARATION, kind: 'major' });
  private readonly launchedBy = new Map<number, { robotId: number; at: number }>();
  private readonly contactKeys = new Set<string>();
  private readonly towerHigh = new Set<number>();
  private readonly trussContact = new Set<number>();
  private readonly notices = new Map<number, number>();
  private readonly passPrev = new Map<number, boolean>();
  private hpTimer: Record<Alliance, { bubble: number; panel: number }> = { blue: { bubble: 0, panel: 0 }, red: { bubble: 0, panel: 0 } };
  private hpQueue: Record<Alliance, { bubble: number; panel: number }> = { blue: { bubble: 0, panel: 0 }, red: { bubble: 0, panel: 0 } };
  /** H opens the bubble chute: the human player keeps rolling SPEECH BUBBLES out until H again or the stock runs out. */
  readonly chuteOpen: Record<Alliance, boolean> = { red: false, blue: false };
  private chuteLane: Record<Alliance, number> = { red: 0, blue: 0 };
  private towerAssessed = false;
  private simTime = 0;
  private readonly passThrough = new Map<number, number>();
  // Visuals
  private readonly panelGeo = panelGeometry();
  private readonly panelMats: Record<Alliance, THREE.MeshStandardMaterial> = { red: new THREE.MeshStandardMaterial({ color: COLORS.red, roughness: 0.6 }), blue: new THREE.MeshStandardMaterial({ color: COLORS.blue, roughness: 0.6 }) };
  private readonly heldMeshes = new Map<number, THREE.Mesh[]>();
  private readonly carriages = new Map<number, THREE.Group>();
  private readonly insertMeshes: THREE.Mesh[] = [];
  /** Pulsing frame around the CITY BLOCK the driver on this screen is aiming at (drawn over walls). */
  private readonly targetMarker = targetFrame();
  private readonly tmpV = new THREE.Vector3();

  constructor(readonly ctx: SeasonContext, readonly refs: HeroFieldRefs) {
    this.ref = new Referee(ctx, { tip: 'G09', collusion: 'G12', labels: { minor: 'FOUL', major: 'TECHNICAL FOUL' } });
    // The pool draws panels with the CAD's open rim, spokes and knob.
    for (const k of [2, 3]) { ctx.pool.meshes[k].geometry.dispose(); ctx.pool.meshes[k].geometry = this.panelGeo; }
    refs.pieces.add(this.targetMarker.group);
    for (const robot of ctx.robots) {
      this.place.set(robot.id, { phase: 'idle', t: 0, district: -1, wait: 0, noise: 0, lift: 0.35, reach: 0 });
      if (!robot.config.placement?.enabled) continue;
      const carriage = new THREE.Group();
      carriage.name = 'hero-panel-carriage';
      const alu = new THREE.MeshStandardMaterial({ color: 0xbdc6d0, metalness: 0.7, roughness: 0.4 });
      const plate = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.04, 0.5), alu);
      plate.name = 'hero-carriage-plate';
      carriage.add(plate);
      robot.visual.add(carriage);
      this.carriages.set(robot.id, carriage);
      const meshes: THREE.Mesh[] = [];
      for (let k = 0; k < storage(robot.config).panels; k++) {
        const m = new THREE.Mesh(this.panelGeo, this.panelMats.red);
        m.castShadow = true;
        m.visible = false;
        carriage.add(m);
        meshes.push(m);
      }
      this.heldMeshes.set(robot.id, meshes);
    }
  }

  // ─────────────────────────── staging ───────────────────────────

  stage(): void {
    const { pool, robots } = this.ctx;
    this.ownership.restore({ districts: Array.from({ length: 20 }, () => ({ support: null, strength: 0 })), autoFull: { red: [], blue: [] }, partialHistory: { red: [], blue: [] }, fullHistory: { red: [], blue: [] } });
    for (const s of [this.panels, this.targets, this.preferredBlock, this.plannedMailbox, this.tilt, this.launchedBy, this.notices, this.passPrev, this.passThrough]) (s as Map<unknown, unknown>).clear();
    for (const s of [this.forcedHigh, this.noEndgame, this.exited, this.contactKeys, this.towerHigh, this.trussContact]) s.clear();
    this.inserts.length = 0;
    this.pins.reset(); this.ref.reset();
    this.towerAssessed = false;
    this.hpTimer = { blue: { bubble: 0, panel: 0 }, red: { bubble: 0, panel: 0 } };
    this.hpQueue = { blue: { bubble: 0, panel: 0 }, red: { bubble: 0, panel: 0 } };
    this.chuteOpen.red = this.chuteOpen.blue = false;
    for (const [id] of this.place) this.place.set(id, { phase: 'idle', t: 0, district: -1, wait: 0, noise: 0, lift: 0.35, reach: 0 });
    for (let i = 0; i < pool.count; i++) pool.reserve(i, dc(colorOf(i), kindOf(i)));
    for (const r of robots) { r.held.length = 0; this.panels.set(r.id, []); }
    for (const a of ALLIANCES) {
      const bubbles = pool.indices('reserve', dc(a, 'bubble'));
      const panels = pool.indices('reserve', dc(a, 'panel'));
      // Manual p. 9-10: 15 bubbles in a 3 × 5 grid and 5 panels along the SQUAD WALL; preloads come from the stock.
      STAGED_BUBBLES[a].forEach(([x, y], k) => pool.placeField(bubbles[k], x, y));
      STAGED_PANELS[a].forEach(([x, y], k) => pool.placeField(panels[k], x, y));
      let b = 15, p = 5;
      for (const r of robots.filter(r => r.alliance === a)) {
        const pre = preloads(r.config);
        for (let k = 0; k < pre.bubbles && b < bubbles.length; k++) { pool.hold(bubbles[b], r.id); r.held.push(bubbles[b++]); }
        for (let k = 0; k < pre.panels && p < panels.length; k++) { pool.hold(panels[p], r.id); this.panels.get(r.id)!.push(panels[p++]); }
      }
    }
    this.updateOwnershipScore();
  }

  // ─────────────────────────── inventory ───────────────────────────

  panelCount(r: Robot): number { return this.panels.get(r.id)?.length ?? 0; }
  bubbleCount(r: Robot): number { return r.held.length; }

  /** G15 / class table and the build's own storage: may this robot take one more piece of `kind`? */
  canTake(r: Robot, kind: PieceKind): boolean {
    const p = this.panelCount(r) + (kind === 'panel' ? 1 : 0), b = r.held.length + (kind === 'bubble' ? 1 : 0);
    const cap = storage(r.config);
    if (p > cap.panels || b > cap.bubbles) return false;
    if (r.config.options?.sharedTool && p > 0 && b > 0) return false;
    return legalPossession(heroClass(r.config), p, b);
  }

  /** A `dualSideIntake` build (Mantis, Multiclass) has a second physical floor mouth on the face opposite its main one. */
  private oppositeSideMouth(r: Robot, w: {x:number;y:number;z:number}, radius: number): boolean {
    const c=r.config;
    if (!c.options?.dualSideIntake) return false;
    const {f,l}=r.toLocal(w), yaw=c.intake.groundYaw, fp=r.footprint;
    const along=yaw===undefined?-groundSideSign(c)*f:-(f*Math.cos(yaw)+l*Math.sin(yaw));
    const across=yaw===undefined?l:-f*Math.sin(yaw)+l*Math.cos(yaw);
    const edge=yaw===undefined?fp.length/2:(Math.abs(Math.cos(yaw))*fp.length+Math.abs(Math.sin(yaw))*fp.width)/2;
    const out=along-edge;
    return out > -.06 && out < c.intake.reach+radius && Math.abs(across)<c.intake.width/2;
  }

  private intake(): void {
    const { pool, frame, robots } = this.ctx;
    const wanting = robots.filter(r => r.enabled && r.lastCommand.intake && r.config.intake.enabled && !r.isClimbing && !r.tippedOver && (this.canTake(r, 'bubble') || this.canTake(r, 'panel')));
    if (!wanting.length) return;
    for (let i = 0; i < pool.count; i++) {
      if (pool.state[i] !== 'field' || this.passThrough.has(i)) continue;
      const w = pool.position(i);
      const f = frame.toField(w);
      for (const r of wanting) {
        const rp = r.pose;
        if (Math.abs(f.x - rp.x) > 1.3 || Math.abs(f.y - rp.y) > 1.3 || r.justLaunched(i)) continue;
        const kind = kindOf(i);
        if (!this.canTake(r, kind)) continue;
        const radius = kind === 'bubble' ? BUBBLE_RADIUS : 0.12;
        const ground = r.config.intake.ground !== false && (kind === 'bubble' || r.config.options?.groundPanels !== false) && f.z <= (kind === 'bubble' ? 0.3 : 0.1) && (r.groundMouthContains(w, radius) || this.oppositeSideMouth(r,w,radius));
        const station = !!r.config.intake.station && r.stationContains(w, radius, 0.2);
        if (!ground && !station) continue;
        if (robots.some(o => o !== r && o.shieldsPiece(w, radius))) continue;
        pool.hold(i, r.id);
        if (kind === 'bubble') { r.noteCapture(w); r.held.push(i); }
        else this.panels.get(r.id)!.push(i);
        break;
      }
    }
  }

  // ─────────────────────────── SPEECH BUBBLES: targets and launching ───────────────────────────

  private blockValue(a: Alliance, d: District): number {
    const s = this.ownership.districts[d.id];
    const lvl = levelOf(s);
    if (lvl !== 'neutral') return s.support === a ? 3 : 0.8;
    return s.support === a ? 2 : 1;
  }

  /** Is district `id` on this robot's driver's screen? (Bots and tests send no view: everything counts.) */
  inView(r: Robot, id: number): boolean {
    const mask = r.lastCommand.aimVisible;
    return mask === undefined || (mask & (1 << id)) !== 0;
  }

  /** Is this target the driver's manual pick (vs automatic)? */
  manualTarget(r: Robot): boolean { return (r.lastCommand.aimTarget ?? -1) >= 0; }

  /** Can a bubble physically reach this CITY BLOCK from where the robot stands (in range, from the front of a window)? */
  shotPossible(r: Robot, d: District): boolean {
    const p = r.pose, c = d.cityBlock.center;
    const dx = c.x - p.x, dy = c.y - p.y, dist = Math.hypot(dx, dy);
    if (dist < 1.1 || dist > 6.5) return false;
    if (d.region === 'west' || d.region === 'east') return (-dx * d.cityBlock.normal.x - dy * d.cityBlock.normal.y) / dist > Math.cos((55 * Math.PI) / 180);
    if (d.region === 'uptown') return dy > 0.5 && Math.abs(dx) / dist < 0.92;
    return dy < -0.4;
  }

  /** The CITY BLOCK this robot aims at: a bot's choice, else the best one in range (turret) or nearest the heading (chassis). */
  targetFor(r: Robot): District | null {
    if (!r.config.launcher.enabled) return null;
    // The driver picked a CITY BLOCK by hand (`,` / `.`): aim there even if it is a long or awkward shot.
    const picked = r.lastCommand.aimTarget;
    if (picked !== undefined && picked >= 0 && DISTRICTS[picked] && this.inView(r, picked)) { this.targets.set(r.id, picked); return DISTRICTS[picked]; }
    const pref = this.preferredBlock.get(r.id);
    if (pref !== undefined && this.shotPossible(r, DISTRICTS[pref])) { this.targets.set(r.id, pref); return DISTRICTS[pref]; }
    // Like a driver's target selection, the target stays locked while the trigger is held and the shot stays possible.
    const locked = this.targets.get(r.id);
    if (locked !== undefined && r.lastCommand.shoot && this.inView(r, locked) && this.shotPossible(r, DISTRICTS[locked])) return DISTRICTS[locked];
    const p = r.pose;
    const score = (d: District) => {
      const c = d.cityBlock.center, dist = Math.hypot(c.x - p.x, c.y - p.y);
      const value = this.blockValue(r.alliance, d);
      if (r.config.launcher.turret) return value - 0.12 * dist;
      const off = Math.abs(wrapAngle(Math.atan2(c.y - p.y, c.x - p.x) - p.yaw));
      return value * 0.25 - off * 2 - 0.04 * dist;
    };
    let best: District | null = null, bestScore = -Infinity;
    for (const d of DISTRICTS) {
      if (!this.inView(r, d.id) || !this.shotPossible(r, d)) continue;
      const s = score(d);
      if (s > bestScore) { bestScore = s; best = d; }
    }
    const prev = this.targets.get(r.id);
    if (prev !== undefined && best && prev !== best.id && this.inView(r, prev) && this.shotPossible(r, DISTRICTS[prev]) && score(DISTRICTS[prev]) > bestScore - 0.25) best = DISTRICTS[prev];
    if (best) this.targets.set(r.id, best.id); else this.targets.delete(r.id);
    return best;
  }

  aimTarget(r: Robot): AimTarget | null {
    if (r.held.length === 0) return null;
    const d = this.targetFor(r);
    return d ? this.aimFor(d) : null;
  }

  /** Flight goal for a CITY BLOCK: through the middle of the window, clearing its front lip. */
  aimFor(d: District): AimTarget {
    const b = d.cityBlock, c = b.center, n = b.normal;
    const inside = { x: c.x - n.x * 0.06, y: c.y - n.y * 0.06, z: c.z - n.z * 0.06 };
    const point = this.ctx.frame.toWorld(inside.x, inside.y, inside.z);
    if (d.region === 'uptown') return { point, clearances: [{ distance: 0.2, height: 1.52 + BUBBLE_RADIUS + 0.03 }], preferredAngle: 0.7 };
    if (d.region === 'downtown') return { point, clearances: [{ distance: 0.24, height: c.z + BUBBLE_RADIUS + 0.02 }], preferredAngle: 0.85 };
    // A FOOTHILL funnel is a vertical window: enter level or gently descending, under its top edge.
    return { point, allowRising: true, minEntryAngle: -0.55, clearances: [{ distance: 0.1, height: c.z - b.half + BUBBLE_RADIUS + 0.02 }], ceilings: [{ distance: 0.1, height: c.z + b.half - BUBBLE_RADIUS - 0.02 }] };
  }

  /** G21: all of the bumpers inside the LAUNCH ZONE (union of its three taped regions). */
  fullyInLaunchZone(r: Robot): boolean {
    const c = r.corners();
    const pts: FieldPoint[] = [...c, ...c.map((p, k) => ({ x: (p.x + c[(k + 1) % 4].x) / 2, y: (p.y + c[(k + 1) % 4].y) / 2 }))];
    return pts.every(p => LAUNCH_ZONES.some(z => pointInPolygon(p, z)));
  }

  onLaunch(robot: Robot, i: number): void {
    this.launchedBy.set(i, { robotId: robot.id, at: this.ctx.clock.elapsed });
    this.ctx.score.tally(robot.id, 'shots');
    if (this.live() && !this.fullyInLaunchZone(robot)) this.ref.call({ rule: 'G21', kind: 'minor', robot, note: 'launched a SPEECH BUBBLE from outside the LAUNCH ZONE' });
  }

  // ─────────────────────────── STORY PANELS: placement ───────────────────────────

  private tell(robot: Robot, message: string): void {
    const now = this.simTime;
    if (now < (this.notices.get(robot.id) ?? -1)) return;
    this.notices.set(robot.id, now + 2);
    this.ctx.toast(message, 'info', robot.alliance, robot);
  }

  /** Where a robot is relative to a MAILBOX: heading error, lateral offset along the slit, bumper gap to the face. */
  mailboxError(r: Robot, m: Mailbox): { yaw: number; lateral: number; gap: number } {
    const p = r.pose;
    const ax = Math.hypot(m.axis.x, m.axis.y) || 1;
    const lateral = ((p.x - m.entry.x) * m.axis.x + (p.y - m.entry.y) * m.axis.y) / ax;
    const gap = (m.face.x - p.x) * Math.cos(m.yaw) + (m.face.y - p.y) * Math.sin(m.yaw) - r.footprint.length / 2;
    return { yaw: wrapAngle(p.yaw - m.yaw), lateral, gap };
  }

  /** Largest bumper-to-face gap from which the panel's leading edge still reaches the rollers within 18 in (G08). */
  maxGap(r: Robot, m: Mailbox): number { return MAX_EXTENSION - r.config.bumperThickness - faceReach(m); }

  /** Alignment tolerance: the slit is only ~1 in wider than the panel (CAD 0.65 m vs 24 in) plus chamfer compliance. */
  static tolerance(m: Mailbox): { lateral: number; yaw: number } { return { lateral: (m.width - 2 * PANEL_RADIUS) / 2 + 0.015, yaw: 0.07 }; }

  /**
   * MAILBOX this robot is lined up on (or approaching): a bot's planned one first, then the nearest one its lift
   * reaches. The low and high baskets of a FOOTHILL column share one approach: the one where a panel does the most
   * (strip the opponent, then claim, then finish our own) wins, the scarce high basket on a tie.
   */
  placementTarget(r: Robot, range = 1.2): District | null {
    const planned = this.plannedMailbox.get(r.id);
    const reach = r.config.placement?.maxLevel ?? 0;
    let best: District | null = null, bd = Infinity, unreachable: District | null = null;
    for (const d of DISTRICTS) {
      const e = this.mailboxError(r, d.mailbox);
      if (e.gap > range || e.gap < -0.25 || Math.abs(e.lateral) > 0.6 || Math.abs(e.yaw) > 1.0) continue;
      if (mailboxTier(d.mailbox) > reach) { unreachable ??= d; continue; }
      const s = this.ownership.districts[d.id], lvl = levelOf(s);
      const value = s.support && s.support !== r.alliance && lvl !== 'neutral' ? 0 : s.support === r.alliance && lvl === 'full' ? 0.6 : s.support === r.alliance ? 0.2 : 0.1;
      const cost = (d.id === planned ? -10 : 0) + e.gap + Math.abs(e.lateral) * 2 + Math.abs(e.yaw) + value - mailboxTier(d.mailbox) * 0.01;
      if (cost < bd) { bd = cost; best = d; }
    }
    return best ?? unreachable;
  }

  /** Robot pose squared on a MAILBOX slit, `lateral` m along the slit, bumpers `gap` m from the wall face. */
  alignPose(r: Robot, d: District, lateral = 0, gap = 0.02): { x: number; y: number; yaw: number } {
    const m = d.mailbox;
    const ax = Math.hypot(m.axis.x, m.axis.y) || 1, ux = m.axis.x / ax, uy = m.axis.y / ax;
    const fx = Math.cos(m.yaw), fy = Math.sin(m.yaw);
    const depth = (m.face.x - m.entry.x) * fx + (m.face.y - m.entry.y) * fy - r.footprint.length / 2 - gap;
    return { x: m.entry.x + ux * lateral + fx * depth, y: m.entry.y + uy * lateral + fy * depth, yaw: m.yaw };
  }

  /** Placement auto-align (vision assist option): servo square onto the slot while the PLACE button is held. */
  adjustCommand(r: Robot, cmd: RobotCommand, _dt: number): RobotCommand {
    const st = this.place.get(r.id);
    if (!st || !cmd.pass || this.panelCount(r) === 0 || r.isClimbing || r.config.options?.placeAlign === false) return cmd;
    if (st.phase === 'extend') return { ...cmd, vx: 0, vy: 0, omega: 0 };
    const d = this.placementTarget(r, 1.6);
    if (!d || mailboxTier(d.mailbox) > (r.config.placement?.maxLevel ?? 0)) return cmd;
    const m = d.mailbox;
    // Square on the slit: lateral offset = the vision noise of this attempt, bumpers just off the wall face.
    const t = this.alignPose(r, d, st.noise, Math.min(0.03, this.maxGap(r, m) * 0.3));
    const p = r.pose, dx = t.x - p.x, dy = t.y - p.y, dist = Math.hypot(dx, dy);
    const speed = Math.min(1.5, r.config.maxSpeed, dist * 4 + 0.03);
    return { ...cmd, vx: dist > 0.003 ? (dx / dist) * speed : 0, vy: dist > 0.003 ? (dy / dist) * speed : 0, omega: clamp(wrapAngle(m.yaw - p.yaw) * 6, -r.config.maxOmega, r.config.maxOmega) };
  }

  handleMechanisms(r: Robot, cmd: RobotCommand, dt: number): boolean {
    // The engine only advances a model's shooter joints for seasons without this hook: the launcher waits on them.
    r.advanceScoringMechanisms(dt);
    const st = this.place.get(r.id)!;
    const pressed = cmd.pass && !this.passPrev.get(r.id);
    this.passPrev.set(r.id, cmd.pass);
    if (st.phase === 'extend') { this.advancePlacement(r, st, dt); return true; }
    if (!cmd.pass || cmd.shoot) return false;
    if (this.panelCount(r) === 0) { if (pressed) this.tell(r, r.config.placement?.enabled ? 'No STORY PANEL to deliver' : 'This robot has no panel mechanism'); return true; }
    if (r.isClimbing) return true;
    const d = this.placementTarget(r);
    if (!d) { if (pressed) this.tell(r, 'Drive up to a MAILBOX (G = place panel)'); return true; }
    const tier = mailboxTier(d.mailbox), reach = r.config.placement?.maxLevel ?? 0;
    if (tier > reach) { if (pressed) this.tell(r, `${d.label}: the basket is too high for this lift`); return true; }
    const e = this.mailboxError(r, d.mailbox);
    const assisted = r.config.options?.placeAlign !== false;
    if (assisted) {
      // The assist servos onto the slot; extend once lined up (or after 1.5 s of trying).
      if (st.wait === 0) st.noise = this.ctx.rng.gauss(0, inch(0.45));
      st.wait += dt;
      const ready = Math.abs(e.lateral - st.noise) < 0.006 && Math.abs(e.yaw) < 0.012 && e.gap <= this.maxGap(r, d.mailbox) && e.gap > -0.04;
      if (!ready && st.wait < 1.5) return true;
    } else if (e.gap > this.maxGap(r, d.mailbox) + 0.25) { if (pressed) this.tell(r, `Get closer to ${d.label}`); return true; }
    st.phase = 'extend'; st.t = 0; st.district = d.id; st.wait = 0;
    return true;
  }

  /** Panel center height and forward reach the end effector needs for this MAILBOX (robot frame). */
  private effectorFor(r: Robot, d: District): { lift: number; reach: number } {
    const c = panelCenterAt(d.mailbox, 0);
    const e = this.mailboxError(r, d.mailbox);
    return { lift: c.z, reach: r.footprint.length / 2 + Math.max(0, e.gap) + faceReach(d.mailbox) - PANEL_RADIUS * (d.mailbox.family === 'top' ? 0 : 1) };
  }

  private advancePlacement(r: Robot, st: PlaceState, dt: number): void {
    const d = DISTRICTS[st.district];
    const want = this.effectorFor(r, d);
    const cycle = Math.max(0.25, r.config.placement?.cycleSeconds ?? 0.8);
    st.t += dt;
    const k = clamp(st.t / cycle, 0, 1);
    st.lift = 0.35 + (want.lift - 0.35) * k;
    st.reach = want.reach * k;
    if (st.t < cycle) return;
    // Judge the insertion where the robot actually is now: a misaligned panel hits the wall beside the slit and drops.
    const e = this.mailboxError(r, d.mailbox), tol = HeroHeistRules.tolerance(d.mailbox);
    const ok = Math.abs(e.lateral) <= tol.lateral && Math.abs(e.yaw) <= tol.yaw && e.gap <= this.maxGap(r, d.mailbox) && e.gap >= -0.05 && !r.tippedOver;
    const list = this.panels.get(r.id)!;
    const piece = list.shift();
    st.phase = 'idle'; st.t = 0;
    if (piece === undefined) return;
    const pose = this.panelWorldPose(r, d);
    if (ok) {
      this.ctx.pool.reserve(piece, `insert:${d.id}`);
      this.inserts.push({ piece, district: d.id, robotId: r.id, t: 0, from: [pose.p.x, pose.p.y, pose.p.z], fromQ: [pose.q.x, pose.q.y, pose.q.z, pose.q.w] });
      this.ctx.score.tally(r.id, 'panelsPlaced');
    } else {
      const off = Math.abs(e.lateral) > tol.lateral ? `${(Math.abs(e.lateral) / 0.0254).toFixed(1)} in ${e.lateral > 0 ? 'right' : 'left'} of the slit` : Math.abs(e.yaw) > tol.yaw ? `${Math.abs(e.yaw * 180 / Math.PI).toFixed(0)}° crooked` : 'too far from the wall';
      this.tell(r, `Missed ${d.label}: ${off}`);
      this.ctx.pool.placeWorld(piece, pose.p, this.ctx.frame.velToWorld(Math.cos(r.pose.yaw) * 0.3, Math.sin(r.pose.yaw) * 0.3, 0));
      this.ctx.pool.bodies[piece].setRotation({ x: pose.q.x, y: pose.q.y, z: pose.q.z, w: pose.q.w }, true);
      this.ctx.pool.setIgnoreRobots(piece, true);
      this.passThrough.set(piece, this.simTime + 0.5);
      this.launchedBy.set(piece, { robotId: r.id, at: this.ctx.clock.elapsed });
    }
  }

  /** World pose of the panel on the end effector as it reaches the slot (centered on its leading-edge insertion point). */
  private panelWorldPose(r: Robot, d: District): { p: THREE.Vector3; q: THREE.Quaternion } {
    const m = d.mailbox, e = this.mailboxError(r, m);
    // Slot target shifted by where the robot actually is (lateral / gap errors move the panel with the robot).
    const ax = Math.hypot(m.axis.x, m.axis.y) || 1;
    const c = panelCenterAt(m, 0);
    const fx = c.x + (m.axis.x / ax) * e.lateral, fy = c.y + (m.axis.y / ax) * e.lateral;
    return { p: this.ctx.frame.toWorld(fx, fy, c.z), q: panelQuat(this.ctx, m, r.pose.yaw - m.yaw) };
  }

  private advanceInsertions(dt: number): void {
    for (let k = this.inserts.length - 1; k >= 0; k--) {
      const ins = this.inserts[k];
      ins.t += dt;
      if (ins.t < INSERT_SECONDS) continue;
      this.inserts.splice(k, 1);
      this.capture(ins.piece, DISTRICTS[ins.district], ins.robotId);
    }
    for (const [d, t] of this.tilt) { if (t + dt >= TILT_SECONDS) this.tilt.delete(d); else this.tilt.set(d, t + dt); }
  }

  // ─────────────────────────── sensors and ownership ───────────────────────────

  private live(): boolean { const c = this.ctx.clock; return c.started && !c.finished; }

  private phase(): 'auto' | 'teleop' { return this.ctx.clock.current.id === 'auto' ? 'auto' : 'teleop'; }

  /** A piece passed a DISTRICT's exit sensor: price it on the pre-event state, update OWNERSHIP, return it to its squad. */
  capture(i: number, d: District, robotId?: number): void {
    const { pool, score } = this.ctx;
    const color = colorOf(i), kind = kindOf(i);
    pool.reserve(i, dc(color, kind));
    this.launchedBy.delete(i);
    if (kind === 'panel' && d.mailbox.family === 'top') this.tilt.set(d.id, 0);
    if (!this.live()) { score.inc(color, `${kind}Sensed`); return; }
    const before = levelOf(this.ownership.districts[d.id]), supportBefore = this.ownership.districts[d.id].support;
    const phase = this.phase();
    const { fame, bonus } = this.ownership.accept(d.id, color, kind, phase);
    const by = robotId !== undefined && this.ctx.robots.find(r => r.id === robotId)?.alliance === color ? robotId : undefined;
    const t = this.ctx.clock.elapsed;
    if (kind === 'bubble') score.add(color, phase === 'auto' ? 'autoBubbles' : 'teleopBubbles', fame, t, by);
    if (bonus) score.add(color, 'autoFull', bonus, t);
    score.inc(color, kind === 'bubble' ? 'bubbles' : 'panels');
    if (by !== undefined) score.tally(by, kind === 'bubble' ? 'bubblesScored' : 'panelsScored');
    this.updateOwnershipScore();
    const after = this.ownership.districts[d.id], lvl = levelOf(after);
    if (lvl !== before || (lvl !== 'neutral' && after.support !== supportBefore)) {
      const owner = after.support && lvl !== 'neutral' ? `${after.support.toUpperCase()} ${lvl === 'full' ? 'FULLY OWNS' : 'PARTIALLY OWNS'}` : 'NEUTRAL';
      this.ctx.toast(`${d.label} · ${owner}${bonus ? ' · AUTO bonus +10' : ''}`, 'good', after.support ?? color);
    }
  }

  private updateOwnershipScore(): void {
    for (const a of ALLIANCES) {
      this.ctx.score.set(a, 'ownership', this.ownership.points(a));
      this.ctx.score.counters[a].partialNow = this.ownership.count(a, 'partial');
      this.ctx.score.counters[a].fullNow = this.ownership.count(a, 'full');
      this.ctx.score.counters[a].partialEver = this.ownership.partialHistory[a].size;
      this.ctx.score.counters[a].fullEver = this.ownership.fullHistory[a].size;
    }
  }

  private senseBubbles(): void {
    const { pool, frame } = this.ctx;
    for (let i = 0; i < BUBBLES; i++) {
      if (pool.state[i] !== 'field') continue;
      const p = frame.toField(pool.position(i));
      let region: District['region'] | null = null;
      if (p.y > 7.75) region = 'uptown';
      else if (p.y < 0.5 && Math.abs(p.x - CX) < 3.8) region = 'downtown';
      if (p.y > 6.6 && p.x < 2.3) region = 'west';
      else if (p.y > 6.6 && p.x > FIELD_LENGTH - 2.3) region = 'east';
      if (!region) continue;
      for (const d of DISTRICTS) {
        if (d.region !== region || !inCityBlock(d.cityBlock, p as Vec3)) continue;
        this.capture(i, d, this.launchedBy.get(i)?.robotId);
        break;
      }
    }
  }

  /** Pieces that leave the FIELD go back to their squad's DISTRIBUTION CENTER (stock is conserved). */
  private returnStrays(): void {
    const { pool, frame } = this.ctx;
    for (let i = 0; i < pool.count; i++) {
      if (pool.state[i] !== 'field') continue;
      const p = frame.toField(pool.position(i));
      const behindFoothill = p.y > 6.5 && (p.x < 2 || p.x > FIELD_LENGTH - 2) && this.behindFoothill(p);
      if (p.x < -0.6 || p.x > FIELD_LENGTH + 0.6 || p.y < -0.45 || p.y > FIELD_WIDTH + 0.45 || p.z < -0.3 || behindFoothill) {
        pool.reserve(i, dc(colorOf(i), kindOf(i)));
        this.launchedBy.delete(i);
      }
    }
  }
  private behindFoothill(p: { x: number; y: number }): boolean {
    const blue = p.x < CX, x = blue ? p.x : FIELD_LENGTH - p.x;
    // Outward side of the line (0, 6.909)-(1.574, 8.23), by more than a bubble.
    return (x - 0) * (8.23 - 6.909) - (p.y - 6.909) * (1.574 - 0) < -0.25;
  }

  // ─────────────────────────── human players ───────────────────────────

  /**
   * H: open / close the bubble chute (like REBUILT's CHUTE door): bubbles stream out of the SQUAD WALL slot, spread
   * across its width, until closed or out of stock. B: slide one STORY PANEL out of the slot nearest your robot.
   */
  humanPlayerAction(a: Alliance, button = 1): void {
    if (!this.live() || this.ctx.clock.mode === 'disabled') return;
    if (button !== 2) {
      if (!this.chuteOpen[a] && this.ctx.pool.countIn('reserve', dc(a, 'bubble')) === 0) { this.ctx.toast('No SPEECH BUBBLES at the DISTRIBUTION CENTER', 'warn', a); return; }
      this.chuteOpen[a] = !this.chuteOpen[a];
      this.ctx.toast(`Human player: bubble chute ${this.chuteOpen[a] ? 'OPEN' : 'closed'} (H)`, 'info', a);
      return;
    }
    if (this.ctx.pool.countIn('reserve', dc(a, 'panel')) <= this.hpQueue[a].panel) { this.ctx.toast('No STORY PANELS at the DISTRIBUTION CENTER', 'warn', a); return; }
    this.hpQueue[a].panel++;
  }

  private feedHumanPlayers(dt: number): void {
    if (this.ctx.clock.mode === 'disabled') { this.hpQueue = { blue: { bubble: 0, panel: 0 }, red: { bubble: 0, panel: 0 } }; return; }
    for (const a of ALLIANCES) {
      const team = this.ctx.robots.filter(r => r.alliance === a);
      if (!team.length) continue;
      const t = this.hpTimer[a];
      t.bubble -= dt; t.panel -= dt;
      const auto = this.ctx.humanPlayerIsAuto(a);
      const chute = { x: mirrorX(a, 0.6), y: (CHUTE.y0 + CHUTE.y1) / 2 };
      const near = (r: Robot, q: { x: number; y: number }, d: number) => Math.hypot(r.pose.x - q.x, r.pose.y - q.y) < d;
      const bubbleRobot = team.find(r => r.lastCommand.intake && this.canTake(r, 'bubble') && near(r, chute, 1.9));
      if (this.chuteOpen[a] && t.bubble <= 0) {
        // Open chute: one bubble every 0.3 s, cycling across the slot so they don't stack up at one spot.
        if (this.feedBubble(a, null, this.chuteLane[a]++)) t.bubble = 0.3;
        if (this.ctx.pool.countIn('reserve', dc(a, 'bubble')) === 0) { this.chuteOpen[a] = false; this.ctx.toast('Bubble chute empty', 'info', a); }
      } else if (t.bubble <= 0 && auto && bubbleRobot && this.feedBubble(a, bubbleRobot)) t.bubble = 0.45;
      const slots = [0, 1, 2].map(k => ({ k, x: panelSlotX(a, k), y: 0.2 }));
      const panelRobot = team.find(r => r.lastCommand.intake && this.canTake(r, 'panel') && slots.some(s => near(r, s, 1.5)));
      if (t.panel <= 0 && (this.hpQueue[a].panel > 0 || (auto && panelRobot)) && this.feedPanel(a, panelRobot ?? (this.ctx.playerRobot?.alliance === a ? this.ctx.playerRobot : team[0]))) {
        if (this.hpQueue[a].panel > 0) this.hpQueue[a].panel--;
        t.panel = 0.9;
      }
    }
  }

  /** Physically roll a bubble out of the chute slot (z 0.77-0.98) toward the robot waiting below it. */
  feedBubble(a: Alliance, robot: Robot | null, lane?: number): boolean {
    const { pool, frame } = this.ctx;
    const i = pool.indices('reserve', dc(a, 'bubble'))[0];
    if (i === undefined) return false;
    const lanes = [0.25, 0.55, 0.85, 1.15];
    const y = clamp(lane !== undefined ? CHUTE.y0 + lanes[lane % lanes.length] - 0.1 : robot && robot.alliance === a ? robot.pose.y : (CHUTE.y0 + CHUTE.y1) / 2, CHUTE.y0 + 0.12, CHUTE.y1 - 0.12);
    const spawn = { x: mirrorX(a, -0.16), y, z: (CHUTE.z0 + CHUTE.z1) / 2 };
    const busy = pool.indices('field').some(k => k < BUBBLES && (() => { const q = frame.toField(pool.position(k)); return Math.abs(q.x - spawn.x) < 0.45 && Math.abs(q.y - y) < 0.25 && q.z > 0.5; })());
    if (busy) return false;
    pool.placeWorld(i, frame.toWorld(spawn.x, spawn.y, spawn.z), frame.velToWorld(a === 'blue' ? 1.8 : -1.8, 0, 0));
    return true;
  }

  /** Physically slide a panel out of the DISTRIBUTION CENTER slot nearest the robot (z 0.65, over the guardrail). */
  feedPanel(a: Alliance, robot: Robot | null): boolean {
    const { pool, frame } = this.ctx;
    const i = pool.indices('reserve', dc(a, 'panel'))[0];
    if (i === undefined) return false;
    let k = 1;
    if (robot) k = [0, 1, 2].reduce((best, s) => Math.abs(panelSlotX(a, s) - robot.pose.x) < Math.abs(panelSlotX(a, best) - robot.pose.x) ? s : best, 1);
    const x = panelSlotX(a, k);
    const busy = pool.indices('field').some(j => j >= BUBBLES && (() => { const q = frame.toField(pool.position(j)); return Math.abs(q.x - x) < 0.45 && q.y < 0.55 && q.z > 0.3; })());
    if (busy) return false;
    pool.placeWorld(i, frame.toWorld(x, -0.21, PANEL_SLOT_Z - 0.015), frame.velToWorld(0, 2.6, 0));
    return true;
  }

  // ─────────────────────────── TOWER ───────────────────────────

  /** CLIMB PAD this robot is under (its squad's tower), or null. */
  padUnder(r: Robot): number | null {
    const p = r.pose, tx = trussX(r.alliance);
    if (Math.abs(p.x - tx) > 0.35) return null;
    const k = PAD_Y.findIndex(y => Math.abs(p.y - y) < 0.4);
    return k < 0 ? null : k;
  }

  requestClimb(r: Robot, level: number): void {
    if (this.ctx.clock.mode !== 'teleop') { this.tell(r, 'Climb the TOWER in TELEOP'); return; }
    const pad = this.padUnder(r);
    if (pad === null) { this.tell(r, 'Drive under one of your squad TOWER\'s CLIMB PADS'); return; }
    if (this.ctx.robots.some(o => o !== r && o.alliance === r.alliance && o.isClimbing && o.climbSlot === pad)) { this.tell(r, 'That CLIMB PAD is taken'); return; }
    const lvl = Math.max(1, Math.min(level, r.config.climber.maxLevel, legalClimbLevel(r.config.height)));
    r.startClimb({ x: trussX(r.alliance), y: PAD_Y[pad], yaw: r.pose.yaw }, CLIMB_CLEARANCE[lvl] + 0.015, lvl, pad);
  }

  requestDescend(r: Robot): void { r.startDescend(); }

  /** Live TOWER level from where the robot hangs: only on the pad, bottom clearance 35 in / 45 in (manual p. 5). */
  towerLevel(r: Robot): number {
    if (!(r.climbPhase === 'rise' || r.climbPhase === 'hanging') || r.elevation < 0.02) return 0;
    return r.elevation >= inch(45) - 0.005 ? 3 : r.elevation >= inch(35) - 0.005 ? 2 : 1;
  }
  parked(r: Robot): boolean { return convexOverlap(r.corners(), towerZone(r.alliance)); }
  robotTowerPoints(r: Robot): number {
    return towerPoints(this.towerLevel(r), this.parked(r), this.noEndgame.has(r.id), this.forcedHigh.has(r.id));
  }

  private assessTower(): void {
    if (this.towerAssessed) return;
    this.towerAssessed = true;
    for (const a of ALLIANCES) {
      let total = 0;
      for (const r of this.ctx.robots.filter(r => r.alliance === a)) {
        const pts = this.robotTowerPoints(r);
        total += pts;
        this.ctx.score.setCredit(r.id, 'tower', pts);
      }
      this.ctx.score.set(a, 'tower', total);
    }
  }

  // ─────────────────────────── fouls ───────────────────────────

  private finalSeconds(): boolean { return this.ctx.clock.current.id === 'endgame' && this.ctx.clock.started && !this.ctx.clock.finished; }

  /** Highest point of the robot: chassis, a raised panel lift, or a hanging robot's body (G18, G19). */
  robotTop(r: Robot): number {
    const st = this.place.get(r.id);
    const lift = st && st.phase === 'extend' ? st.lift + PANEL_RADIUS : 0;
    return r.elevation + Math.max(r.config.height, lift);
  }

  private enforce(dt: number): void {
    const { robots, clock, physics } = this.ctx;
    if (clock.mode === 'disabled') return;
    this.ref.contacts.update(robots, physics, clock.elapsed);
    const live = new Set<string>();
    const final = this.finalSeconds();
    for (const r of robots) for (const o of robots) {
      if (r.alliance === o.alliance || !this.ref.touching(r, o)) continue;
      // G04: AUTO contact while across the CENTER LINE (the off-sides robot).
      const across = r.corners().every(p => (r.alliance === 'blue' ? p.x > CX + 0.05 : p.x < CX - 0.05));
      if (clock.mode === 'auto' && across) this.once(live, `G04:${r.id}:${o.id}`, () => this.ref.call({ rule: 'G04', kind: 'major', robot: r, note: `contacted ${o.config.teamNumber} across the CENTER LINE in AUTO` }));
      // G14: no contact with an opponent partly in its COLLECTOR or HOME ZONE (all match) or TOWER ZONE (last 20 s).
      const zone = (z: FieldPoint[]) => convexOverlap(o.corners(), z);
      const tower = final && zone(towerZone(o.alliance));
      if (tower || zone(collectorZone(o.alliance)) || zone(homeZone(o.alliance))) {
        this.once(live, `G14:${r.id}:${o.id}`, () => {
          this.ref.call({ rule: 'G14', kind: 'minor', robot: r, note: `contacted ${o.config.teamNumber} in its protected ${tower ? 'TOWER' : 'COLLECTOR/HOME'} ZONE${tower ? ' · HIGH CLIMB awarded' : ''}` });
          if (tower) this.forcedHigh.add(o.id);
        });
      }
    }
    this.contactKeys.clear(); for (const k of live) this.contactKeys.add(k);
    for (const r of robots) {
      // G18: nothing above 78 in inside a TOWER ZONE (either squad's).
      const inTower = ALLIANCES.some(a => convexOverlap(r.corners(), towerZone(a)));
      const high = inTower && this.robotTop(r) > TOWER_HEIGHT_LIMIT + 0.01;
      if (high && !this.towerHigh.has(r.id)) {
        this.ref.call({ rule: 'G18', kind: 'major', robot: r, note: 'extended above 78 in in a TOWER ZONE' });
        if (final) this.noEndgame.add(r.id);
      }
      if (high) this.towerHigh.add(r.id); else this.towerHigh.delete(r.id);
      // G20: only the CLIMB PADS may be touched; touching the truss in the last 20 s forfeits ENDGAME points.
      const touch = ALLIANCES.some(a => colliderTouchesBody(physics.world, this.refs.truss[a], r.body.handle));
      if (touch && final && !this.trussContact.has(r.id)) { this.noEndgame.add(r.id); this.ctx.toast(`G20 · ${r.config.teamNumber} touched the TOWER · no ENDGAME points`, 'foul', r.alliance); }
      if (touch) this.trussContact.add(r.id); else this.trussContact.delete(r.id);
      // T01-D: bumpers fully out of the TOWER ZONE during AUTO.
      if (clock.mode === 'auto' && !this.exited.has(r.id) && !convexOverlap(r.corners(), towerZone(r.alliance))) { this.exited.add(r.id); this.ctx.score.inc(r.alliance, 'autoLeave'); }
    }
    reportPins(this.pins.updateRobots(dt, robots, physics), this.ctx, clock.elapsed);
  }

  private once(live: Set<string>, key: string, call: () => void): void {
    live.add(key);
    if (!this.contactKeys.has(key)) call();
  }

  // ─────────────────────────── loop ───────────────────────────

  onPeriodChange(change: PeriodChange): void {
    if (change.from?.id === 'auto') this.preferredBlock.clear();
    // Robots are disabled after ENDGAME; the TOWER is assessed when the match ends (G03 settling cannot change it).
    if (change.from?.id === 'endgame' || !change.to) this.assessTower();
  }

  beforeStep(dt: number): void {
    this.simTime += dt;
    for (const [i, until] of this.passThrough) if (this.simTime >= until) { this.ctx.pool.setIgnoreRobots(i, false); this.passThrough.delete(i); }
    this.intake();
    if (this.live()) this.feedHumanPlayers(dt);
  }

  afterStep(dt: number): void {
    // Sensors run even outside a match (tests); points and fouls only during one.
    this.advanceInsertions(dt);
    this.senseBubbles();
    this.returnStrays();
    if (!this.live()) return;
    this.enforce(dt);
    if (this.ctx.clock.current.id === 'endgame' || this.ctx.clock.current.id === 'post') {
      // Live tower estimate for the HUD; final numbers are set by assessTower.
      if (!this.towerAssessed) for (const a of ALLIANCES) this.ctx.score.set(a, 'tower', this.ctx.robots.filter(r => r.alliance === a).reduce((s, r) => s + this.robotTowerPoints(r), 0));
    }
  }

  // ─────────────────────────── visuals ───────────────────────────

  updateVisuals(_dt: number, time: number): void {
    this.updateTargetMarker(time);
    const flash = this.ctx.clock.current.id === 'endgame' && Math.sin(time * 8) > 0.6;
    DISTRICTS.forEach((_d, id) => {
      const s = this.ownership.districts[id];
      this.refs.lights[id].forEach((mat, k) => {
        const lit = s.support !== null && k < s.strength;
        const col = lit ? (s.support === 'red' ? COLORS.red : COLORS.blue) : 0x2a2d33;
        mat.color.setHex(col);
        mat.emissive.setHex(lit ? col : 0x000000);
        mat.emissiveIntensity = lit ? (s.strength === 4 && flash ? 2.6 : 1.6) : 0;
      });
    });
    for (const [id, t] of [...this.tilt, ...DISTRICTS.filter(d => d.mailbox.family === 'top' && !this.tilt.has(d.id)).map(d => [d.id, -1] as [number, number])]) {
      const b = this.refs.baskets.get(id);
      if (!b) continue;
      const k = t < 0 ? 0 : Math.sin(Math.PI * clamp(t / TILT_SECONDS, 0, 1));
      b.object.quaternion.copy(b.rest).multiply(new THREE.Quaternion().setFromAxisAngle(b.axis, -0.5 * k));
    }
    const { robots, frame } = this.ctx;
    for (const r of robots) {
      const carriage = this.carriages.get(r.id);
      if (!carriage) continue;
      const st = this.place.get(r.id)!;
      const extending = st.phase === 'extend';
      const lift = extending ? st.lift : Math.min(r.config.height - 0.05, 0.45);
      const reach = extending ? st.reach : r.footprint.length / 2 - 0.15;
      // The archetype model's lift follows this pose; held panels ride its cradle (else this plain carriage).
      r.placeAnim = { height: lift, forward: reach, level: extending ? mailboxTier(DISTRICTS[st.district].mailbox) : 0 };
      const anchor = r.modelHeldAnchor;
      const plate = carriage.getObjectByName('hero-carriage-plate')!;
      if (anchor) {
        if (carriage.parent !== anchor) anchor.add(carriage);
        carriage.position.set(0, 0, 0);
        plate.visible = false;
      } else {
        carriage.position.set(Math.max(0.1, reach), lift, 0);
        plate.position.set(-0.05, 0, 0);
      }
      const meshes = this.heldMeshes.get(r.id)!;
      const held = this.panels.get(r.id) ?? [];
      meshes.forEach((m, k) => {
        m.visible = k < held.length;
        if (!m.visible) return;
        m.material = this.panelMats[colorOf(held[k])];
        if (k === 0 && extending) {
          const d = DISTRICTS[st.district];
          const q = panelQuat(this.ctx, d.mailbox, 0);
          r.visual.updateMatrixWorld(true);
          m.quaternion.copy(carriage.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(q));
          m.position.set(0, 0, 0);
        } else {
          m.quaternion.identity();
          m.position.set(-0.12 - PANEL_RADIUS * 0.4, -0.02 - k * 0.035, 0);
        }
      });
    }
    // Panels being drawn in by the rollers (or dropping into a FOOTHILL basket).
    while (this.insertMeshes.length < this.inserts.length) {
      const m = new THREE.Mesh(this.panelGeo, this.panelMats.red);
      m.castShadow = true;
      this.refs.pieces.add(m);
      this.insertMeshes.push(m);
    }
    this.insertMeshes.forEach((m, k) => {
      const ins = this.inserts[k];
      m.visible = !!ins;
      if (!ins) return;
      const d = DISTRICTS[ins.district], mb = d.mailbox;
      m.material = this.panelMats[colorOf(ins.piece)];
      const u = clamp(ins.t / INSERT_SECONDS, 0, 1);
      const depth = (ROLLER_CAPTURE + (mb.family === 'top' ? 0.35 : 0.4)) * u;
      const dir = frame.velToWorld(mb.dir.x, mb.dir.y, mb.dir.z, this.tmpV);
      m.position.set(ins.from[0] + dir.x * depth, ins.from[1] + dir.y * depth, ins.from[2] + dir.z * depth);
      m.quaternion.set(ins.fromQ[0], ins.fromQ[1], ins.fromQ[2], ins.fromQ[3]);
    });
  }

  private updateTargetMarker(time: number): void {
    const { group, set } = this.targetMarker;
    const p = this.ctx.playerRobot;
    const id = p ? this.targets.get(p.id) : undefined;
    const show = !!p && p.config.launcher.enabled && id !== undefined && (p.held.length > 0 || this.manualTarget(p));
    group.visible = show;
    if (!show) return;
    const b = DISTRICTS[id!].cityBlock, f = this.ctx.frame;
    f.toWorld(b.center.x + b.normal.x * 0.02, b.center.y + b.normal.y * 0.02, b.center.z + b.normal.z * 0.02, group.position);
    const w = (v: Vec3) => new THREE.Vector3(v.x, v.z, -v.y);
    group.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(w(b.u), w(b.v), w(b.normal)));
    const pulse = 1 + 0.06 * Math.sin(time * 6);
    group.scale.set(pulse, pulse, 1);
    set(this.shotPossible(p!, DISTRICTS[id!]) ? 0xffd21f : 0xff6a3d, 0.8 + 0.2 * Math.sin(time * 6));
  }

  results(): MatchResults {
    const participants = { red: this.ctx.robots.filter(r => r.alliance === 'red').length, blue: this.ctx.robots.filter(r => r.alliance === 'blue').length };
    return heroHeistResults(this.ctx.score, this.ownership, participants);
  }

  netState(): HeroNetState {
    return {
      own: this.ownership.snapshot(),
      panels: [...this.panels].map(([id, p]) => [id, [...p]]),
      place: [...this.place].map(([id, s]) => [id, { ...s }]),
      inserts: this.inserts.map(i => ({ ...i, from: [...i.from], fromQ: [...i.fromQ] })),
      tilt: [...this.tilt],
      forcedHigh: [...this.forcedHigh], noEndgame: [...this.noEndgame], exited: [...this.exited],
      targets: [...this.targets],
      chute: [this.chuteOpen.red, this.chuteOpen.blue],
    };
  }

  applyNetState(state: unknown): void {
    const s = state as HeroNetState;
    this.ownership.restore(s.own);
    this.panels.clear(); for (const [id, p] of s.panels) this.panels.set(id, [...p]);
    for (const [id, p] of s.place) this.place.set(id, { ...p });
    this.inserts.splice(0, this.inserts.length, ...s.inserts.map(i => ({ ...i })));
    this.tilt.clear(); for (const [d, t] of s.tilt) this.tilt.set(d, t);
    for (const [set, list] of [[this.forcedHigh, s.forcedHigh], [this.noEndgame, s.noEndgame], [this.exited, s.exited]] as const) { set.clear(); list.forEach(x => set.add(x)); }
    this.targets.clear(); for (const [id, d] of s.targets) this.targets.set(id, d);
    if (s.chute) { this.chuteOpen.red = s.chute[0]; this.chuteOpen.blue = s.chute[1]; }
  }
}

/** World orientation of a panel entering MAILBOX `m` (disc normal = slit axis × insertion direction), yawed by `skew`. */
function panelQuat(ctx: SeasonContext, m: Mailbox, skew: number): THREE.Quaternion {
  const n = { x: m.axis.y * m.dir.z - m.axis.z * m.dir.y, y: m.axis.z * m.dir.x - m.axis.x * m.dir.z, z: m.axis.x * m.dir.y - m.axis.y * m.dir.x };
  const w = ctx.frame.velToWorld(n.x, n.y, n.z).normalize();
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), w);
  if (skew) q.premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), skew));
  return q;
}

/** Square outline (in its local x/y plane) sized to a CITY BLOCK opening, drawn on top of the field. */
function targetFrame(): { group: THREE.Group; set(color: number, opacity: number): void } {
  const group = new THREE.Group();
  group.name = 'hero-target-marker';
  group.visible = false;
  group.renderOrder = 10;
  const mat = new THREE.MeshBasicMaterial({ color: 0xffd21f, transparent: true, opacity: 0.95, depthTest: false, depthWrite: false });
  const fill = new THREE.MeshBasicMaterial({ color: 0xffd21f, transparent: true, opacity: 0.18, depthTest: false, depthWrite: false, side: THREE.DoubleSide });
  const half = BLOCK_HALF + 0.07, t = 0.065;
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(2 * BLOCK_HALF, 2 * BLOCK_HALF), fill);
  glow.renderOrder = 9;
  group.add(glow);
  for (const [x, y, w, h] of [[0, half, 2 * half + t, t], [0, -half, 2 * half + t, t], [half, 0, t, 2 * half], [-half, 0, t, 2 * half]]) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.01), mat);
    bar.position.set(x, y, 0);
    bar.renderOrder = 10;
    group.add(bar);
  }
  // Corner ticks pointing out, so the frame reads at a distance.
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
    const tick = new THREE.Mesh(new THREE.BoxGeometry(0.16, t, 0.01), mat);
    tick.position.set(sx * (half + 0.08), sy * half, 0);
    tick.renderOrder = 10;
    group.add(tick);
  }
  return { group, set(color, opacity) { mat.color.setHex(color); fill.color.setHex(color); mat.opacity = opacity; fill.opacity = 0.1 + 0.12 * opacity; } };
}
