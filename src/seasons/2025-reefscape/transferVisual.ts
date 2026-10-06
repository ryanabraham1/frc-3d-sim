import * as THREE from 'three';
import { handoffPoint } from '@engine/robot/handoff';

/** The same transfer pose is used by matches and the model workshop. The
 * intake point is re-read each frame: CORAL rides the folding roller bank
 * before the receiving wheels take it, rather than flying ahead of it. */
export function coralTransferPose(visual: THREE.Object3D, intake: THREE.Object3D | undefined,
  end: THREE.Vector3, endQ: THREE.Quaternion, progress: number, path: THREE.Vector3[] | undefined,
  style: 'fold' | 'conveyor' | 'direct' | 'toss' | undefined,
  position: THREE.Vector3, quaternion: THREE.Quaternion): void {
  const t = THREE.MathUtils.clamp(progress, 0, 1);
  const smooth = (x: number) => x * x * (3 - 2 * x);
  const receive = smooth(THREE.MathUtils.clamp((t - .65) / .35, 0, 1));
  const across = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1));
  if (style === 'direct') { position.copy(end); quaternion.copy(endQ); return; }
  if ((style === 'conveyor' || style === undefined) && path && path.length > 1) {
    handoffPoint(path, end, t, position);
    quaternion.copy(across).slerp(endQ, receive);
    return;
  }
  const start = intake ? visual.worldToLocal(intake.getWorldPosition(new THREE.Vector3())) : path?.[0] ?? end;
  position.copy(start).lerp(end, receive);
  // Miss Daisy's team binder (p17): OTB roller tosses into the waiting claw.
  if (style === 'toss') position.y += Math.sin(Math.PI * receive) * .12;
  if (intake) across.premultiply(visual.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(intake.getWorldQuaternion(new THREE.Quaternion())));
  quaternion.copy(across).slerp(endQ, receive);
}

/** Finish folding before the receiving rollers take the piece. */
export function transferFold(progress: number): number {
  const t = THREE.MathUtils.clamp(progress / .65, 0, 1);
  return t * t * (3 - 2 * t);
}
