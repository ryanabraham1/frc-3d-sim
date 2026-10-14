import * as THREE from 'three';
import type { Robot } from '../robot/robot';

/**
 * Mirrors a robot's drawn model between two identical copies: the worker's (posed by the simulation every step) and the
 * screen's (only drawn). Both sides build the robot with the same code, so their scene graphs line up node for node;
 * the worker writes every node's local transform, every material's look and every instanced mesh, and the screen copies
 * them back, blending node transforms between two frames.
 *
 * Pieces travelling through the robot (PieceFlow tokens) come and go while the match runs, so they travel separately
 * as a list of transforms and the screen keeps a pool of token meshes.
 */

/** Per node: position (3), quaternion (4), scale (3), visible (1). */
export const NODE_STRIDE = 11;
/** Per material: color (3), emissive (3), emissive intensity, opacity, visible. */
export const MAT_STRIDE = 9;
/** Per piece token: position (3), quaternion (4), scale (1). */
export const TOKEN_STRIDE = 8;

export interface InstanceFrame {
  /** Index into the robot's instanced meshes. */
  k: number;
  count: number;
  matrices: Float32Array;
}

export interface RobotVisualFrame {
  nodes: Float32Array;
  mats: Float32Array;
  inst: InstanceFrame[];
  tokens: Float32Array;
  /** Deforming fabric cannot be mirrored through Object3D transforms alone. */
  geometry: { k: number; positions: Float32Array }[];
  /** Seasonal pieces can move from their tool into a robot-local transfer path. */
  parents?: [number, number][];
}

type LookMaterial = THREE.Material & { color?: THREE.Color; emissive?: THREE.Color; emissiveIntensity?: number };

export class RobotMirror {
  /** Every node under the robot's root at build time, depth first (the root itself first). */
  readonly nodes: THREE.Object3D[] = [];
  readonly materials: LookMaterial[] = [];
  readonly instanced: THREE.InstancedMesh[] = [];
  private readonly instVersion: number[] = [];
  private readonly instCount: number[] = [];
  private readonly tokenPool: THREE.Object3D[] = [];
  private readonly deforming: (THREE.LineSegments | THREE.Mesh)[] = [];
  private readonly geometryAttributes: (THREE.BufferAttribute | undefined)[] = [];
  private readonly geometryVersions: number[] = [];
  private readonly nodeIndices = new Map<THREE.Object3D, number>();
  private readonly parentState = new Map<number, number>();

  constructor(readonly robot: Robot, private readonly makeToken?: () => THREE.Object3D) {
    const seen = new Set<THREE.Material>();
    robot.visual.traverse((o) => {
      if (o.userData.flowToken) return;
      this.nodes.push(o);
      if (o.userData.mirrorGeometry) this.deforming.push(o as THREE.LineSegments | THREE.Mesh);
      const mesh = o as THREE.Mesh;
      if ((mesh as unknown as THREE.InstancedMesh).isInstancedMesh) {
        this.instanced.push(mesh as unknown as THREE.InstancedMesh);
        this.instVersion.push(-1);
        this.instCount.push(-1);
      }
      const mats = mesh.material ? (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) : [];
      for (const m of mats) {
        if (seen.has(m)) continue;
        seen.add(m);
        this.materials.push(m as LookMaterial);
      }
    });
    this.nodes.forEach((node, i) => this.nodeIndices.set(node, i));
  }

  /** Structure fingerprint: both sides must agree before frames are applied. */
  get shape(): string {
    return `${this.nodes.length}:${this.materials.length}:${this.instanced.length}:${this.deforming.length}:${this.nodes.map((o) => o.type[0]).join('')}`;
  }

  // ─────────────────────────── worker side ───────────────────────────

  /** Snapshot the robot as the simulation posed it. `force` sends every instanced mesh (first frame / resync). */
  capture(force = false): RobotVisualFrame {
    const nodes = new Float32Array(this.nodes.length * NODE_STRIDE);
    for (let i = 0; i < this.nodes.length; i++) {
      const o = this.nodes[i], j = i * NODE_STRIDE;
      nodes[j] = o.position.x; nodes[j + 1] = o.position.y; nodes[j + 2] = o.position.z;
      nodes[j + 3] = o.quaternion.x; nodes[j + 4] = o.quaternion.y; nodes[j + 5] = o.quaternion.z; nodes[j + 6] = o.quaternion.w;
      nodes[j + 7] = o.scale.x; nodes[j + 8] = o.scale.y; nodes[j + 9] = o.scale.z;
      nodes[j + 10] = o.visible ? 1 : 0;
    }
    const mats = new Float32Array(this.materials.length * MAT_STRIDE);
    for (let i = 0; i < this.materials.length; i++) {
      const m = this.materials[i], j = i * MAT_STRIDE;
      if (m.color) { mats[j] = m.color.r; mats[j + 1] = m.color.g; mats[j + 2] = m.color.b; }
      if (m.emissive) { mats[j + 3] = m.emissive.r; mats[j + 4] = m.emissive.g; mats[j + 5] = m.emissive.b; }
      mats[j + 6] = m.emissiveIntensity ?? 0;
      mats[j + 7] = m.opacity;
      mats[j + 8] = m.visible ? 1 : 0;
    }
    const inst: InstanceFrame[] = [];
    for (let k = 0; k < this.instanced.length; k++) {
      const m = this.instanced[k];
      if (!force && m.instanceMatrix.version === this.instVersion[k] && m.count === this.instCount[k]) continue;
      this.instVersion[k] = m.instanceMatrix.version;
      this.instCount[k] = m.count;
      inst.push({ k, count: m.count, matrices: (m.instanceMatrix.array as Float32Array).slice(0, Math.max(0, m.count) * 16) });
    }
    const live: THREE.Object3D[] = [];
    for (const c of this.robot.visual.children) if (c.userData.flowToken && c.visible) live.push(c);
    const tokens = new Float32Array(live.length * TOKEN_STRIDE);
    for (let i = 0; i < live.length; i++) {
      const o = live[i], j = i * TOKEN_STRIDE;
      tokens[j] = o.position.x; tokens[j + 1] = o.position.y; tokens[j + 2] = o.position.z;
      tokens[j + 3] = o.quaternion.x; tokens[j + 4] = o.quaternion.y; tokens[j + 5] = o.quaternion.z; tokens[j + 6] = o.quaternion.w;
      tokens[j + 7] = o.scale.x;
    }
    const geometry: RobotVisualFrame['geometry'] = [];
    for (let k = 0; k < this.deforming.length; k++) {
      const p = this.deforming[k].geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
      if (!p || (!force && p === this.geometryAttributes[k] && p.version === this.geometryVersions[k])) continue;
      this.geometryAttributes[k] = p;
      this.geometryVersions[k] = p.version;
      geometry.push({ k, positions: new Float32Array(p.array) });
    }
    const parents: [number, number][] = [];
    for (let i = 0; i < this.nodes.length; i++) {
      const node = this.nodes[i];
      if (node.userData.mirrorParent && node.parent) {
        const parent = this.nodeIndices.get(node.parent);
        if (parent !== undefined) parents.push([i, parent]);
      }
    }
    return { nodes, mats, inst, tokens, geometry, parents };
  }

  // ─────────────────────────── screen side ───────────────────────────

  /** Copy instanced meshes and materials from the newest frame (no blending: they change in steps). */
  applyDiscrete(f: RobotVisualFrame): void {
    for (const [node, parent] of f.parents ?? []) this.parentState.set(node, parent);
    for (const { k, positions } of f.geometry) {
      const mesh = this.deforming[k];
      if (!mesh) continue;
      let p = mesh.geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
      if (!p || p.array.length !== positions.length) {
        p = new THREE.BufferAttribute(positions.slice(), 3);
        mesh.geometry.setAttribute('position', p);
      } else p.array.set(positions);
      p.needsUpdate = true;
      if (mesh instanceof THREE.Mesh) mesh.geometry.computeVertexNormals();
      mesh.geometry.computeBoundingSphere();
    }
    for (const { k, count, matrices } of f.inst) {
      const m = this.instanced[k];
      if (!m) continue;
      const arr = m.instanceMatrix.array as Float32Array;
      arr.set(matrices.subarray(0, Math.min(matrices.length, arr.length)));
      m.count = Math.min(count, arr.length / 16);
      m.instanceMatrix.needsUpdate = true;
    }
    const mats = f.mats;
    for (let i = 0; i < this.materials.length; i++) {
      const m = this.materials[i], j = i * MAT_STRIDE;
      if (m.color) m.color.setRGB(mats[j], mats[j + 1], mats[j + 2]);
      if (m.emissive) m.emissive.setRGB(mats[j + 3], mats[j + 4], mats[j + 5]);
      if (m.emissiveIntensity !== undefined) m.emissiveIntensity = mats[j + 6];
      m.opacity = mats[j + 7];
      m.visible = mats[j + 8] > 0.5;
    }
  }

  private readonly qa = new THREE.Quaternion();
  private readonly qb = new THREE.Quaternion();

  /** Pose every node `k` of the way from frame `a` to frame `b`. */
  applyNodes(a: Float32Array, b: Float32Array, k: number, aParents?: [number, number][], bParents?: [number, number][]): void {
    // Reparented held pieces have local coordinates in different frames (gripper vs robot).
    // Use the hierarchy from the rendered snapshot, never the newest received hierarchy.
    const previousParents = aParents ? new Map(aParents) : null;
    const nextParents = bParents ? new Map(bParents) : null;
    if (previousParents && nextParents) {
      this.parentState.clear();
      for (const [node, parent] of k < 1 ? previousParents : nextParents) this.parentState.set(node, parent);
    }
    const n = Math.min(this.nodes.length, b.length / NODE_STRIDE);
    for (let i = 0; i < n; i++) {
      const o = this.nodes[i], j = i * NODE_STRIDE;
      const parent = this.nodes[this.parentState.get(i) ?? -1];
      const reparented = parent && o.parent !== parent;
      if (reparented) parent.add(o);
      const changingParent = previousParents && nextParents && previousParents.get(i) !== nextParents.get(i);
      if (changingParent && k < 1) {
        o.position.set(a[j], a[j + 1], a[j + 2]);
        o.quaternion.set(a[j + 3], a[j + 4], a[j + 5], a[j + 6]);
        o.scale.set(a[j + 7], a[j + 8], a[j + 9]);
      } else if (k >= 1 || a === b || (reparented && !previousParents)) {
        o.position.set(b[j], b[j + 1], b[j + 2]);
        o.quaternion.set(b[j + 3], b[j + 4], b[j + 5], b[j + 6]);
        o.scale.set(b[j + 7], b[j + 8], b[j + 9]);
      } else {
        // A node that jumped (a robot reset, a mechanism snapping to a new pose) is drawn where it is.
        const dx = b[j] - a[j], dy = b[j + 1] - a[j + 1], dz = b[j + 2] - a[j + 2];
        const t = dx * dx + dy * dy + dz * dz < 1 ? k : 1;
        o.position.set(a[j] + dx * t, a[j + 1] + dy * t, a[j + 2] + dz * t);
        this.qa.set(a[j + 3], a[j + 4], a[j + 5], a[j + 6]);
        this.qb.set(b[j + 3], b[j + 4], b[j + 5], b[j + 6]);
        o.quaternion.slerpQuaternions(this.qa, this.qb, t);
        o.scale.set(a[j + 7] + (b[j + 7] - a[j + 7]) * t, a[j + 8] + (b[j + 8] - a[j + 8]) * t, a[j + 9] + (b[j + 9] - a[j + 9]) * t);
      }
      o.visible = (k < 1 ? a : b)[j + 10] > 0.5;
    }
  }

  /** Show the newest frame's travelling pieces, blending each from the older frame's token in the same slot. */
  applyTokens(a: Float32Array, b: Float32Array, k: number): void {
    if (!this.makeToken) return;
    const n = b.length / TOKEN_STRIDE, na = a.length / TOKEN_STRIDE;
    while (this.tokenPool.length < n) {
      const o = this.makeToken();
      o.userData.mirrorToken = true;
      this.robot.visual.add(o);
      this.tokenPool.push(o);
    }
    for (let i = 0; i < this.tokenPool.length; i++) {
      const o = this.tokenPool[i];
      if (i >= n) { o.visible = false; continue; }
      const j = i * TOKEN_STRIDE;
      let t = 1;
      if (i < na && k < 1) {
        const dx = b[j] - a[j], dy = b[j + 1] - a[j + 1], dz = b[j + 2] - a[j + 2];
        if (dx * dx + dy * dy + dz * dz < 0.04) t = k;
      }
      if (t < 1) {
        o.position.set(a[j] + (b[j] - a[j]) * t, a[j + 1] + (b[j + 1] - a[j + 1]) * t, a[j + 2] + (b[j + 2] - a[j + 2]) * t);
        this.qa.set(a[j + 3], a[j + 4], a[j + 5], a[j + 6]);
        this.qb.set(b[j + 3], b[j + 4], b[j + 5], b[j + 6]);
        o.quaternion.slerpQuaternions(this.qa, this.qb, t);
      } else {
        o.position.set(b[j], b[j + 1], b[j + 2]);
        o.quaternion.set(b[j + 3], b[j + 4], b[j + 5], b[j + 6]);
      }
      o.scale.setScalar(b[j + 7]);
      o.visible = true;
    }
  }
}
