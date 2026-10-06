import * as THREE from 'three';

const target = new THREE.Vector3();
const raycaster = new THREE.Raycaster();
const origin = new THREE.Vector3(), end = new THREE.Vector3();
const clearanceMaterial=new THREE.MeshBasicMaterial({side:THREE.DoubleSide});
/** Cache the rigid mouth's radial clearance in the ball's local frame. The
 * mouth and holder move together, so this does not raycast every frame. */
function gripClearance(mesh: THREE.Mesh, scale: [number,number,number]): Float32Array | undefined {
  const anchor=mesh.parent, mouth=anchor?.parent;
  if(!anchor || !mouth)return;
  mouth.updateWorldMatrix(true,true);
  const solids:THREE.Mesh[]=[];
  mouth.traverse(o=>{if(o instanceof THREE.Mesh && o!==mesh && !o.userData.heldGamePiece && o.parent?.type!=='Object3D'){
    const proxy=new THREE.Mesh(o.geometry,clearanceMaterial);proxy.matrixAutoUpdate=false;proxy.matrixWorld.copy(o.matrixWorld);solids.push(proxy);
  }});
  if(!solids.length)return;
  const positions=mesh.geometry.getAttribute('position'),clearance=new Float32Array(positions.count).fill(1);
  const inverse=mesh.matrixWorld.clone().invert();
  origin.set(0,0,0).applyMatrix4(mesh.matrixWorld);
  for(let i=0;i<positions.count;i++){
    end.fromBufferAttribute(positions,i).multiply(target.set(...scale.map(v=>Math.max(1,v)) as [number,number,number])).applyMatrix4(mesh.matrixWorld);
    const distance=end.distanceTo(origin);if(distance<1e-6)continue;
    raycaster.set(origin,end.clone().sub(origin).normalize());raycaster.near=0;raycaster.far=distance+.004;
    // Test both sides without changing shared robot materials.
    const hits=raycaster.intersectObjects(solids,false);
    if(hits.length){const contact=hits[0].point.clone().addScaledVector(raycaster.ray.direction,-.004).applyMatrix4(inverse);
      clearance[i]=THREE.MathUtils.clamp(contact.length()/end.clone().applyMatrix4(inverse).length(),0,1);}
  }
  return clearance;
}
/** Visual compression only: the field ball and its collision radius remain unchanged. */
export function animateAlgaeGrip(mesh: THREE.Mesh, visible: boolean, scale: [number, number, number], dt: number, throat=false): void {
  if (!visible) { mesh.scale.setScalar(1); mesh.userData.gripActive = false; mesh.userData.throatBlend=0; return; }
  if (!mesh.userData.gripActive) mesh.scale.setScalar(1);
  mesh.userData.gripActive = true;
  if(!mesh.userData.throatOriginal){mesh.geometry=mesh.geometry.clone();mesh.userData.throatOriginal=mesh.geometry.getAttribute('position').array.slice();}
  if(mesh.userData.gripAnchor!==mesh.parent){
    mesh.userData.gripAnchor=mesh.parent;mesh.userData.clearanceChecked=false;
    mesh.geometry.getAttribute('position').array.set(mesh.userData.throatOriginal);
    mesh.scale.setScalar(1);
  }
  if(!mesh.userData.clearanceChecked){mesh.userData.gripClearance=gripClearance(mesh,scale);mesh.userData.clearanceChecked=!!mesh.parent?.parent;}
  if(throat || mesh.userData.gripClearance){
    const original=mesh.userData.throatOriginal as Float32Array,positions=mesh.geometry.getAttribute('position');
    const radius=.206,blend=1-Math.exp(-14*Math.max(0,dt));
    mesh.userData.throatBlend=(mesh.userData.throatBlend??0)+(1-(mesh.userData.throatBlend??0))*blend;
    for(let i=0;i<positions.count;i++){const x=original[i*3],y=original[i*3+1],z=original[i*3+2];
      const t=THREE.MathUtils.clamp(-y/radius,0,1),pinch=throat?1-.58*t*t*mesh.userData.throatBlend:1;
      const clearance=mesh.userData.gripClearance?.[i]??1;
      positions.setXYZ(i,x*pinch*clearance,y*clearance,z*pinch*clearance);}
    positions.needsUpdate=true;mesh.geometry.computeVertexNormals();
  }
  mesh.scale.lerp(target.set(...scale), 1 - Math.exp(-14 * Math.max(0, dt)));
}
