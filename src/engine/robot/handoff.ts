import * as THREE from 'three';

/** Sample a moving model's conveyor route by distance, so short segments don't cause speed jumps. */
export function handoffPoint(path: THREE.Vector3[], end: THREE.Vector3, progress: number, out = new THREE.Vector3()): THREE.Vector3 {
  const route = [...path, end];
  if (route.length < 2) return out.copy(end);
  const lengths = route.slice(1).map((p, i) => p.distanceTo(route[i]));
  const t = THREE.MathUtils.clamp(progress, 0, 1), eased = t*t*(3-2*t);
  let distance = eased * lengths.reduce((sum, n) => sum + n, 0), segment = 0;
  while (segment < lengths.length - 1 && distance > lengths[segment]) distance -= lengths[segment++];
  return out.lerpVectors(route[segment], route[segment+1], THREE.MathUtils.clamp(distance / Math.max(1e-6,lengths[segment]),0,1));
}
