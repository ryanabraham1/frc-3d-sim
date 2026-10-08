/** Reproducible, lossless batching of supplied Onshape field/piece geometry. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, join, weld, getBounds, simplify } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import { Matrix4, Vector3 } from 'three';

const input = process.argv[2] ?? '/Users/ryanabraham/Downloads';
const output = path.resolve('public/assets/hero-heist');
const manifestPath = path.resolve('src/seasons/wcp-hero-heist/cad-manifest.json');
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const axes = new Matrix4().makeRotationX(-Math.PI / 2);
await fs.mkdir(output, { recursive: true });
const sha256 = async file => createHash('sha256').update(await fs.readFile(file)).digest('hex');
const stats = doc => ({ nodes: doc.getRoot().listNodes().length, meshes: doc.getRoot().listMeshes().length,
  primitives: doc.getRoot().listMeshes().reduce((n,m)=>n+m.listPrimitives().length,0) });
const fieldFile = path.join(input,'Hero_Heist_Field.glb');
const field = await io.read(fieldFile);
const scene = field.getRoot().listScenes()[0];
const before = stats(field);
const parts = [];
const staged = [];
const groups = new Map();
let indicator = 0, mailbox = 0;
// Onshape exports polycarbonate (GUARDRAILS, DRIVER STATION and human player glass) as opaque grey: give it a clear material
// so drivers see the field through it, as on the real field.
const polycarbonate = field.createMaterial('polycarbonate').setBaseColorFactor([0.82, 0.88, 0.95, 0.22]).setAlphaMode('BLEND').setDoubleSided(true).setRoughnessFactor(0.1).setMetallicFactor(0);
for (const node of [...field.getRoot().listNodes()]) {
  if (!node.getMesh()) continue;
  const name = node.getName(), bounds = getBounds(node), matrix = node.getWorldMatrix();
  const center = bounds.min.map((v,k)=>(v+bounds.max[k])/2);
  const info = { name, bounds, center, matrix };
  if (['Speech Bubble','Story Panel'].includes(name)) {
    const colors = node.getMesh().listPrimitives().map(p=>p.getMaterial()?.getBaseColorFactor()).filter(Boolean);
    const color = colors.find(c=>Math.abs(c[0]-c[2])>.25);
    staged.push({ ...info, kind: name==='Speech Bubble'?'bubble':'panel', color: color && color[0]>color[2]?'red':'blue' });
    node.dispose(); continue;
  }
  parts.push(info);
  if (/glass/.test(name)) for (const prim of node.getMesh().listPrimitives()) prim.setMaterial(polycarbonate);
  const groupName = name==='square_goal_light'?`indicator-${indicator++}` : name==='v2_vertical_pannel_basket'?`mailbox-${mailbox++}` : 'static-field';
  if (!groups.has(groupName)) { const group=field.createNode(groupName); scene.addChild(group); groups.set(groupName,group); }
  // Bake source world placement and Z-up -> Three Y-up. Root remains centered at field center.
  node.getParentNode()?.removeChild(node);
  scene.removeChild(node);
  node.setMatrix(axes.clone().multiply(new Matrix4().fromArray(matrix)).toArray()).setName('');
  groups.get(groupName).addChild(node);
}
await field.transform(prune(),dedup(),weld(),join({keepNamed:true}),prune());
await io.write(path.join(output,'field.glb'),field);

// Keep actual cutouts and slopes in fixed scoring/boundary collision geometry.
// Renderer micro-detail and the out-of-field carpet/floor never become colliders.
const collisionDoc=await io.read(fieldFile), collisionScene=collisionDoc.getRoot().listScenes()[0];
const keep=[];
for(const n of collisionDoc.getRoot().listNodes()) if(n.getMesh() && ['field_walls','tall_scoring_wall','short_scoring_wall','shield_loading_station','protective_barrier'].includes(n.getName())) {
  keep.push({node:n,matrix:axes.clone().multiply(new Matrix4().fromArray(n.getWorldMatrix())).toArray()});
}
for(const {node,matrix} of keep){node.getParentNode()?.removeChild(node);node.setMatrix(matrix).setName('');}
for(const n of [...collisionScene.listChildren()])n.dispose();
for(const {node} of keep)collisionScene.addChild(node);
await MeshoptSimplifier.ready;
await collisionDoc.transform(dedup(),weld(),join(),simplify({simplifier:MeshoptSimplifier,ratio:.2,error:.0001}),prune());
const collision=[];
for(const n of collisionDoc.getRoot().listNodes()) if(n.getMesh()) for(const p of n.getMesh().listPrimitives()) {
  if(p.getMode()!==4)continue;
  const a=p.getAttribute('POSITION'),v=new Vector3(),matrix=new Matrix4().fromArray(n.getWorldMatrix()),vertices=[];
  for(let i=0;i<a.getCount();i++){const xyz=a.getElement(i,[]);v.set(...xyz).applyMatrix4(matrix);vertices.push(...v.toArray().map(x=>+x.toFixed(7)));}
  collision.push({vertices,indices:Array.from(p.getIndices()?.getArray()??Array.from({length:a.getCount()},(_,i)=>i))});
}
await fs.writeFile(path.resolve('src/seasons/wcp-hero-heist/cad-colliders.json'),JSON.stringify(collision)+'\n');

const pieceFile = path.join(input,'game_pieces.glb');
const pieceBounds = {};
for (const [name,filename] of [['Speech Bubble','bubble.glb'],['Story Panel','panel.glb']]) {
  const doc=await io.read(pieceFile), root=doc.getRoot().listScenes()[0];
  const selected=doc.getRoot().listNodes().find(n=>n.getName()===name);
  if (!selected) throw new Error(`Missing ${name}`);
  const bounds=getBounds(selected), center=bounds.min.map((v,k)=>(v+bounds.max[k])/2);
  // A panel's pose is centered on its thin disc, not the protruding knob.
  if(name==='Story Panel')center[2]=0.0127/2;
  pieceBounds[name]={bounds,center};
  for(const n of [...root.listChildren()]) if(n!==selected) n.dispose();
  selected.setMatrix(axes.clone().multiply(new Matrix4().makeTranslation(...new Vector3(...center).multiplyScalar(-1).toArray())).toArray()).setName(name);
  await doc.transform(prune(),dedup(),weld(),join({keepNamed:true}),prune());
  await io.write(path.join(output,filename),doc);
}
const manifest={version:1, source:{field:{filename:'Hero_Heist_Field.glb',sha256:await sha256(fieldFile)},pieces:{filename:'game_pieces.glb',sha256:await sha256(pieceFile)}},
  transform:'source (x,y,z) -> centered Three world (x,z,-y); field (x+8.2296,y+4.1148,z)',
  sourceStats:before, outputStats:stats(field), staged, parts, pieceBounds};
await fs.writeFile(manifestPath,JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify({source:before,prepared:stats(field),staged:staged.length,indicators:indicator,mailboxes:mailbox,bytes:(await fs.stat(path.join(output,'field.glb'))).size}));
