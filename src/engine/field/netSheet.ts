import * as THREE from 'three';
import type { FieldFrame } from '../coords';
import type { GamePiecePool } from '../gamepiece/pool';
import type { Vec3 } from './builder';

/** A rectangular net panel in FIELD coordinates: a corner and its two edges. */
export interface NetSheetSpec {
  origin: Vec3;
  u: Vec3;
  v: Vec3;
  /** A field point on the side pieces arrive from (the net bulges away from it). */
  front: Vec3;
  /** Knots across u and v, border included (the border is tied to the frame). */
  nu: number;
  nv: number;
  /** Parts of the rectangle that are net, in (0..1, 0..1) sheet coordinates (default: all of it). */
  inside?: (s: number, t: number) => boolean;
  /** Cord spacing for drawing (m). */
  cordSpacing: number;
  color?: number;
  name?: string;
  /** Deepest bulge (m) before the net is taut and stops a piece outright. */
  maxBulge?: number;
}

/** Wave speed across the net (m/s): how fast a dent spreads and springs back. */
const WAVE_SPEED = 3.2;
/** Knot velocity damping (1/s) and pull back to the flat net (1/s²). */
const DAMPING = 7;
const RESTORE = 30;
/** A piece pressing into the net feels a spring this stiff (1/s²) per metre of bulge and loses normal speed at this rate (1/s). */
const CONTACT_STIFFNESS = 600;
const CONTACT_DAMPING = 50; // about critical for the stiffness: a caught piece drops out of the net instead of springing back
/** Fraction of a piece's sliding speed the mesh grips away per second while in contact. */
const GRIP = 6;

/**
 * A flexible net (a goal's back net, a catch net) that bulges where pieces hit it and springs back. A grid of knots,
 * each displaced along the net's normal, moves as a damped membrane tied to its frame. A piece touching it pushes the
 * knots under it back and is slowed by the net's stretch, so shots are caught softly instead of bouncing off a wall.
 *
 * Authority: `step()` every physics step (it reads and pushes the pieces). Everyone: `syncVisual()` per frame. Replicas
 * receive the knot displacements with `netState()` / `applyNetState()`.
 */
export class NetSheet {
  /** Knot displacement behind the flat net (m) and its rate (m/s). */
  readonly d: Float32Array;
  private readonly w: Float32Array;
  private readonly pinned: Uint8Array;
  private readonly o = new THREE.Vector3();
  private readonly eu = new THREE.Vector3();
  private readonly ev = new THREE.Vector3();
  /** Normal pointing toward the front (the side pieces come from). */
  private readonly n = new THREE.Vector3();
  private readonly lu: number;
  private readonly lv: number;
  private readonly maxBulge: number;
  private readonly k: number;
  private readonly lines: THREE.LineSegments;
  /** Per drawn vertex: sheet coordinates (m along u, v). */
  private readonly vs: Float32Array;
  private readonly aabbMin = new THREE.Vector3();
  private readonly aabbMax = new THREE.Vector3();
  private awake = false;
  private drawnAwake = true;
  private readonly tmp = new THREE.Vector3();

  constructor(frame: FieldFrame, parent: THREE.Object3D, private readonly spec: NetSheetSpec) {
    const { nu, nv } = spec;
    this.d = new Float32Array(nu * nv);
    this.w = new Float32Array(nu * nv);
    this.pinned = new Uint8Array(nu * nv);
    frame.toWorld(...spec.origin, this.o);
    const pu = frame.toWorld(spec.origin[0] + spec.u[0], spec.origin[1] + spec.u[1], spec.origin[2] + spec.u[2]);
    const pv = frame.toWorld(spec.origin[0] + spec.v[0], spec.origin[1] + spec.v[1], spec.origin[2] + spec.v[2]);
    this.eu.subVectors(pu, this.o);
    this.ev.subVectors(pv, this.o);
    this.lu = this.eu.length();
    this.lv = this.ev.length();
    this.eu.normalize();
    this.ev.normalize();
    this.n.crossVectors(this.eu, this.ev).normalize();
    const f = frame.toWorld(...spec.front).sub(this.o);
    if (f.dot(this.n) < 0) this.n.negate();
    this.maxBulge = spec.maxBulge ?? 0.3;
    const spacing = Math.min(this.lu / (nu - 1), this.lv / (nv - 1));
    this.k = (WAVE_SPEED / spacing) ** 2;
    const inside = spec.inside;
    for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
      const s = i / (nu - 1), t = j / (nv - 1);
      const edge = i === 0 || j === 0 || i === nu - 1 || j === nv - 1;
      // Knots outside the net's outline (a triangular side net) are frame, tied like the border.
      const out = inside ? !inside(s, t) : false;
      this.pinned[j * nu + i] = edge || out ? 1 : 0;
    }
    // Bounding box (world) a piece must be in to touch the net, bulge and ball included.
    const pad = this.maxBulge + 0.12;
    this.aabbMin.set(Infinity, Infinity, Infinity);
    this.aabbMax.set(-Infinity, -Infinity, -Infinity);
    for (const [a, b] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
      for (const side of [-pad, pad]) {
        this.tmp.copy(this.o).addScaledVector(this.eu, a * this.lu).addScaledVector(this.ev, b * this.lv).addScaledVector(this.n, side);
        this.aabbMin.min(this.tmp);
        this.aabbMax.max(this.tmp);
      }
    }

    // Cords: lines along u and along v at the cord spacing, each split into short segments so they can bend.
    const verts: number[] = [];
    const segs = (from: [number, number], to: [number, number], len: number) => {
      const n = Math.max(1, Math.ceil(len / (spacing * 0.5)));
      for (let s = 0; s < n; s++) {
        const a = s / n, b = (s + 1) / n;
        const p = [from[0] + (to[0] - from[0]) * a, from[1] + (to[1] - from[1]) * a];
        const q = [from[0] + (to[0] - from[0]) * b, from[1] + (to[1] - from[1]) * b];
        if (inside && !(inside(p[0] / this.lu, p[1] / this.lv) && inside(q[0] / this.lu, q[1] / this.lv))) continue;
        verts.push(p[0], p[1], q[0], q[1]);
      }
    };
    for (let x = 0; x <= this.lu + 1e-6; x += spec.cordSpacing) segs([x, 0], [x, this.lv], this.lv);
    for (let y = 0; y <= this.lv + 1e-6; y += spec.cordSpacing) segs([0, y], [this.lu, y], this.lu);
    this.vs = new Float32Array(verts);
    const pos = new Float32Array((verts.length / 2) * 3);
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.lines = new THREE.LineSegments(geom, new THREE.LineBasicMaterial({ color: spec.color ?? 0x282b2e }));
    this.lines.name = spec.name ?? 'net-sheet';
    this.lines.frustumCulled = false;
    parent.add(this.lines);
    this.syncVisual();
  }

  /** Bulge (m, behind the flat net) at sheet point (su, sv) metres, and the four knots and weights under it. */
  private sample(su: number, sv: number, out?: { idx: number[]; wt: number[] }): number {
    const { nu, nv } = this.spec;
    const x = Math.min(nu - 1 - 1e-6, Math.max(0, (su / this.lu) * (nu - 1)));
    const y = Math.min(nv - 1 - 1e-6, Math.max(0, (sv / this.lv) * (nv - 1)));
    const i = Math.floor(x), j = Math.floor(y), fx = x - i, fy = y - j;
    const k00 = j * nu + i, k10 = k00 + 1, k01 = k00 + nu, k11 = k01 + 1;
    const w00 = (1 - fx) * (1 - fy), w10 = fx * (1 - fy), w01 = (1 - fx) * fy, w11 = fx * fy;
    if (out) { out.idx = [k00, k10, k01, k11]; out.wt = [w00, w10, w01, w11]; }
    const d = this.d;
    return d[k00] * w00 + d[k10] * w10 + d[k01] * w01 + d[k11] * w11;
  }

  private readonly hit = { idx: [0, 0, 0, 0], wt: [0, 0, 0, 0] };

  private touching = new Set<number>();
  private touchingNow = new Set<number>();

  /** Authority: pieces against the net, then the membrane, for one physics step. */
  step(dt: number, pool: GamePiecePool): void {
    const r = pool.colliderRadius;
    const { aabbMin: lo, aabbMax: hi, n } = this;
    const inside = this.spec.inside;
    for (let i = 0; i < pool.count; i++) {
      if (pool.state[i] !== 'field') continue;
      const b = pool.bodies[i];
      if (b.isSleeping() || !b.isEnabled()) continue;
      const t = b.translation();
      if (t.x < lo.x || t.y < lo.y || t.z < lo.z || t.x > hi.x || t.y > hi.y || t.z > hi.z) continue;
      const px = t.x - this.o.x, py = t.y - this.o.y, pz = t.z - this.o.z;
      const su = px * this.eu.x + py * this.eu.y + pz * this.eu.z;
      const sv = px * this.ev.x + py * this.ev.y + pz * this.ev.z;
      if (su < 0 || sv < 0 || su > this.lu || sv > this.lv) continue;
      if (inside && !inside(su / this.lu, sv / this.lv)) continue;
      const sn = px * n.x + py * n.y + pz * n.z;
      const bulge = this.sample(su, sv, this.hit);
      // How far behind the flat net the piece's back surface reaches; the net is touched where that passes its bulge.
      const reach = r - sn;
      if (reach <= bulge - 0.002 || reach > this.maxBulge + 2 * r) continue;
      // A new contact starts only from the front (centre still ahead of the net): a piece dropping past behind it is not pushed through.
      if (!this.touching.has(i) && sn < -bulge) continue;
      this.touchingNow.add(i);
      const v = b.linvel();
      const vn = v.x * n.x + v.y * n.y + v.z * n.z; // + toward the front
      const into = Math.max(0, -vn);
      // The piece drags the knots under it back to where it is.
      const deficit = Math.min(reach, this.maxBulge) - bulge;
      const { idx, wt } = this.hit;
      const sw2 = wt[0] * wt[0] + wt[1] * wt[1] + wt[2] * wt[2] + wt[3] * wt[3];
      for (let k = 0; k < 4; k++) {
        if (this.pinned[idx[k]]) continue;
        if (deficit > 0) this.d[idx[k]] += (deficit * wt[k]) / sw2;
        this.w[idx[k]] = Math.max(this.w[idx[k]], into * wt[k] * 2);
      }
      // The stretched net pushes back and soaks up the normal speed; the mesh grips sideways motion.
      const depth = Math.min(reach, this.maxBulge);
      let dvn = (CONTACT_STIFFNESS * depth - CONTACT_DAMPING * vn) * dt;
      if (reach > this.maxBulge) dvn = Math.max(dvn, into); // taut: stop it outright
      const tx = v.x - vn * n.x, ty = v.y - vn * n.y, tz = v.z - vn * n.z;
      const g = Math.min(1, GRIP * dt);
      const m = b.mass();
      b.applyImpulse({ x: m * (dvn * n.x - g * tx), y: m * (dvn * n.y - g * ty), z: m * (dvn * n.z - g * tz) }, true);
      this.awake = true;
    }
    [this.touching, this.touchingNow] = [this.touchingNow, this.touching];
    this.touchingNow.clear();
    if (!this.awake) return;
    const { nu, nv } = this.spec;
    const d = this.d, w = this.w, k = this.k;
    let moving = false;
    for (let j = 1; j < nv - 1; j++) for (let i = 1; i < nu - 1; i++) {
      const q = j * nu + i;
      if (this.pinned[q]) continue;
      const lap = d[q - 1] + d[q + 1] + d[q - nu] + d[q + nu] - 4 * d[q];
      w[q] += (k * lap - RESTORE * d[q] - DAMPING * w[q]) * dt;
    }
    for (let q = 0; q < d.length; q++) {
      if (this.pinned[q]) { d[q] = 0; w[q] = 0; continue; }
      d[q] = Math.max(-0.05, Math.min(this.maxBulge, d[q] + w[q] * dt));
      if (Math.abs(d[q]) > 5e-4 || Math.abs(w[q]) > 5e-3) moving = true;
    }
    if (!moving) { d.fill(0); w.fill(0); }
    this.awake = moving;
  }

  /** Deepest current bulge (m). */
  get bulge(): number {
    let m = 0;
    for (let q = 0; q < this.d.length; q++) m = Math.max(m, this.d[q]);
    return m;
  }

  /** Replication: knot bulges in millimetres, or null while the net hangs flat. */
  netState(): number[] | null {
    if (!this.awake) return null;
    return Array.from(this.d, (x) => Math.round(x * 1000));
  }

  applyNetState(s: number[] | null | undefined): void {
    if (!s) { if (this.d.some((x) => x !== 0)) this.d.fill(0); return; }
    for (let q = 0; q < this.d.length && q < s.length; q++) this.d[q] = s[q] / 1000;
    this.awake = true; // an authority restoring a checkpoint lets it settle
  }

  /** Bend the drawn cords to the knots (only while something moved). */
  syncVisual(): void {
    let live = false;
    for (let q = 0; q < this.d.length; q++) if (this.d[q] !== 0) { live = true; break; }
    if (!live && !this.drawnAwake) return;
    this.drawnAwake = live;
    const attr = this.lines.geometry.getAttribute('position') as THREE.BufferAttribute;
    const pos = attr.array as Float32Array;
    for (let v = 0, p = 0; v < this.vs.length; v += 2, p += 3) {
      const su = this.vs[v], sv = this.vs[v + 1];
      const bulge = live ? this.sample(su, sv) : 0;
      pos[p] = this.o.x + this.eu.x * su + this.ev.x * sv - this.n.x * bulge;
      pos[p + 1] = this.o.y + this.eu.y * su + this.ev.y * sv - this.n.y * bulge;
      pos[p + 2] = this.o.z + this.eu.z * su + this.ev.z * sv - this.n.z * bulge;
    }
    attr.needsUpdate = true;
  }

  /** Authority recovery: the bulge is cosmetic; restore flat. */
  reset(): void {
    this.d.fill(0);
    this.w.fill(0);
    this.awake = false;
  }
}
