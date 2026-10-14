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
   * Move the sphere centre `p[j..j+2]` out of any part closer than `radius`. Returns true when it moved. Applies at most
   * two resolves (a corner between two parts).
   */
  push(p: Float32Array, j: number, radius: number): boolean {
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
      p[j] = sx + dx * radius; p[j + 1] = sy + dy * radius; p[j + 2] = sz + dz * radius;
      moved = true;
    }
    return moved;
  }
}

export interface ClearanceSource { geometry: THREE.BufferGeometry; matrix: THREE.Matrix4 }

/** Collect the drawn mechanism meshes of `visual` (everything except FUEL piles, bumpers and parts flagged `fuelNoContact`). */
export function clearanceSources(visual: THREE.Object3D, pileFrame: THREE.Object3D): ClearanceSource[] {
  visual.updateMatrixWorld(true);
  const inverse = new THREE.Matrix4().copy(pileFrame.matrixWorld).invert();
  const out: ClearanceSource[] = [];
  visual.traverse(o => {
    if (!(o instanceof THREE.Mesh) || o instanceof THREE.InstancedMesh || o.name === 'hopper-fuel-pile') return;
    for (let q: THREE.Object3D | null = o; q; q = q.parent) {
      // Parts that move (deploying intake, sliding hopper, hood, turret, climber) would be frozen at the pose they had when
      // the field was built, so a ball could end up inside them later: they are left out.
      if (!q.visible || q.userData.fuelNoContact || /bumper|sliding|extension|lift|hopper-front|intake|hood|turret|flywheel|blocker|climb|shield/i.test(q.name)) return;
      if (q === visual) break;
    }
    out.push({ geometry: o.geometry, matrix: new THREE.Matrix4().multiplyMatrices(inverse, o.matrixWorld) });
  });
  return out;
}

export function buildClearance(sources: ClearanceSource[], min: THREE.Vector3, max: THREE.Vector3, radius: number, cell = 0.012): FuelClearance {
  const field = new FuelClearance(min, max, cell, radius);
  const solid = new Uint8Array(field['has'].length);
  for (const s of sources) field.rasterise(s.geometry, s.matrix, solid);
  field.finish(solid);
  return field;
}
