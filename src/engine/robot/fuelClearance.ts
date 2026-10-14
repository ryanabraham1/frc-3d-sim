import * as THREE from 'three';

/**
 * Static clearance field of a hopper bin: every drawn part (rollers, indexers, rotors, shooter, intake, swerve plates,
 * frame plates) is rasterised once into a coarse voxel grid in the pile's frame, and each voxel remembers the nearest
 * solid sample. Pushing a ball out of the parts is then one table lookup and one sphere-vs-point resolve, so the visual
 * pile stays out of every mechanism it can see without any per-frame mesh tests. It is built from whatever geometry is
 * drawn (match LOD or full CAD), so the pile always matches the drawn robot.
 */
export class FuelClearance {
  private readonly nx: number;
  private readonly ny: number;
  private readonly nz: number;
  /** Nearest solid sample for each voxel within `reach`, as signed cell offsets (+ 128 bias), 0xff0 = none. */
  private readonly near: Int8Array;
  private readonly has: Uint8Array;
  /** Voxels holding a solid sample (for tests / diagnostics). */
  solidCount = 0;

  constructor(readonly min: THREE.Vector3, readonly max: THREE.Vector3, readonly cell: number, readonly reach: number) {
    this.nx = Math.max(1, Math.ceil((max.x - min.x) / cell));
    this.ny = Math.max(1, Math.ceil((max.y - min.y) / cell));
    this.nz = Math.max(1, Math.ceil((max.z - min.z) / cell));
    const n = this.nx * this.ny * this.nz;
    this.near = new Int8Array(n * 3);
    this.has = new Uint8Array(n);
  }

  private index(ix: number, iy: number, iz: number): number { return (iz * this.ny + iy) * this.nx + ix; }

  /** Rasterise every triangle of `geometry` (transformed by `matrix` into the pile frame) into solid samples. */
  rasterise(geometry: THREE.BufferGeometry, matrix: THREE.Matrix4, solid: Uint8Array): void {
    const pos = geometry.getAttribute('position');
    if (!pos) return;
    const index = geometry.getIndex();
    const count = index ? index.count : pos.count;
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), p = new THREE.Vector3();
    const step = this.cell * 0.6;
    const get = (i: number, out: THREE.Vector3) => out.fromBufferAttribute(pos, index ? index.getX(i) : i).applyMatrix4(matrix);
    for (let t = 0; t + 2 < count; t += 3) {
      get(t, a); get(t + 1, b); get(t + 2, c);
      const loX = Math.min(a.x, b.x, c.x), hiX = Math.max(a.x, b.x, c.x);
      if (hiX < this.min.x - this.reach || loX > this.max.x + this.reach) continue;
      const loY = Math.min(a.y, b.y, c.y), hiY = Math.max(a.y, b.y, c.y);
      if (hiY < this.min.y - this.reach || loY > this.max.y + this.reach) continue;
      const loZ = Math.min(a.z, b.z, c.z), hiZ = Math.max(a.z, b.z, c.z);
      if (hiZ < this.min.z - this.reach || loZ > this.max.z + this.reach) continue;
      const longest = Math.max(a.distanceTo(b), b.distanceTo(c), c.distanceTo(a));
      const n = Math.min(60, Math.max(1, Math.ceil(longest / step)));
      for (let i = 0; i <= n; i++) for (let j = 0; j <= n - i; j++) {
        const u = i / n, v = j / n, w = 1 - u - v;
        p.set(a.x * w + b.x * u + c.x * v, a.y * w + b.y * u + c.y * v, a.z * w + b.z * u + c.z * v);
        const ix = Math.floor((p.x - this.min.x) / this.cell), iy = Math.floor((p.y - this.min.y) / this.cell), iz = Math.floor((p.z - this.min.z) / this.cell);
        if (ix < 0 || iy < 0 || iz < 0 || ix >= this.nx || iy >= this.ny || iz >= this.nz) continue;
        solid[this.index(ix, iy, iz)] = 1;
      }
    }
  }

  /** Spread each solid voxel's centre to every voxel within `reach`, keeping the nearest. */
  finish(solid: Uint8Array): void {
    const rc = Math.ceil(this.reach / this.cell);
    const offsets: [number, number, number, number][] = [];
    for (let dz = -rc; dz <= rc; dz++) for (let dy = -rc; dy <= rc; dy++) for (let dx = -rc; dx <= rc; dx++) {
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 <= (rc + 0.5) ** 2) offsets.push([dx, dy, dz, d2]);
    }
    offsets.sort((p, q) => p[3] - q[3]);
    const best = new Float32Array(this.has.length).fill(Infinity);
    for (let iz = 0; iz < this.nz; iz++) for (let iy = 0; iy < this.ny; iy++) for (let ix = 0; ix < this.nx; ix++) {
      if (!solid[this.index(ix, iy, iz)]) continue;
      this.solidCount++;
      for (const [dx, dy, dz, d2] of offsets) {
        const jx = ix + dx, jy = iy + dy, jz = iz + dz;
        if (jx < 0 || jy < 0 || jz < 0 || jx >= this.nx || jy >= this.ny || jz >= this.nz) continue;
        const k = this.index(jx, jy, jz);
        if (d2 >= best[k]) continue;
        best[k] = d2;
        // Offset from the voxel to the solid sample.
        this.near[k * 3] = -dx; this.near[k * 3 + 1] = -dy; this.near[k * 3 + 2] = -dz;
        this.has[k] = 1;
      }
    }
  }

  /**
   * Highest drawn surface in each (x, z) column between `lo` and `hi` (pile frame), or -Infinity where there is none: the
   * hopper floor as drawn (belly pan, spindexer plate, floor rollers, module plates). A ball centred over a column rests
   * on it, so a thin plate above the bin's nominal floor is stood on instead of being sunk through.
   */
  floorMap(lo: number, hi: number, solid: Uint8Array): void {
    const map = new Float32Array(this.nx * this.nz).fill(-Infinity);
    const iy0 = Math.max(0, Math.floor((lo - this.min.y) / this.cell)), iy1 = Math.min(this.ny - 1, Math.floor((hi - this.min.y) / this.cell));
    for (let iz = 0; iz < this.nz; iz++) for (let ix = 0; ix < this.nx; ix++) {
      for (let iy = iy1; iy >= iy0; iy--) if (solid[this.index(ix, iy, iz)]) { map[iz * this.nx + ix] = this.min.y + (iy + 0.5) * this.cell; break; }
    }
    this.floors = map;
  }
  private floors: Float32Array | null = null;

  /** Drawn floor height under (x, z) (see `floorMap`), -Infinity when none was mapped there. */
  floorAt(x: number, z: number): number {
    if (!this.floors) return -Infinity;
    const ix = Math.floor((x - this.min.x) / this.cell), iz = Math.floor((z - this.min.z) / this.cell);
    if (ix < 0 || iz < 0 || ix >= this.nx || iz >= this.nz) return -Infinity;
    return this.floors[iz * this.nx + ix];
  }

  /**
   * Move the sphere centre `p[j..j+2]` out of any part closer than `radius`. Returns true when it moved. Applies at most
   * two resolves (a corner between two parts). Below `upBelow` (pile-frame y) a ball is never pushed down: FUEL that ends
   * up inside a low part (a rotor deck, a serializer) came down onto it, so it is lifted to rest on top instead of being
   * driven further under it; only roofs and overhangs, higher up, push balls down.
   */
  push(p: Float32Array, j: number, radius: number, upBelow = -Infinity): boolean {
    let moved = false;
    for (let pass = 0; pass < 2; pass++) {
      const ix = Math.floor((p[j] - this.min.x) / this.cell), iy = Math.floor((p[j + 1] - this.min.y) / this.cell), iz = Math.floor((p[j + 2] - this.min.z) / this.cell);
      if (ix < 0 || iy < 0 || iz < 0 || ix >= this.nx || iy >= this.ny || iz >= this.nz) return moved;
      const k = this.index(ix, iy, iz);
      if (!this.has[k]) return moved;
      const sx = this.min.x + (ix + 0.5 + this.near[k * 3]) * this.cell, sy = this.min.y + (iy + 0.5 + this.near[k * 3 + 1]) * this.cell, sz = this.min.z + (iz + 0.5 + this.near[k * 3 + 2]) * this.cell;
      let dx = p[j] - sx, dy = p[j + 1] - sy, dz = p[j + 2] - sz;
      const d = Math.hypot(dx, dy, dz);
      if (d >= radius) return moved;
      if (d < 1e-6) { dx = 0; dy = 1; dz = 0; } else { dx /= d; dy /= d; dz /= d; }
      if (dy < 0 && p[j + 1] < upBelow) {
        // Straight up until the sample is a radius away (not out the side, which a ball wedged under a plate can't do).
        const h2 = (p[j] - sx) ** 2 + (p[j + 2] - sz) ** 2;
        p[j + 1] = sy + Math.sqrt(Math.max(0, radius * radius - h2));
        moved = true;
        continue;
      }
      p[j] = sx + dx * radius; p[j + 1] = sy + dy * radius; p[j + 2] = sz + dz * radius;
      moved = true;
    }
    return moved;
  }
}

export interface ClearanceSource { geometry: THREE.BufferGeometry; matrix: THREE.Matrix4 }

/** Name of a part that moves (deploying intake, sliding hopper, hood, turret, climber...). */
const MOVING = /sliding|extension|lift|hopper-front|intake|hood|turret|flywheel|blocker|climb|shield/i;

/** Drawn parts of one moving assembly, in the assembly root's own frame (so its field stays valid however it moves). */
export interface MovingSources { root: THREE.Object3D; sources: ClearanceSource[] }

/**
 * Collect the drawn mechanism meshes of `visual` (everything except FUEL piles, bumpers and parts flagged
 * `fuelNoContact`). Fixed parts come back in the pile frame; each moving assembly (its outermost moving ancestor) comes
 * back in its own frame, to be followed through `relativeMatrix` as it moves.
 */
export function clearanceSources(visual: THREE.Object3D, pileFrame: THREE.Object3D): { fixed: ClearanceSource[]; moving: MovingSources[] } {
  visual.updateMatrixWorld(true);
  const inverse = new THREE.Matrix4().copy(pileFrame.matrixWorld).invert();
  const fixed: ClearanceSource[] = [], moving = new Map<THREE.Object3D, ClearanceSource[]>();
  visual.traverse(o => {
    if (!(o instanceof THREE.Mesh) || o instanceof THREE.InstancedMesh || o.name === 'hopper-fuel-pile') return;
    let root: THREE.Object3D | null = null;
    for (let q: THREE.Object3D | null = o; q; q = q.parent) {
      if (!q.visible || q.userData.fuelNoContact || /bumper/i.test(q.name)) return;
      if (q === visual) break;
      if (MOVING.test(q.name)) root = q;
    }
    if (!root) { fixed.push({ geometry: o.geometry, matrix: new THREE.Matrix4().multiplyMatrices(inverse, o.matrixWorld) }); return; }
    const list = moving.get(root) ?? [];
    list.push({ geometry: o.geometry, matrix: new THREE.Matrix4().copy(root.matrixWorld).invert().multiply(o.matrixWorld) });
    moving.set(root, list);
  });
  return { fixed, moving: [...moving].map(([root, sources]) => ({ root, sources })) };
}

export function buildClearance(sources: ClearanceSource[], min: THREE.Vector3, max: THREE.Vector3, radius: number, cell = 0.012, floor?: { lo: number; hi: number }): FuelClearance {
  const field = new FuelClearance(min, max, cell, radius);
  const solid = new Uint8Array(field['has'].length);
  for (const s of sources) field.rasterise(s.geometry, s.matrix, solid);
  field.finish(solid);
  if (floor) field.floorMap(floor.lo, floor.hi, solid);
  return field;
}

/** Local matrix of `node` relative to `root` (its ancestor), from the nodes' own transforms (no world-matrix pass). */
function chainMatrix(node: THREE.Object3D, root: THREE.Object3D, out: THREE.Matrix4): THREE.Matrix4 {
  out.identity();
  for (let q: THREE.Object3D | null = node; q && q !== root; q = q.parent) { if (q.matrixAutoUpdate) q.updateMatrix(); out.premultiply(q.matrix); }
  return out;
}

/** A moving assembly's clearance field, followed as the assembly moves relative to the pile. */
export class MovingClearance {
  /** Pile frame -> assembly frame, and back; refreshed by `sync` once per pile step. */
  private readonly toPart = new THREE.Matrix4();
  private readonly toPile = new THREE.Matrix4();
  private readonly scratch = new THREE.Matrix4();
  private readonly point = new Float32Array(3);
  constructor(readonly field: FuelClearance, private readonly root: THREE.Object3D, private readonly pileFrame: THREE.Object3D, private readonly visual: THREE.Object3D) {}

  /** Refresh the frame mapping; true when the assembly moved relative to the pile since the last call. */
  sync(): boolean {
    this.last.copy(this.toPart);
    chainMatrix(this.pileFrame, this.visual, this.toPile);
    chainMatrix(this.root, this.visual, this.scratch);
    this.toPart.copy(this.scratch).invert().multiply(this.toPile);
    this.toPile.copy(this.toPart).invert();
    // The field's box in the pile frame, so balls nowhere near the assembly skip the transform (see push).
    this.box.set(this.field.min, this.field.max).applyMatrix4(this.toPile);
    const a = this.toPart.elements, b = this.last.elements;
    let moved = 0;
    for (let i = 0; i < 16; i++) moved = Math.max(moved, Math.abs(a[i] - b[i]));
    return moved > 1e-4;
  }
  private readonly last = new THREE.Matrix4();
  private readonly box = new THREE.Box3();

  /** Whether any of the first `count` balls in `p` lies inside the assembly's box (worth waking the pile for). */
  touches(p: Float32Array, count: number): boolean {
    const box = this.box;
    for (let j = 0; j < count * 3; j += 3) if (p[j] >= box.min.x && p[j] <= box.max.x && p[j + 1] >= box.min.y && p[j + 1] <= box.max.y && p[j + 2] >= box.min.z && p[j + 2] <= box.max.z) return true;
    return false;
  }

  push(p: Float32Array, j: number, radius: number): boolean {
    const x = p[j], y = p[j + 1], z = p[j + 2], box = this.box;
    if (x < box.min.x || y < box.min.y || z < box.min.z || x > box.max.x || y > box.max.y || z > box.max.z) return false;
    const a = this.toPart.elements, q = this.point;
    q[0] = a[0] * x + a[4] * y + a[8] * z + a[12]; q[1] = a[1] * x + a[5] * y + a[9] * z + a[13]; q[2] = a[2] * x + a[6] * y + a[10] * z + a[14];
    if (!this.field.push(q, 0, radius)) return false;
    const b = this.toPile.elements;
    p[j] = b[0] * q[0] + b[4] * q[1] + b[8] * q[2] + b[12]; p[j + 1] = b[1] * q[0] + b[5] * q[1] + b[9] * q[2] + b[13]; p[j + 2] = b[2] * q[0] + b[6] * q[1] + b[10] * q[2] + b[14];
    return true;
  }
}

/**
 * Fields for every moving assembly that comes near the bin (`binMin`/`binMax` in the pile frame, grown by `travel` for
 * how far the assembly can move), each built in the assembly's own frame.
 */
export function buildMovingClearance(moving: MovingSources[], pileFrame: THREE.Object3D, visual: THREE.Object3D, binMin: THREE.Vector3, binMax: THREE.Vector3, radius: number, travel = 0.35, cell = 0.012): MovingClearance[] {
  const out: MovingClearance[] = [];
  const near = new THREE.Box3(binMin.clone().subScalar(travel), binMax.clone().addScalar(travel));
  const toPile = new THREE.Matrix4().copy(pileFrame.matrixWorld).invert();
  for (const { root, sources } of moving) {
    const local = new THREE.Box3(), box = new THREE.Box3();
    for (const s of sources) {
      s.geometry.computeBoundingBox();
      box.copy(s.geometry.boundingBox!).applyMatrix4(s.matrix);
      local.union(box);
    }
    if (local.isEmpty() || !box.copy(local).applyMatrix4(new THREE.Matrix4().multiplyMatrices(toPile, root.matrixWorld)).intersectsBox(near)) continue;
    const size = local.getSize(new THREE.Vector3());
    if (size.x * size.y * size.z / cell ** 3 > 2.5e6) continue; // a whole-robot assembly: too big to rasterise here
    const field = buildClearance(sources, local.min.clone().subScalar(radius), local.max.clone().addScalar(radius), radius, cell);
    if (field.solidCount) out.push(new MovingClearance(field, root, pileFrame, visual));
  }
  return out;
}
