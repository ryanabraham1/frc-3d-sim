import {NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import {getBounds} from '@gltf-transform/functions';
import fs from 'node:fs/promises';
const doc=await new NodeIO().registerExtensions(ALL_EXTENSIONS).read(process.argv[2]);
const scene=doc.getRoot().listScenes()[0],parts=[];
for(const n of doc.getRoot().listNodes()){
  if(!n.getMesh())continue;const names=[n.getName()];for(let p=n.getParentNode();p;p=p.getParentNode())names.push(p.getName());
  parts.push({name:names.join('/'),bounds:getBounds(n)});
}
await fs.writeFile(process.argv[3],JSON.stringify(parts));
console.log(JSON.stringify({bounds:getBounds(scene),parts:parts.length}));
function tree(n,depth=0){if(depth>3||n.getMesh())return;console.log(' '.repeat(depth)+n.getName()+' ['+n.listChildren().length+']');for(const c of n.listChildren())tree(c,depth+1);}
for(const n of scene.listChildren())tree(n);
