import * as THREE from 'three';
import { MeshBVH, acceleratedRaycast } from 'three-mesh-bvh';

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
  const seats: Map<string, THREE.Vector3> = cached?.anchor === anchor
    ? cached.seats : new Map();
  // Generic tools may still aim the tube in world space. Calibrate once their
  // pose settles instead of running a geometry search throughout every swing.
  const previous=mesh.userData.coralFitPose as THREE.Quaternion|undefined;
  mesh.userData.coralFitPose=q.clone();
  if(previous && 1-Math.abs(previous.dot(q))>1e-7){
    if(cached?.anchor===anchor)mesh.position.copy(mesh.parent!.worldToLocal(anchor.localToWorld(base.add(cached.offset))));
    return;
  }
  let offset:THREE.Vector3;
  if(seats.has(key))offset=seats.get(key)!;
  else {
    const solids:THREE.Mesh[]=[];
    // Reject distant parts before reading their vertices. Keep only nearby
    // triangles in the proxy: copying the full CAD vertex buffer here made a
    // single coral pose stall the simulation for hundreds of milliseconds.
    const region = new THREE.Box3(new THREE.Vector3(-.10,-.16,-.10), new THREE.Vector3(.10,.16,.10));
    const local = new THREE.Matrix4(), matrix = new THREE.Matrix4();
    const tubeFrame = new THREE.Matrix4().makeRotationFromQuaternion(q.clone().invert())
      .multiply(new THREE.Matrix4().makeTranslation(-base.x,-base.y,-base.z));
    const bounds = new THREE.Box3(), vertex = new THREE.Vector3();
    const points = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
    anchor.parent?.traverse(o => {
      if (!(o instanceof THREE.Mesh) || o === mesh || o.userData.heldGamePiece) return;
      const positions = o.geometry.getAttribute('position'), indices = o.geometry.getIndex();
      if (!positions) return;
      matrix.multiplyMatrices(inverse, o.matrixWorld);
      local.multiplyMatrices(tubeFrame, matrix);
      if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
      if (!bounds.copy(o.geometry.boundingBox!).applyMatrix4(local).intersectsBox(region)) return;
      const kept: number[] = [], count = indices?.count ?? positions.count;
      for (let i = 0; i < count; i += 3) {
        for (let j = 0; j < 3; j++) points[j].fromBufferAttribute(positions, indices ? indices.getX(i+j) : i+j).applyMatrix4(local);
        const [a,b,c] = points;
        if (Math.min(a.x,b.x,c.x) > .10 || Math.max(a.x,b.x,c.x) < -.10 ||
            Math.min(a.y,b.y,c.y) > .16 || Math.max(a.y,b.y,c.y) < -.16 ||
            Math.min(a.z,b.z,c.z) > .10 || Math.max(a.z,b.z,c.z) < -.10) continue;
        for (let j = 0; j < 3; j++) {
          vertex.fromBufferAttribute(positions, indices ? indices.getX(i+j) : i+j).applyMatrix4(matrix);
          kept.push(vertex.x,vertex.y,vertex.z);
        }
      }
      if (kept.length) {
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(kept,3));
        geometry.computeBoundingBox(); geometry.computeBoundingSphere();
        geometry.boundsTree = new MeshBVH(geometry);
        const proxy = new THREE.Mesh(geometry,material);
        proxy.raycast = acceleratedRaycast;
        proxy.matrixAutoUpdate = false;
        solids.push(proxy);
      }
    });
    const axis=new THREE.Vector3(0,1,0).applyQuaternion(q),u=new THREE.Vector3(1,0,0).applyQuaternion(q),v=new THREE.Vector3(0,0,1).applyQuaternion(q);
    const ray=new THREE.Raycaster(),origin=new THREE.Vector3(),dir=new THREE.Vector3();
    ray.near=.046;ray.far=.058;ray.firstHitOnly=true;
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
    for (const proxy of solids) proxy.geometry.dispose();
    // Bound storage for generic tools whose tube orientation follows world aim.
    if (seats.size >= 32) seats.delete(seats.keys().next().value!);
    seats.set(key,offset);
  }
  mesh.userData.coralFit={anchor,key,offset,seats};
  const world=anchor.localToWorld(base.add(offset));
  mesh.position.copy(mesh.parent!.worldToLocal(world));
}
