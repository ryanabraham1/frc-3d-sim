/** Recover matching structural tubes from teams' detailed CAD releases.
 * Usage: node tools/restore-reefscape-tubes.mjs <model-id> <source directory>
 * Copies only matching fixed/stage profiles; keeps the simulator's competition rig.
 */
import fs from 'node:fs/promises';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression } from '@gltf-transform/extensions';
import { copyToDocument, getBounds, prune, dedup, unpartition } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import { Matrix4, Vector3 } from 'three';
await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready]);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'meshopt.decoder':MeshoptDecoder,'meshopt.encoder':MeshoptEncoder});
const citrus = new Matrix4().set(0,1,0,0,0,0,1,0,1,0,0,0,0,0,0,1);
const redundancy = new Matrix4().makeRotationY(-Math.PI / 2);
const manifests = {
 'sublime-1678': { expected: 4, source: 'https://github.com/frc1678/C2025-Public/tree/413a90e6e4c61083dc9497a07ede19749744192e/src/main/assets/Robot_Beta', parts: [
  ['model.glb','frame',/^1678-25-P-07(?:01|10)$/ ,citrus],
  ['model_1.glb','elevator-stage',/^1678-25-P-0702$/,new Matrix4().set(0,0,-1,0,0,1,0,-.80645,1,0,0,0,0,0,0,1)],
 ]},
 'firefly-118': { expected: 15, source: 'https://www.118robonauts.org/_files/archives/209e0c_4695e2fde9b745009095fa908fe804df.zip?dn=00_0000_2025_firefly.zip', parts: [
  ['firefly-118-source.glb','frame',/^01_(?:CRAYON_CHASSIS_3_[13]$|BATTERY_1X1_RAIL|CLIMB_LADDER_RAIL|CHASSIS_RAIL)|^04_(?:STAT_RAIL|BASE_LADDER)/,new Matrix4().makeRotationY(Math.PI/2)],
  ['firefly-118-source.glb','elevator-stage',/^04_SLIDE_(?:RAIL|LADDER)/,new Matrix4().makeRotationY(Math.PI/2)],
 ]},
 'zuma-581': { expected: 4, source: 'https://github.com/team581/2025-beta/tree/e1fd64a762dad24e16b70b866b2e6bffdb9c2989/ascope_assets/Robot_Zuma', parts: [
  ['model_0.glb','frame',/^581-25J0001\s+fixed vertical$/,new Matrix4().makeTranslation(.21582595,.02460625,.000317887).multiply(new Matrix4().makeRotationY(Math.PI/2))],
  ['model_0.glb','elevator-stage',/^581-25J0002\s+mid stage vertical$/,new Matrix4().makeTranslation(.21582595,.811836,.000317887).multiply(new Matrix4().makeRotationY(Math.PI/2))],
 ]},
 'redundancy-190': { expected: 14, source: 'https://github.com/Team-190/2k25-Robot-Code/tree/9ccfa62fdac0f74e0c0cbefce530d5415dcb8ccf/advantagescopeassets/Robot_Redundancy', parts: [
  ['model.glb','frame',/^Base Stage 2x1$|^Tube /,redundancy],
  ['model_0.glb','elevator-stage',/^Stage 1 (?:Base )?2x1$/,redundancy],
  ['model_1.glb','carriage',/^Carriage (?:Bottom|Top) 2x1$/,redundancy],
 ]},
};
const id=process.argv[2],manifest=manifests[id];
if(!manifest || !process.argv[3])throw new Error('Usage: node tools/restore-reefscape-tubes.mjs <model-id> <source directory>');
const file=`public/models/robots/2025/${id}.glb`,doc=await io.read(file),root=doc.getRoot();
const replacements=[];
for(const [asset,group,select,transform] of manifest.parts) {
 const source=await io.read(`${process.argv[3]}/${asset}`);
 const selected=source.getRoot().listNodes().filter(n=>n.getMesh()&&select.test(n.getName()));
 const copied=copyToDocument(doc,source,selected.map(n=>n.getMesh()));
 for(const n of selected){
  const matrix=transform.clone().multiply(new Matrix4().fromArray(n.getWorldMatrix()));
  const b=getBounds(n),min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
  for(let bits=0;bits<8;bits++)new Vector3(...[0,1,2].map(j=>bits&(1<<j)?b.max[j]:b.min[j])).applyMatrix4(transform).toArray().forEach((v,j)=>{min[j]=Math.min(min[j],v);max[j]=Math.max(max[j],v);});
  replacements.push({group,name:n.getName(),matrix,mesh:copied.get(n.getMesh()),min,max,removed:0});
 }
}
if(replacements.length!==manifest.expected)throw new Error(`Expected ${manifest.expected} original tubes for ${id}, got ${replacements.length}`);
for(const group of root.listScenes()[0].listChildren()){
 const boxes=replacements.filter(r=>r.group===group.getName());if(!boxes.length)continue;
 group.traverse(n=>{if(!n.getMesh())return;const matrix=new Matrix4().fromArray(n.getWorldMatrix());
  for(const p of n.getMesh().listPrimitives()){
   const pos=p.getAttribute('POSITION'),idx=p.getIndices(),kept=[];
   for(let i=0;i<idx.getCount();i+=3){const v=[0,1,2].map(k=>new Vector3(...pos.getElement(idx.getScalar(i+k),[])).applyMatrix4(matrix).toArray());
    const box=boxes.find(b=>v.every(p=>p.every((x,j)=>x>=b.min[j]-1e-5&&x<=b.max[j]+1e-5)));
    if(box)box.removed++;else kept.push(idx.getScalar(i),idx.getScalar(i+1),idx.getScalar(i+2));
   }
   if (kept.length) p.setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint32Array(kept)).setBuffer(root.listBuffers()[0]));
   else { n.getMesh().removePrimitive(p); p.dispose(); }
  }
 });
 for(const b of boxes){if(b.removed<12)throw new Error(`Source tube does not match the competition rig: ${b.name} (${b.removed})`);group.addChild(doc.createNode(`restored-tube:${b.name}`).setMesh(b.mesh).setMatrix(b.matrix.toArray()));}
}
await doc.transform(prune(),dedup(),unpartition());
doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({method:EXTMeshoptCompression.EncoderMethod.FILTER});
await io.write(file,doc);
const reportPath=file.replace('.glb','.report.json'),report=JSON.parse(await fs.readFile(reportPath,'utf8'));
let triangles=0;root.listScenes()[0].traverse(n=>{for(const p of n.getMesh()?.listPrimitives()??[])triangles+=(p.getIndices()?.getCount()??p.getAttribute('POSITION').getCount())/3;});
report.outputTriangles=triangles;report.outputBytes=(await fs.stat(file)).size;
report.restoredTubes={count:replacements.length,source:manifest.source};
await fs.writeFile(reportPath,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(replacements.map(({group,name,min,max,removed})=>({group,name,min,max,removed})),null,2));
