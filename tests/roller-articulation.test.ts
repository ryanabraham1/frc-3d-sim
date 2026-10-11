import { expect, it } from 'vitest';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { articulateRollers } from '../src/engine/robot/rollerArticulation';

it('separates merged shafts without losing triangles, moving the fixed bracket, or changing their initial pose', () => {
  const root=new THREE.Group(),source=new THREE.Group();root.add(source);
  source.position.set(.2,.1,0);
  const geometry=mergeGeometries([
    new THREE.CylinderGeometry(.02,.02,.5,12).rotateX(Math.PI/2),
    new THREE.CylinderGeometry(.02,.02,.5,12).rotateX(Math.PI/2).translate(.12,.06,0),
    new THREE.BoxGeometry(.02,.02,.02).translate(.3,.2,0),
  ])!;
  const mesh=new THREE.Mesh(geometry,new THREE.MeshBasicMaterial());source.add(mesh);
  const vertices=(meshes:THREE.Mesh[])=>{
    root.updateMatrixWorld(true);const points:string[]=[],p=new THREE.Vector3();
    for(const m of meshes)for(let i=0;i<m.geometry.index!.count;i++) {
      p.fromBufferAttribute(m.geometry.getAttribute('position'),m.geometry.index!.getX(i)).applyMatrix4(m.matrixWorld);
      points.push(p.toArray().map(v=>v.toFixed(5)).join(','));
    }
    return points.sort();
  };
  const before=vertices([mesh]),pivots=articulateRollers(root,source,[[.2,.1],[.32,.16]]);
  const visible:THREE.Mesh[]=[];root.traverse(o=>{if(o instanceof THREE.Mesh&&o.visible)visible.push(o);});
  expect(pivots).toHaveLength(2);expect(vertices(visible)).toEqual(before);
  const bracket=visible.find(m=>m.parent===root)!;
  const fixed=vertices([bracket]);
  for(const pivot of pivots)pivot.rotation.z=.5;
  expect(vertices(visible)).not.toEqual(before);expect(vertices([bracket])).toEqual(fixed);
});
