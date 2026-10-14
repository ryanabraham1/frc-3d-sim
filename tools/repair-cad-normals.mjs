import { unweldPrimitive, weld, prune } from '@gltf-transform/functions';

// Seam collapses can leave a triangle using normals from unrelated CAD faces.
// Repair only those faces; retain valid smooth normals on rollers and curved parts.
export async function repairCadNormals(doc) {
  let repaired = 0;
  for (const mesh of doc.getRoot().listMeshes()) for (const p of mesh.listPrimitives()) {
    if (p.getMode() !== 4 || !p.getAttribute('NORMAL')) continue;
    unweldPrimitive(p);
    const position = p.getAttribute('POSITION');
    const previous = p.getAttribute('NORMAL');
    const normal = doc.createAccessor().setType('VEC3').setArray(new Float32Array(position.getCount() * 3));
    for (let i = 0; i < position.getCount(); i += 3) {
      const a = position.getElement(i, []), b = position.getElement(i + 1, []), c = position.getElement(i + 2, []);
      const u = b.map((v, j) => v - a[j]), v = c.map((v, j) => v - a[j]);
      const face = [u[1]*v[2]-u[2]*v[1], u[2]*v[0]-u[0]*v[2], u[0]*v[1]-u[1]*v[0]];
      const length = Math.hypot(...face);
      const old = [0, 1, 2].map(k => previous.getElement(i + k, []));
      const damaged = length > 1e-12 && old.some(n => face.reduce((sum, x, j) => sum + x*n[j], 0) / length < .98);
      if (damaged) repaired++;
      for (let k = 0; k < 3; k++) normal.setElement(i + k, damaged ? face.map(x => x / length) : old[k]);
    }
    p.setAttribute('NORMAL', normal);
    if (previous.listParents().length === 1) previous.dispose();
  }
  await doc.transform(weld(), prune());
  return repaired;
}
