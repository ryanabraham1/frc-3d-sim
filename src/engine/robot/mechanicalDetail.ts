import * as THREE from 'three';
import { bar, box, mat } from './models';

const alloy = mat(0xc8cdd2, { metal: 0.8, rough: 0.3 });
const rubber = mat(0x16191c);
const boltGeometry = new THREE.CylinderGeometry(0.004, 0.004, 0.005, 6);
/** Visible shaft bearings, pulley flanges and transmission belts (axis across chassis). */
export function pulley(parent: THREE.Object3D, x: number, y: number, z: number, radius = 0.027): void {
  for (const [r, depth, dz, material] of [[radius,0.013,0,rubber],[radius+0.003,0.003,-0.008,alloy],[radius+0.003,0.003,0.008,alloy],[0.009,0.026,0,alloy]] as const) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r,r,depth,20),material);
    m.rotation.x = Math.PI / 2; m.position.set(x,y,z+dz); parent.add(m);
  }
}
export function belt(parent: THREE.Object3D, a: [number,number], b: [number,number], z: number, r = 0.027): void {
  pulley(parent,...a,z,r); pulley(parent,...b,z,r);
  const dx = b[0]-a[0], dy = b[1]-a[1], d = Math.hypot(dx,dy);
  for (const sign of [-1,1]) {
    const ox = -dy/d*r*sign, oy = dx/d*r*sign;
    bar(parent,[a[0]+ox,a[1]+oy,z],[b[0]+ox,b[1]+oy,z],0.008,rubber);
  }
}
export function motor(parent: THREE.Object3D, x: number, y: number, z: number, label = 0x57ba6b): void {
  const g = new THREE.Group(); g.position.set(x,y,z); parent.add(g);
  for (const [r,d,sz,m] of [[0.029,0.067,0,rubber],[0.03,0.011,0.021,alloy],[0.022,0.005,0.036,mat(label)],[0.01,0.023,-0.044,alloy]] as const) {
    const part = new THREE.Mesh(new THREE.CylinderGeometry(r,r,d,16),m); part.rotation.x = Math.PI/2; part.position.z = sz; g.add(part);
  }
  box(g,0.022,0.014,0.019,rubber,0,-0.029,0.023);
}
export function fasteners(parent: THREE.Object3D, points: [number,number][], z: number): void {
  const bolts = new THREE.InstancedMesh(boltGeometry,alloy,points.length);
  const dummy = new THREE.Object3D(); dummy.rotation.x = Math.PI/2;
  points.forEach(([x,y],i)=> { dummy.position.set(x,y,z); dummy.updateMatrix(); bolts.setMatrixAt(i,dummy.matrix); });
  parent.add(bolts);
}
/** Camera housing with visible lens and its mounting bracket. */
export function camera(parent: THREE.Object3D,x:number,y:number,z:number): void {
  box(parent,0.035,0.023,0.048,rubber,x,y,z);
  box(parent,0.048,0.005,0.06,alloy,x,y-0.016,z);
  const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.009,0.009,0.013,12),mat(0x274b70,{metal:0.7}));
  lens.rotation.z = Math.PI/2; lens.position.set(x+0.022,y,z); parent.add(lens);
}
