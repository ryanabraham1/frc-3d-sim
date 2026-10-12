import * as THREE from 'three';
import { acceleratedRaycast, MeshBVH } from 'three-mesh-bvh';

/** Object3D.clone shares geometry but does not copy a custom raycast function. */
export function cloneSpatialField(root: THREE.Group): THREE.Group {
  const clone = root.clone(true);
  clone.traverse((o) => { if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).raycast = acceleratedRaycast; });
  return clone;
}

/** Imported CAD is joined by material across the whole field. Split those batches into local cells so a camera
 * occluder cannot fade both alliance walls, every railing and every truss at once. Runs once on the cached asset;
 * match clones share geometry and its acceleration tree. Coordinates are the CAD's metre, Z-up frame. */
export function prepareSpatialField(root: THREE.Object3D, cellSize = 3): void {
  root.updateMatrixWorld(true);
  const center = new THREE.Vector3();
  const meshes: THREE.Mesh[] = [];
  root.traverse((o) => { if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh); });
  for (const mesh of meshes) {
    const geo = mesh.geometry;
    const pos = geo.getAttribute('position');
    if (!pos || Array.isArray(mesh.material) || geo.groups.length > 1) continue;
    const index = geo.index;
    const cells = new Map<string, number[]>();
    for (let t = 0; t < (index?.count ?? pos.count); t += 3) {
      const a = index ? index.getX(t) : t;
      const b = index ? index.getX(t + 1) : t + 1;
      const c = index ? index.getX(t + 2) : t + 2;
      center.set((pos.getX(a) + pos.getX(b) + pos.getX(c)) / 3,
        (pos.getY(a) + pos.getY(b) + pos.getY(c)) / 3,
        (pos.getZ(a) + pos.getZ(b) + pos.getZ(c)) / 3).applyMatrix4(mesh.matrixWorld);
      const key = `${Math.floor(center.x / cellSize)},${Math.floor(center.y / cellSize)}`;
      let verts = cells.get(key);
      if (!verts) cells.set(key, (verts = []));
      verts.push(a, b, c);
    }
    if (cells.size < 2) {
      accelerate(mesh);
      continue;
    }
    for (const [cell, vertices] of cells) {
      const ids = new Map<number, number>();
      const source: number[] = [];
      const indices = vertices.map((v) => {
        let id = ids.get(v);
        if (id === undefined) { id = source.length; ids.set(v, id); source.push(v); }
        return id;
      });
      const chunk = new THREE.BufferGeometry();
      for (const [name, attr] of Object.entries(geo.attributes)) {
        // Copy through accessors to support interleaved and normalized glTF attributes.
        const values = new Float32Array(source.length * attr.itemSize);
        for (let i = 0; i < source.length; i++) {
          for (let k = 0; k < attr.itemSize; k++) values[i * attr.itemSize + k] = attr.getComponent(source[i], k);
        }
        chunk.setAttribute(name, new THREE.BufferAttribute(values, attr.itemSize));
      }
      chunk.setIndex(indices);
      chunk.computeBoundingBox();
      chunk.computeBoundingSphere();
      const part = mesh.clone(false);
      part.geometry = chunk;
      part.name = `${mesh.name}-cell-${cell}`;
      accelerate(part);
      mesh.parent!.add(part);
    }
    mesh.removeFromParent();
  }
}

/** Keep this on field meshes only: no global prototype mutation or changes to robot contact geometry. */
function accelerate(mesh: THREE.Mesh): void {
  mesh.geometry.boundsTree ??= new MeshBVH(mesh.geometry, { indirect: true });
  mesh.raycast = acceleratedRaycast;
}
