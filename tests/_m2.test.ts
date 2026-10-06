import { it } from 'vitest';
import * as THREE from 'three';
import { fillBlock } from '../src/engine/robot/models';
it('m2',()=>{
  const out:string[]=[];
  for(const cap of [85,200]){
  const g=new THREE.Group();
  fillBlock(g,{x:(-.58+.23)/2,y0:.17,length:.81,width:.61,height:.465,color:1,capacity:cap,inside:(x,z)=>x<-.06||Math.abs(z)>.17});
  out.push(cap+' → '+(g.children[0] as any).instanceMatrix.count);
  }
  require('fs').writeFileSync('/private/tmp/claude-501/-Users-ryanabraham-Downloads-frc-3d-sim/fc725793-08a5-425b-9999-634d3c84ab7f/scratchpad/m2.txt',out.join('\n'));
});
