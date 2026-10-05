import * as THREE from 'three';

const target = new THREE.Vector3();
/** Visual compression only: the field ball and its collision radius remain unchanged. */
export function animateAlgaeGrip(mesh: THREE.Mesh, visible: boolean, scale: [number, number, number], dt: number): void {
  if (!visible) { mesh.scale.setScalar(1); mesh.userData.gripActive = false; return; }
  if (!mesh.userData.gripActive) mesh.scale.setScalar(1);
  mesh.userData.gripActive = true;
  mesh.scale.lerp(target.set(...scale), 1 - Math.exp(-14 * Math.max(0, dt)));
}
