import * as THREE from 'three';
import { handoffPoint } from '@engine/robot/handoff';
import { BRANCH_ANGLE } from './constants';

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

const UP = new THREE.Vector3(0, 1, 0);
const FLIP = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI);
const smooth = (x: number) => x * x * (3 - 2 * x);

/**
 * Robot-frame pose (mesh +Y = tube axis) where `ejectCoral` lets the CORAL go: `forward` out along the scoring
 * direction (`side` quarter turns from the front) at `height`, nose-first 35° down for L2/L3, straight down for L4
 * and lying across the scoring direction for the L1 trough.
 */
export function coralReleasePose(height: number, forward: number, side: number, level: number,
  position: THREE.Vector3, quaternion: THREE.Quaternion, lateral = 0): void {
  const yaw = side * Math.PI / 2;
  const dir = level === 4 ? new THREE.Vector3(0, -1, 0) : level === 1 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(Math.cos(BRANCH_ANGLE), -Math.sin(BRANCH_ANGLE), 0);
  const turn = new THREE.Quaternion().setFromAxisAngle(UP, yaw);
  position.set(forward, height, -lateral).applyQuaternion(turn);
  quaternion.setFromUnitVectors(UP, dir).premultiply(turn);
}

/**
 * Blend a CORAL pose toward another. A tube looks the same end-for-end, so it turns toward whichever of the target's
 * two ends is nearer instead of spinning half a turn.
 */
export function blendCoralPose(position: THREE.Vector3, quaternion: THREE.Quaternion,
  toPosition: THREE.Vector3, toQuaternion: THREE.Quaternion, t: number): void {
  const flipped = toQuaternion.clone().multiply(FLIP);
  const target = Math.abs(quaternion.dot(flipped)) > Math.abs(quaternion.dot(toQuaternion)) ? flipped : toQuaternion;
  position.lerp(toPosition, t);
  quaternion.slerp(target, t);
}

/**
 * Ejection progress → how far the CORAL has slid from its seat toward the release pose. The rollers start it from
 * rest and it is moving when it leaves, so it carries on into its free flight without stopping.
 */
export function ejectTravel(eject: number): number {
  const e = THREE.MathUtils.clamp(eject, 0, 1);
  return e * e * (2 - e);
}

/** Seconds a picked-up piece takes to be drawn from where it lay into the intake. [EST, visual only] */
export const PICKUP_SECONDS = 0.14;
/** Pickup progress → share of the way from where the piece lay to where the robot holds it. */
export function pickupTravel(age: number): number {
  return smooth(THREE.MathUtils.clamp(age / PICKUP_SECONDS, 0, 1));
}
