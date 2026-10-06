import * as THREE from 'three';
import type { ModelKit } from './models';

/** Place a joint in source coordinates and preserve each child's exported pose. */
export function cadJoint(root: THREE.Group, names: string[], at: [number,number,number], name: string, parent: THREE.Object3D = root, yaw = 0) {
  const parts = names.map(n => root.getObjectByName(n)).filter((p): p is THREE.Object3D => !!p);
  const joint = new THREE.Group(); joint.name = name; joint.position.fromArray(at); joint.rotation.y = yaw; root.add(joint);
  root.updateMatrixWorld(true); for (const p of parts) joint.attach(p);
  if (parent !== root) { root.updateMatrixWorld(true); parent.attach(joint); }
  return joint;
}
export function cadAnchor(root: THREE.Group, parent: THREE.Object3D, at: [number,number,number], name: string, pitch = 0, yaw = 0) {
  const o = new THREE.Object3D(); o.name = name; o.position.fromArray(at); o.rotation.set(0,yaw,pitch); root.add(o);
  root.updateMatrixWorld(true); parent.attach(o); return o;
}
export function cadPoint(k: ModelKit, o: THREE.Object3D) {
  k.visual.updateMatrixWorld(true); return k.visual.worldToLocal(o.getWorldPosition(new THREE.Vector3()));
}
/** Bounded actuator motion; dt=0 is an exact workshop/test pose. */
export function actuator(from: number, to: number, rate: number, dt: number) {
  return dt > 0 ? from + THREE.MathUtils.clamp(to-from, -rate*dt, rate*dt) : to;
}
