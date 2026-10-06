import * as THREE from 'three';

const material=new THREE.MeshBasicMaterial({side:THREE.DoubleSide});
/** Fit a rigid tube in its tool. Search only a small local seating adjustment;
 * keep the tube's diameter and length, and permit geometry inside its bore. */
export function fitCoralInTool(mesh:THREE.Mesh,anchor:THREE.Object3D):void {
  if(!mesh.visible)return;
  anchor.updateWorldMatrix(true,true);mesh.updateWorldMatrix(true,false);
  const inverse=anchor.matrixWorld.clone().invert();
  const base=mesh.getWorldPosition(new THREE.Vector3()).applyMatrix4(inverse);
  // Buffered/transferring CORAL belongs to the intake/path, not this tool.
  if(base.length()>.085)return;
  const q=anchor.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(mesh.getWorldQuaternion(new THREE.Quaternion()));
  if(q.w<0)q.set(-q.x,-q.y,-q.z,-q.w);
  const key=q.toArray().map(v=>Math.round(v*1000)).join(',');
  const cached=mesh.userData.coralFit;
  // Generic tools may still aim the tube in world space. Calibrate once their
  // pose settles instead of running a geometry search throughout every swing.
  const previous=mesh.userData.coralFitPose as THREE.Quaternion|undefined;
  mesh.userData.coralFitPose=q.clone();
  if(previous && 1-Math.abs(previous.dot(q))>1e-7){
    if(cached?.anchor===anchor)mesh.position.copy(mesh.parent!.worldToLocal(anchor.localToWorld(base.add(cached.offset))));
    return;
  }
  let offset:THREE.Vector3;
  if(cached?.anchor===anchor&&cached.key===key)offset=cached.offset;
  else {
    const solids:THREE.Mesh[]=[];
    anchor.parent?.traverse(o=>{if(o instanceof THREE.Mesh && o!==mesh&&!o.userData.heldGamePiece){
      const matrix=new THREE.Matrix4().multiplyMatrices(inverse,o.matrixWorld);
      const positions=o.geometry.getAttribute('position'),indices=o.geometry.getIndex(),kept:number[]=[];
      const local=new THREE.Matrix4().makeRotationFromQuaternion(q.clone().invert()).multiply(new THREE.Matrix4().makeTranslation(-base.x,-base.y,-base.z)).multiply(matrix);
      const verts=Array.from({length:positions.count},(_,i)=>new THREE.Vector3().fromBufferAttribute(positions,i).applyMatrix4(local));
      const count=indices?.count??positions.count;
      for(let i=0;i<count;i+=3){const ids=[0,1,2].map(j=>indices?indices.getX(i+j):i+j);const pts=ids.map(j=>verts[j]);
        if(['x','y','z'].every(a=>{const k=a as 'x'|'y'|'z',span=k==='y'?.16:.10;return Math.min(...pts.map(v=>v[k]))<=span&&Math.max(...pts.map(v=>v[k]))>=-span;}))kept.push(...ids);
      }
      if(kept.length){const geometry=o.geometry.clone();geometry.setIndex(kept);const proxy=new THREE.Mesh(geometry,material);proxy.matrixAutoUpdate=false;proxy.matrixWorld.copy(matrix);solids.push(proxy);}
    }});
    const axis=new THREE.Vector3(0,1,0).applyQuaternion(q),u=new THREE.Vector3(1,0,0).applyQuaternion(q),v=new THREE.Vector3(0,0,1).applyQuaternion(q);
    const ray=new THREE.Raycaster(),origin=new THREE.Vector3(),dir=new THREE.Vector3();
    ray.near=.046;ray.far=.058;
    const penalty=(shift:THREE.Vector3)=>{
      let total=0;
      for(const along of [-.12,0,.12])for(let i=0;i<8;i++){
        const angle=i*Math.PI/4;dir.copy(u).multiplyScalar(Math.cos(angle)).addScaledVector(v,Math.sin(angle));
        origin.copy(base).add(shift).addScaledVector(axis,along);ray.set(origin,dir);
        const hits=ray.intersectObjects(solids,false);
        if(hits.length)total+=Math.max(0,.057-hits[0].distance);
      }
      return total;
    };
    offset=new THREE.Vector3();let best=penalty(offset);
    if(best>.001){
      // Prefer the closest viable seat, at most 4 cm from the measured anchor.
      for(const amount of [.01,.02,.03,.04])for(let i=0;i<8;i++){
        const angle=i*Math.PI/4,candidate=u.clone().multiplyScalar(amount*Math.cos(angle)).addScaledVector(v,amount*Math.sin(angle));
        const score=penalty(candidate)+amount*.002;
        if(score<best){best=score;offset.copy(candidate);}
      }
    }
    mesh.userData.coralFit={anchor,key,offset};
  }
  const world=anchor.localToWorld(base.add(offset));
  mesh.position.copy(mesh.parent!.worldToLocal(world));
}
