/** Recover structural tubes from 604's unsimplified AdvantageScope CAD release.
 * Source: frc604/2025-public @ f178f14f165da90f894d02db1130c483b80241e3,
 * FRC-2025/advantagescope_assets/Robot_2025-FRC604/{model,model_0}.glb.
 * Usage: node tools/restore-quixilver-tubes.mjs <download directory>
 */
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression } from '@gltf-transform/extensions';
import { copyToDocument, getBounds, prune, dedup, unpartition } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import { Matrix4, Vector3 } from 'three';
import { repairCadNormals } from './repair-cad-normals.mjs';
import fs from 'node:fs/promises';
await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready]);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'meshopt.decoder':MeshoptDecoder,'meshopt.encoder':MeshoptEncoder});
const file = 'public/models/robots/2025/quixilver-604-2025.glb';
const doc = await io.read(file), root = doc.getRoot();
await repairCadNormals(doc);
const replacements = [];
const rotate = new Matrix4().makeRotationY(Math.PI / 2);
for (const [asset, group, offset] of [['model.glb','frame',[0,0,0]],['model_0.glb','elevator-stage',[.1016,.5476624,0]]]) {
  const source = await io.read(`${process.argv[2]}/${asset}`);
  const selected = source.getRoot().listNodes().filter(n => n.getMesh() && /2x[12]/i.test(n.getName()));
  const copied = copyToDocument(doc, source, selected.map(n => n.getMesh()));
  for (const n of selected) {
    const matrix = new Matrix4().makeTranslation(...offset).multiply(rotate).multiply(new Matrix4().fromArray(n.getWorldMatrix()));
    const bounds = getBounds(n), min = [Infinity,Infinity,Infinity], max = [-Infinity,-Infinity,-Infinity];
    for (let bits=0; bits<8; bits++) {
      const v = new Vector3(...[0,1,2].map(j => bits & (1<<j) ? bounds.max[j] : bounds.min[j])).applyMatrix4(new Matrix4().makeTranslation(...offset).multiply(rotate));
      v.toArray().forEach((x,j) => {min[j]=Math.min(min[j],x);max[j]=Math.max(max[j],x);});
    }
    replacements.push({group,name:n.getName(),mesh:copied.get(n.getMesh()),matrix,min,max});
  }
}
let removed=0;
for (const group of root.listScenes()[0].listChildren()) {
  const boxes = replacements.filter(r => r.group === group.getName());
  if (!boxes.length) continue;
  group.traverse(n => {
    const mesh=n.getMesh(); if(!mesh)return;
    const world=new Matrix4().fromArray(n.getWorldMatrix());
    for(const p of mesh.listPrimitives()) {
      const positions=p.getAttribute('POSITION'), indices=p.getIndices();
      const kept=[];
      for(let i=0;i<indices.getCount();i+=3) {
        const corners=[0,1,2].map(k => new Vector3(...positions.getElement(indices.getScalar(i+k),[])).applyMatrix4(world).toArray());
        if(boxes.some(b => corners.every(v=>v.every((x,j)=>x>=b.min[j]-1e-5&&x<=b.max[j]+1e-5)))) removed++;
        else kept.push(indices.getScalar(i),indices.getScalar(i+1),indices.getScalar(i+2));
      }
      p.setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint32Array(kept)).setBuffer(root.listBuffers()[0]));
    }
  });
  for(const r of boxes)group.addChild(doc.createNode(`restored-tube:${r.name}`).setMesh(r.mesh).setMatrix(r.matrix.toArray()));
}
if (!removed || replacements.length < 4) throw new Error('Tube recovery failed to identify the expected CAD');
await doc.transform(prune(),dedup(),unpartition());
doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({method:EXTMeshoptCompression.EncoderMethod.FILTER});
await io.write(file,doc);
const reportPath = file.replace('.glb', '.report.json');
const report = JSON.parse(await fs.readFile(reportPath, 'utf8'));
let triangles = 0;
root.listScenes()[0].traverse(n => { for (const p of n.getMesh()?.listPrimitives() ?? []) triangles += (p.getIndices()?.getCount() ?? p.getAttribute('POSITION').getCount()) / 3; });
report.outputTriangles = triangles;
report.outputBytes = (await fs.stat(file)).size;
report.restoredTubes = { count: replacements.length, source: 'https://github.com/frc604/2025-public/tree/f178f14f165da90f894d02db1130c483b80241e3/FRC-2025/advantagescope_assets/Robot_2025-FRC604' };
await fs.writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({restored:replacements.map(r=>({group:r.group,name:r.name,min:r.min,max:r.max})),removedTriangles:removed}));
