/** Lossless import of the user-supplied 4414 clone. Only bumper lettering changes. */
import fs from 'node:fs/promises';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression } from '@gltf-transform/extensions';
import { dedup, prune, weld, join, reorder, getBounds } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptDecoder } from 'meshoptimizer';
import { Matrix4, Shape, ShapeGeometry } from 'three';

const source = process.argv[2];
if (!source) throw new Error('Usage: node tools/prepare-4414-cad.mjs /path/to/Top\\ Assembly.glb');
await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready]);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'meshopt.encoder':MeshoptEncoder,'meshopt.decoder':MeshoptDecoder});
const doc = await io.read(source), root = doc.getRoot(), scene = root.listScenes()[0];
const triangles = () => root.listNodes().reduce((sum,n)=>sum+(n.getMesh()?.listPrimitives().reduce((s,p)=>s+(p.getIndices()?.getCount()??p.getAttribute('POSITION').getCount())/3,0)??0),0);
const inputTriangles = triangles();
const foam = root.listNodes().find(n=>n.getName()==='Bumper foam');
if (!foam) throw new Error('Expected source bumper foam not found');
const dark = foam.getMesh().listPrimitives().find(p=>p.getMaterial().getBaseColorFactor()[0]<.3).getMaterial();
let replacedFaces=0;
// The donor numbers are white coplanar CAD faces, not separate meshes or textures.
// Retain every vertex/triangle, but give those faces the surrounding fabric material.
for (const p of foam.getMesh().listPrimitives()) if(p.getMaterial().getBaseColorFactor().slice(0,3).every(c=>c>.9)) {p.setMaterial(dark);replacedFaces++;}
if (replacedFaces!==12) throw new Error(`Expected 12 donor digit faces, found ${replacedFaces}`);
const axes = new Matrix4().set(0,1,0,0, 0,0,1,.0127, 1,0,0,0, 0,0,0,1);
const originalNodes = root.listNodes();
const groups = new Map(['frame','turret'].map(name=>[name,doc.createNode(name)]));
for(const n of originalNodes) {
 if(!n.getMesh()) continue;
 const ancestors=[];for(let a=n.getParentNode();a;a=a.getParentNode())ancestors.push(a.getName());
 const matrix=axes.clone().multiply(new Matrix4().fromArray(n.getWorldMatrix()));
 const group=ancestors.includes('Pancake Top Assembly <1>')?'turret':'frame';
 n.getParentNode()?.removeChild(n); n.setMatrix(matrix.toArray());groups.get(group).addChild(n);
}
for(const n of scene.listChildren())scene.removeChild(n);
for(const n of originalNodes)if(!n.getMesh())n.dispose();
for(const n of groups.values())scene.addChild(n);
// Open-top block numerals, triangulated into the GLB (no browser font dependency).
const outlines = {
 '4': [[.55,0],[.8,0],[.8,.3],[1,.3],[1,.5],[.8,.5],[.8,1],[.55,1],[.55,.5],[.25,.5],[.53,1],[.26,1],[0,.5],[0,.3],[.55,.3]],
 '1': [[.15,0],[.95,0],[.95,.18],[.68,.18],[.68,1],[.43,1],[.12,.78],[.12,.56],[.43,.76],[.43,.18],[.15,.18]],
};
const shapes=[...'4414'].map((digit,i)=>{const shape=new Shape();outlines[digit].forEach(([x,y],j)=>shape[j?'lineTo':'moveTo'](x+i*1.18,y));shape.closePath();return shape;});
const g = new ShapeGeometry(shapes);g.computeBoundingBox();
const b=g.boundingBox;g.translate(-(b.min.x+b.max.x)/2,-(b.min.y+b.max.y)/2,0);
g.scale(.365/(b.max.x-b.min.x),.08255/(b.max.y-b.min.y),1);
const buffer=root.listBuffers()[0];
const pos=doc.createAccessor().setType('VEC3').setArray(g.attributes.position.array).setBuffer(buffer);
const normal=doc.createAccessor().setType('VEC3').setArray(g.attributes.normal.array).setBuffer(buffer);
const indices=doc.createAccessor().setType('SCALAR').setArray(g.index.array).setBuffer(buffer);
const white=doc.createMaterial('4414-white-print').setBaseColorFactor([1,1,1,1]).setMetallicFactor(0).setRoughnessFactor(1);
const mesh=doc.createMesh('4414-bumper-print').addPrimitive(doc.createPrimitive().setAttribute('POSITION',pos).setAttribute('NORMAL',normal).setIndices(indices).setMaterial(white));
for(const [name,at,yaw] of [ ['left',[-.055,.1143,.4947],0],['right',[-.055,.1143,-.4947],Math.PI],['front',[.3996,.1143,0],Math.PI/2] ]){
 scene.addChild(doc.createNode(`bumper-number-4414-${name}`).setMesh(mesh).setTranslation(at).setRotation([0,Math.sin(yaw/2),0,Math.cos(yaw/2)]));
}
// Consolidate draw calls without simplifying surfaces or changing CAD materials.
await doc.transform(prune(),dedup(),weld(),join(),weld(),prune(),reorder({encoder:MeshoptEncoder,target:'size'}));
doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({method:EXTMeshoptCompression.EncoderMethod.FILTER});
const out='public/models/robots/2026/ripcurrent-4414.glb';
await io.write(out,doc);
await fs.copyFile(out,'public/models/robots/2026/match/ripcurrent-4414.glb');
const report={id:'ripcurrent-4414',sourceFile:'Top Assembly.glb',inputBytes:(await fs.stat(source)).size,outputBytes:(await fs.stat(out)).size,inputTriangles,outputTriangles:triangles(),replacedDigitFaces:replacedFaces,number:'4414',numberedFaces:3,geometry:'No simplification; original CAD triangle surfaces retained. Lossless meshopt compression.',axes:'source (Y,Z+0.0127,X) -> game (forward,up,right); wheels sit on ground',bounds:getBounds(scene),groups:['frame','turret']};
await fs.writeFile(out.replace('.glb','.report.json'),JSON.stringify(report,null,2)+'\n');console.log(report);
