import * as THREE from 'three';
import type { RobotAnimState } from './models';

export interface FuelBin {
  x: number; y0: number; length: number; width: number; height: number;
  inside?: (x: number, z: number) => boolean;
  ceiling?: (x: number, z: number) => number;
}
export interface FuelSeed { x: number; y: number; z: number; s: number; sy?: number }

/** Small sleeping, visual-only particle solver. No Rapier bodies, geometry rebuilds or fixed rest targets. */
export class FuelPile {
  contacts?: { sync(): boolean; resolve(p: Float32Array, v: Float32Array, j: number, radius: number): void };
  wake(): void { this.awake = this.count > 0; this.quiet = 0; }
  readonly positions: Float32Array;
  private readonly velocity: Float32Array;
  private readonly before: Float32Array;
  private readonly contactRadius: Float32Array;
  private readonly arrivals: THREE.Vector3[] = [];
  private count = 0;
  /** Uncovered hopper: no lid, so FUEL that ends up above the rim leaves the pile (see `step`'s escape callback). */
  open = false;
  private lift = 0;
  private upX = 0;
  private upY = 1;
  private upZ = 0;
  get size(): number { return this.count; }
  private pending = 0;
  private quiet = 0;
  private awake = false;
  private sampled = false;
  private previousX = 0;
  private previousZ = 0;
  private previousOmega = 0;
  private kickX = 0;
  private kickZ = 0;
  private kickTurn = 0;

  constructor(private readonly bin: FuelBin, private readonly seeds: FuelSeed[], private readonly radius: number) {
    this.positions = new Float32Array(seeds.length * 3);
    this.velocity = new Float32Array(seeds.length * 3);
    this.before = new Float32Array(seeds.length * 3);
    this.contactRadius = Float32Array.from(seeds, b => radius * Math.min(0.9, (b.sy ?? 0.94) * 1.92 / 1.9) * b.s);
    for (let i = 0; i < seeds.length; i++) this.reset(i);
  }

  private reset(i: number): void {
    const b = this.seeds[i], j = i * 3;
    this.positions[j] = b.x; this.positions[j + 1] = b.y; this.positions[j + 2] = b.z;
    this.velocity[j] = this.velocity[j + 1] = this.velocity[j + 2] = 0;
  }

  /** Entry is beside the intake, above the actual nearby pile, rather than a random stow spot. */
  entry(hint: THREE.Vector3): THREE.Vector3 {
    const b = this.bin, r = this.radius * 1.025;
    let x = THREE.MathUtils.clamp(hint.x, b.x - b.length / 2 + r, b.x + b.length / 2 - r);
    let z = THREE.MathUtils.clamp(hint.z, -b.width / 2 + r, b.width / 2 - r);
    if (b.inside && !b.inside(x, z)) {
      let best = Infinity;
      const targetX = x, targetZ = z;
      for (const seed of this.seeds) {
        const d = (seed.x - targetX) ** 2 + (seed.z - targetZ) ** 2;
        if (d < best) { best = d; x = seed.x; z = seed.z; }
      }
    }
    let y = b.y0 + r;
    for (let i = 0; i < this.count; i++) {
      const j = i * 3, d2 = (x - this.positions[j]) ** 2 + (z - this.positions[j + 2]) ** 2;
      const diameter = this.radius * 1.8;
      if (d2 < diameter * diameter) y = Math.max(y, this.positions[j + 1] + Math.sqrt(diameter * diameter - d2));
    }
    const roof = Math.min(b.y0 + b.height, b.ceiling?.(x, z) ?? Infinity);
    return new THREE.Vector3(x, this.open ? Math.max(y + 0.015, hint.y) : Math.min(roof - r, Math.max(y + 0.015, hint.y)), z);
  }

  receive(position: THREE.Vector3): void {
    if (this.arrivals.length < 14) this.arrivals.push(position.clone());
  }

  setCount(n: number): void {
    if (n === this.count) return;
    for (let i = this.count; i < n; i++) {
      this.reset(i);
      const entry = this.arrivals.shift();
      if (entry) {
        const j = i * 3;
        this.positions[j] = entry.x; this.positions[j + 1] = entry.y; this.positions[j + 2] = entry.z;
        // Carry a little roller momentum into the bin, then let collisions and gravity do the settling.
        this.velocity[j] = Math.sign(this.bin.x - entry.x) * 0.35;
        this.velocity[j + 1] = -0.15;
      }
    }
    this.count = n;
    for (let i = 0; i < n; i++) this.confine(i, this.positions[i * 3], this.positions[i * 3 + 2]);
    this.awake = n > 0; this.quiet = 0;
    if (!n) { this.arrivals.length = 0; this.kickX = this.kickZ = this.kickTurn = 0; }
  }

  /**
   * Returns true only when matrices need uploading (zero while sleeping). Steps every drawn frame: a 30 Hz pile riding a
   * 60 Hz chassis visibly stuttered. At most two substeps, so a slow frame can't snowball into a slower one.
   */
  step(s: RobotAnimState, escape?: (x: number, y: number, z: number, vx: number, vy: number, vz: number) => void): boolean {
    const dt = THREE.MathUtils.clamp(s.dt, 0, 0.1);
    if (dt <= 0) return false;
    if (this.count > 0 && this.contacts?.sync()) this.wake();
    // Gravity in the chassis frame: a tilted or overturned robot pours its pile toward the low side.
    const ux = s.upx ?? 0, uy = s.upy ?? 1, uz = s.upz ?? 0;
    if (Math.abs(ux - this.upX) + Math.abs(uy - this.upY) + Math.abs(uz - this.upZ) > 0.01 && this.count > 0) { this.awake = true; this.quiet = 0; }
    this.upX = ux; this.upY = uy; this.upZ = uz;
    if (this.sampled && s.enabled && this.count > 0) {
      const dx = this.previousX - s.vx, dz = this.previousZ - s.vz, turn = this.previousOmega - s.omega;
      if (Math.hypot(dx, dz) + Math.abs(turn) * 0.15 > 0.025) {
        this.kickX += dx * 0.65; this.kickZ += dz * 0.65; this.kickTurn += turn * 0.5;
        this.awake = this.count > 0; this.quiet = 0;
      }
      // A hard hit jolts the whole robot: the loose FUEL near the top jumps and can clear the rim.
      const impact = Math.hypot(dx, dz);
      if (this.open && impact > 2.5) this.lift = Math.min(2.2, 0.6 + (impact - 2.5) * 0.45);
      if (Math.abs(s.omega) * Math.hypot(s.vx, s.vz) > 0.2) { this.awake = this.count > 0; this.quiet = 0; }
    }
    this.previousX = s.vx; this.previousZ = s.vz; this.previousOmega = s.omega; this.sampled = true;
    this.pending += dt;
    if (this.pending < 1 / 150) return false;
    const time = Math.min(this.pending, 0.1); this.pending = 0;
    if (!this.awake) return false;
    const p = this.positions, v = this.velocity;
    for (let i = 0; i < this.count; i++) {
      const j = i * 3;
      v[j] += THREE.MathUtils.clamp(this.kickX + this.kickTurn * p[j + 2], -1.8, 1.8);
      v[j + 2] += THREE.MathUtils.clamp(this.kickZ - this.kickTurn * (p[j] - this.bin.x), -1.8, 1.8);
    }
    this.kickX = this.kickZ = this.kickTurn = 0;
    if (this.lift > 0) { for (let i = 0; i < this.count; i++) v[i * 3 + 1] += this.lift; this.lift = 0; }
    this.before.set(p);
    const steps = Math.min(2, Math.ceil(time * 60)), h = time / steps;
    for (let sub = 0; sub < steps; sub++) {
      for (let i = 0; i < this.count; i++) {
        const j = i * 3, oldX = p[j], oldZ = p[j + 2];
        v[j] -= 9.81 * h * ux; v[j + 1] -= 9.81 * h * uy; v[j + 2] -= 9.81 * h * uz;
        if (s.enabled) { v[j] += s.omega * s.vz * h * 0.45; v[j + 2] -= s.omega * s.vx * h * 0.45; }
        p[j] += v[j] * h; p[j + 1] += v[j + 1] * h; p[j + 2] += v[j + 2] * h;
        this.confine(i, oldX, oldZ);
      }
      // Bounded pair budget: small hoppers, three contact passes, no allocations in the contact loop.
      for (let pass = 0; pass < 3; pass++) {
        for (let a = 0; a < this.count; a++) for (let b = a + 1; b < this.count; b++) {
          const j = a * 3, k = b * 3;
          let dx = p[k] - p[j], dy = p[k + 1] - p[j + 1], dz = p[k + 2] - p[j + 2];
          const gap = this.contactRadius[a] + this.contactRadius[b];
          if (Math.abs(dx) >= gap || Math.abs(dy) >= gap || Math.abs(dz) >= gap) continue;
          const d2 = dx * dx + dy * dy + dz * dz;
          if (d2 >= gap * gap) continue;
          if (d2 < 1e-10) { dx = 0.001 * Math.cos(a * 2.4); dz = 0.001 * Math.sin(a * 2.4); dy = 0.001; }
          const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
          dx /= distance; dy /= distance; dz /= distance;
          const correction = (gap - distance) * 0.5;
          const ax = p[j], az = p[j + 2], bx = p[k], bz = p[k + 2];
          p[j] -= dx * correction; p[j + 1] -= dy * correction; p[j + 2] -= dz * correction;
          p[k] += dx * correction; p[k + 1] += dy * correction; p[k + 2] += dz * correction;
          const closing = (v[k] - v[j]) * dx + (v[k + 1] - v[j + 1]) * dy + (v[k + 2] - v[j + 2]) * dz;
          if (closing < 0) {
            const impulse = -closing * 0.52;
            v[j] -= dx * impulse; v[j + 1] -= dy * impulse; v[j + 2] -= dz * impulse;
            v[k] += dx * impulse; v[k + 1] += dy * impulse; v[k + 2] += dz * impulse;
          }
          this.confine(a, ax, az); this.confine(b, bx, bz);
        }
        if (this.contacts) for (let i = 0; i < this.count; i++) {
          const oldX = p[i * 3], oldZ = p[i * 3 + 2];
          this.contacts.resolve(p, v, i * 3, this.radius * this.seeds[i].s * 0.96);
          this.confine(i, oldX, oldZ);
        }
      }
      const damping = Math.exp(-7 * h);
      for (let j = 0; j < this.count * 3; j++) v[j] *= damping;
    }
    if (this.open) this.releaseOverRim(escape);
    let movement = 0;
    for (let j = 0; j < this.count * 3; j++) movement = Math.max(movement, Math.abs(p[j] - this.before[j]));
    this.quiet = movement < 0.003 ? this.quiet + time : 0;
    if (this.quiet > 0.6) { this.awake = false; v.fill(0); }
    return true;
  }

  /** Balls whose centre has risen above the rim are no longer in the hopper: hand them to the caller and drop them from the pile. */
  private releaseOverRim(escape?: (x: number, y: number, z: number, vx: number, vy: number, vz: number) => void): void {
    const p = this.positions, v = this.velocity, rim = this.bin.y0 + this.bin.height;
    for (let i = this.count - 1; i >= 0; i--) {
      const j = i * 3;
      const outside = Math.abs(p[j] - this.bin.x) > this.bin.length / 2 + this.radius * 0.2 || Math.abs(p[j + 2]) > this.bin.width / 2 + this.radius * 0.2;
      const overturned = this.upY < 0 && p[j + 1] > rim + this.radius * 2;
      if (!outside && !overturned) continue;
      if (p[j + 1] < rim - this.radius && !outside) continue;
      escape?.(p[j], p[j + 1], p[j + 2], v[j], v[j + 1], v[j + 2]);
      const last = (this.count - 1) * 3;
      for (let k = 0; k < 3; k++) { p[j + k] = p[last + k]; v[j + k] = v[last + k]; }
      this.count--;
    }
  }

  private confine(i: number, oldX: number, oldZ: number): void {
    const b = this.bin, j = i * 3, p = this.positions, v = this.velocity;
    const r = this.radius * this.seeds[i].s, ry = r * (this.seeds[i].sy ?? 0.94);
    const minX = b.x - b.length / 2 + r, maxX = b.x + b.length / 2 - r, minZ = -b.width / 2 + r, maxZ = b.width / 2 - r;
    // Above the lip there is no side wall. Pair contacts can roll the ball across the rim continuously.
    const overLip = this.open && (p[j + 1] > b.y0 + b.height || Math.abs(p[j] - b.x) > b.length / 2 || Math.abs(p[j + 2]) > b.width / 2);
    const x = overLip ? p[j] : THREE.MathUtils.clamp(p[j], minX, maxX), z = overLip ? p[j + 2] : THREE.MathUtils.clamp(p[j + 2], minZ, maxZ);
    if (!overLip && ((p[j] < minX && v[j] < 0) || (p[j] > maxX && v[j] > 0))) v[j] *= -0.08;
    if (!overLip && ((p[j + 2] < minZ && v[j + 2] < 0) || (p[j + 2] > maxZ && v[j + 2] > 0))) v[j + 2] *= -0.08;
    p[j] = x; p[j + 2] = z;
    if (!overLip && b.inside && !b.inside(x, z)) { p[j] = oldX; p[j + 2] = oldZ; v[j] *= -0.08; v[j + 2] *= -0.08; }
    const floor = b.y0 + ry, roof = Math.min(b.y0 + b.height, b.ceiling?.(p[j], p[j + 2]) ?? Infinity) - ry;
    if (p[j + 1] < floor) { p[j + 1] = floor; v[j + 1] = Math.max(0, -v[j + 1] * 0.06); v[j] *= 0.85; v[j + 2] *= 0.85; }
    // Uncovered bins have no lid: only the rim (see releaseOverRim) ends a ball's climb.
    if (!this.open && p[j + 1] > roof) { p[j + 1] = roof; v[j + 1] = Math.min(0, -v[j + 1] * 0.06); }
  }
}
