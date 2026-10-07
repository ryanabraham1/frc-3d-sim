import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Draw-call reduction for rigid assemblies (robot models, the venue): every mesh that never moves relative to its
 * nearest moving ancestor is baked into one mesh per material on that ancestor. Moving nodes (`dynamic`) and
 * everything under them keep their own transforms; their own static content is merged the same way, one level down.
 *
 * Skipped (left as they are): invisible meshes, instanced meshes, transparent materials (they need per-object depth
 * sorting), multi-material meshes and meshes flagged `userData.keep`.
 */
export function mergeStatic(root: THREE.Object3D, dynamic: Set<THREE.Object3D> = new Set()): { before: number; after: number } {
  let before = 0;
  root.traverse((o) => { if ((o as THREE.Mesh).isMesh) before++; });
  mergeCluster(root, dynamic);
  let after = 0;
  root.traverse((o) => { if ((o as THREE.Mesh).isMesh) after++; });
  return { before, after };
}

function mergeable(m: THREE.Mesh): boolean {
  if (!m.isMesh || (m as unknown as THREE.InstancedMesh).isInstancedMesh || (m as unknown as THREE.SkinnedMesh).isSkinnedMesh) return false;
  if (!m.visible || m.userData.keep || Array.isArray(m.material)) return false;
  const mat = m.material as THREE.Material;
  if (mat.transparent || mat.opacity < 1) return false;
  return !m.geometry.morphAttributes || Object.keys(m.geometry.morphAttributes).length === 0;
}

function mergeCluster(anchor: THREE.Object3D, dynamic: Set<THREE.Object3D>): void {
  anchor.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(anchor.matrixWorld).invert();
  const groups = new Map<string, { mat: THREE.Material; cast: boolean; receive: boolean; order: number; meshes: THREE.Mesh[] }>();
  const subAnchors: THREE.Object3D[] = [];
  // Walk the static part of the tree below `anchor`; stop at moving nodes (merged later as their own clusters).
  const walk = (o: THREE.Object3D) => {
    for (const child of o.children) {
      if (dynamic.has(child)) {
        subAnchors.push(child);
        continue;
      }
      // An invisible subtree may be toggled on later: leave it whole.
      if (!child.visible) continue;
      const mesh = child as THREE.Mesh;
      if (mesh.isMesh && mergeable(mesh)) {
        const mat = mesh.material as THREE.Material;
        // Identical-looking materials (models create one per part) merge together; the first instance is drawn.
        const key = `${materialKey(mat)}|${mesh.castShadow ? 1 : 0}${mesh.receiveShadow ? 1 : 0}|${mesh.renderOrder}|${!!mesh.userData.fuelCadContact}|${!!mesh.userData.fuelDrivenSurface}`;
        let g = groups.get(key);
        if (!g) groups.set(key, (g = { mat, cast: mesh.castShadow, receive: mesh.receiveShadow, order: mesh.renderOrder, meshes: [] }));
        g.meshes.push(mesh);
      }
      walk(child);
    }
  };
  walk(anchor);

  const rel = new THREE.Matrix4();
  for (const g of groups.values()) {
    if (g.meshes.length < 2) continue;
    const needUv = !!(g.mat as THREE.MeshStandardMaterial).map;
    const geos: THREE.BufferGeometry[] = [];
    for (const m of g.meshes) {
      rel.multiplyMatrices(inv, m.matrixWorld);
      let geo = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
      for (const name of Object.keys(geo.attributes)) {
        if (name !== 'position' && name !== 'normal' && !(needUv && name === 'uv')) geo.deleteAttribute(name);
      }
      if (!geo.attributes.normal) geo.computeVertexNormals();
      if (needUv && !geo.attributes.uv) {
        geos.length = 0;
        break;
      }
      geo.clearGroups();
      geo.applyMatrix4(rel);
      // A mirrored part flips its triangle winding: swap two corners so front faces stay front.
      if (rel.determinant() < 0) geo = flipWinding(geo);
      geos.push(geo);
    }
    if (geos.length < 2) continue;
    const merged = mergeGeometries(geos, false);
    for (const geo of geos) geo.dispose();
    if (!merged) continue;
    merged.computeBoundingSphere();
    const mesh = new THREE.Mesh(merged, g.mat);
    mesh.castShadow = g.cast;
    mesh.receiveShadow = g.receive;
    mesh.renderOrder = g.order;
    mesh.name = 'merged-static';
    mesh.userData.fuelCadContact = !!g.meshes[0].userData.fuelCadContact;
    mesh.userData.fuelDrivenSurface = !!g.meshes[0].userData.fuelDrivenSurface;
    anchor.add(mesh);
    mesh.updateMatrixWorld();
    for (const m of g.meshes) {
      m.removeFromParent();
      // Shared geometries (e.g. a bolt reused 40 times) stay alive for whoever else uses them; GC handles the rest.
    }
  }
  for (const sub of subAnchors) mergeCluster(sub, dynamic);
}

/**
 * Appearance signature of a material: two materials with the same key render identically. Only safe for materials
 * nobody mutates after the merge (robot model parts; per-frame lights are kept out of merges as dynamic nodes).
 */
function materialKey(m: THREE.Material): string {
  const s = m as THREE.MeshStandardMaterial & THREE.MeshBasicMaterial;
  if (!(s.isMeshStandardMaterial || s.isMeshBasicMaterial)) return m.uuid;
  const c = (x?: THREE.Color) => (x ? x.getHexString() : '-');
  return [m.type, c(s.color), c(s.emissive), s.emissiveIntensity, s.metalness, s.roughness, s.map?.uuid, s.envMap?.uuid,
    s.envMapIntensity, m.side, s.flatShading, m.polygonOffset, m.polygonOffsetFactor, m.vertexColors, m.depthWrite,
    m.alphaTest, s.wireframe].join(',');
}

function flipWinding(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  for (const name of Object.keys(geo.attributes)) {
    const a = geo.attributes[name] as THREE.BufferAttribute;
    const n = a.itemSize;
    for (let t = 0; t + 2 < a.count; t += 3) {
      for (let k = 0; k < n; k++) {
        const i1 = (t + 1) * n + k;
        const i2 = (t + 2) * n + k;
        const tmp = a.array[i1];
        (a.array as Float32Array)[i1] = a.array[i2];
        (a.array as Float32Array)[i2] = tmp;
      }
    }
    a.needsUpdate = true;
  }
  return geo;
}

/** Snapshot of every node's local transform + visibility, for detecting which parts an animation moves. */
export function poseSnapshot(root: THREE.Object3D): Map<THREE.Object3D, string> {
  const snap = new Map<THREE.Object3D, string>();
  root.traverse((o) => snap.set(o, poseKey(o)));
  return snap;
}

export function poseKey(o: THREE.Object3D): string {
  const r = (v: number) => Math.round(v * 1e4);
  const p = o.position, q = o.quaternion, s = o.scale;
  return `${r(p.x)},${r(p.y)},${r(p.z)},${r(q.x)},${r(q.y)},${r(q.z)},${r(q.w)},${r(s.x)},${r(s.y)},${r(s.z)},${o.visible ? 1 : 0}`;
}
