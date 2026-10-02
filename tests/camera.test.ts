import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { CameraRig } from '../src/engine/camera/cameras';
import { FieldFrame } from '../src/engine/coords';

function rig(wallX: number | null, noise = 0) {
  const frame = new FieldFrame(16, 8);
  const dom = { addEventListener() {}, removeEventListener() {}, style: {}, ownerDocument: { addEventListener() {}, removeEventListener() {} }, getRootNode: () => ({ addEventListener() {}, removeEventListener() {} }) } as unknown as HTMLElement;
  const cam = new THREE.PerspectiveCamera();
  const r = new CameraRig(cam, dom, frame, { x: 0, y: 4, z: 1.5, yaw: 0 });
  // A wall (plane in field x) behind the robot: hit distance along the ray from→to, with optional noise.
  let n = 0;
  r.occlusion = (from, to) => {
    if (wallX === null) return null;
    const wx = wallX - frame.length / 2;
    const dx = to.x - from.x;
    if (dx >= 0 || to.x > wx) return null;
    const d = ((wx - from.x) / dx) * from.distanceTo(to);
    n++;
    return d + (noise ? Math.sin(n * 12.9898) * noise : 0);
  };
  r.setMode('chase');
  return { r, cam, frame };
}

const robot = { x: 1.2, y: 4, yaw: 0 };

describe('chase camera', () => {
  it('stays in front of a wall that is behind the robot', () => {
    const { r, cam, frame } = rig(0);
    for (let i = 0; i < 240; i++) r.update(1 / 60, robot, undefined, 0);
    const wallWorldX = -frame.length / 2;
    expect(cam.position.x).toBeGreaterThan(wallWorldX);
    // Without the wall it would sit 2.6 m behind the robot (x = -1.4 field), past the wall at x = 0.
    expect(cam.position.distanceTo(frame.toWorld(robot.x, robot.y, 0.6))).toBeGreaterThan(0.5);
  });

  it('does not shake against a wall, even when the raycast distance is noisy', () => {
    const { r, cam } = rig(0, 0.08);
    for (let i = 0; i < 120; i++) r.update(1 / 60, robot, undefined, 0);
    const p = cam.position.clone();
    let travelled = 0;
    for (let i = 0; i < 240; i++) {
      r.update(1 / 60, robot, undefined, 0);
      travelled += cam.position.distanceTo(p);
      p.copy(cam.position);
    }
    expect(travelled).toBeLessThan(0.15);
  });

  it('returns to the full chase distance once the obstacle is gone', () => {
    const { r, cam, frame } = rig(0);
    for (let i = 0; i < 120; i++) r.update(1 / 60, robot, undefined, 0);
    const near = cam.position.distanceTo(frame.toWorld(robot.x, robot.y, 0.6));
    r.occlusion = () => null;
    for (let i = 0; i < 600; i++) r.update(1 / 60, robot, undefined, 0);
    expect(cam.position.distanceTo(frame.toWorld(robot.x, robot.y, 0.6))).toBeGreaterThan(near + 0.5);
  });

  it('looks along the intake side by default and swings to the shooter side on request', () => {
    const { r, cam, frame } = rig(null);
    r.chaseIntakeOffset = Math.PI; // intake on the back of the robot
    const dir = new THREE.Vector3();
    const heading = (): number => {
      cam.getWorldDirection(dir);
      return Math.atan2(-dir.z, dir.x); // field yaw the camera looks along
    };
    for (let i = 0; i < 240; i++) r.update(1 / 60, robot, undefined, 0);
    expect(Math.cos(heading() - (robot.yaw + Math.PI))).toBeGreaterThan(0.99);
    expect(cam.position.x).toBeGreaterThan(frame.toWorld(robot.x, robot.y).x); // camera is on the shooter side
    expect(r.label).toBe('Chase (intake view)');
    r.toggleChaseFacing();
    for (let i = 0; i < 240; i++) r.update(1 / 60, robot, undefined, 0);
    expect(Math.cos(heading() - robot.yaw)).toBeGreaterThan(0.99);
    expect(cam.position.x).toBeLessThan(frame.toWorld(robot.x, robot.y).x);
    expect(r.label).toBe('Chase (shooter view)');
  });

  it('has no flip for a front-mounted intake', () => {
    const { r, cam } = rig(null);
    r.chaseIntakeOffset = 0;
    for (let i = 0; i < 120; i++) r.update(1 / 60, robot, undefined, 0);
    const before = cam.position.clone();
    r.toggleChaseFacing();
    for (let i = 0; i < 120; i++) r.update(1 / 60, robot, undefined, 0);
    expect(cam.position.distanceTo(before)).toBeLessThan(1e-3);
  });
});
