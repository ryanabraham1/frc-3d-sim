import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { CameraRig } from '../src/engine/camera/cameras';
import { FieldFrame } from '../src/engine/coords';
import { OcclusionFader } from '../src/engine/render/occlusionFader';

function rig(mode: 'chase' | 'follow' = 'chase', eyeYaw = 0) {
  const frame = new FieldFrame(16, 8);
  const dom = { addEventListener() {}, removeEventListener() {}, style: {}, ownerDocument: { addEventListener() {}, removeEventListener() {} }, getRootNode: () => ({ addEventListener() {}, removeEventListener() {} }) } as unknown as HTMLElement;
  const cam = new THREE.PerspectiveCamera();
  const r = new CameraRig(cam, dom, frame, { x: eyeYaw === 0 ? 0 : 16, y: 4, z: 1.5, yaw: eyeYaw });
  r.setMode(mode);
  return { r, cam, frame };
}

const robot = { x: 1.2, y: 4, yaw: 0 };
const settle = (r: CameraRig, pose: { x: number; y: number; yaw: number }, n = 240) => {
  for (let i = 0; i < n; i++) r.update(1 / 60, pose, undefined, 0);
};

describe('3rd person camera', () => {
  it('trails the robot from its driver side and keeps the driver-station heading when the robot turns', () => {
    const { r, cam, frame } = rig('follow');
    const pose = { x: 6, y: 3, yaw: 0 };
    settle(r, pose);
    const before = cam.position.clone();
    const robotWorld = frame.toWorld(pose.x, pose.y, 0);
    expect(cam.position.x).toBeLessThan(robotWorld.x - 3); // behind, toward the blue wall
    expect(cam.position.y).toBeGreaterThan(2);
    settle(r, { ...pose, yaw: 2 });
    expect(cam.position.distanceTo(before)).toBeLessThan(1e-3);
    expect(r.referenceYaw).toBe(0);
  });

  it('follows from the red side for a red driver', () => {
    const { r, cam, frame } = rig('follow', Math.PI);
    const pose = { x: 10, y: 3, yaw: Math.PI };
    settle(r, pose);
    expect(cam.position.x).toBeGreaterThan(frame.toWorld(pose.x, pose.y, 0).x + 3);
    expect(r.referenceYaw).toBe(Math.PI);
  });

  it('does not run far past the alliance wall', () => {
    const { r, cam, frame } = rig('follow');
    settle(r, { x: 0.5, y: 4, yaw: 0 });
    expect(cam.position.x).toBeGreaterThanOrEqual(frame.toWorld(-0.8, 4, 0).x - 1e-6);
  });
});

describe('chase camera', () => {
  it('keeps its full distance near walls (obstacles fade instead)', () => {
    const { r, cam, frame } = rig();
    settle(r, robot);
    expect(cam.position.distanceTo(frame.toWorld(robot.x, robot.y, 0.6))).toBeGreaterThan(2.4);
  });

  it('looks along the intake side by default and swings to the shooter side on request', () => {
    const { r, cam, frame } = rig();
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
    const { r, cam } = rig();
    r.chaseIntakeOffset = 0;
    for (let i = 0; i < 120; i++) r.update(1 / 60, robot, undefined, 0);
    const before = cam.position.clone();
    r.toggleChaseFacing();
    for (let i = 0; i < 120; i++) r.update(1 / 60, robot, undefined, 0);
    expect(cam.position.distanceTo(before)).toBeLessThan(1e-3);
  });
});

describe('occlusion fader', () => {
  const setup = () => {
    const root = new THREE.Group();
    const shared = new THREE.MeshStandardMaterial({ color: 0x333333 });
    const wall = new THREE.Mesh(new THREE.BoxGeometry(0.2, 3, 3), shared);
    const other = new THREE.Mesh(new THREE.BoxGeometry(0.2, 3, 3), shared);
    other.position.set(0, 0, 10);
    root.add(wall, other);
    root.updateMatrixWorld(true);
    return { root, shared, wall, other, fader: new OcclusionFader(root) };
  };
  const eye = new THREE.Vector3(-3, 0, 0);
  const target = [new THREE.Vector3(3, 0, 0)];

  it('fades only the mesh between the camera and the robot, without touching the shared material', () => {
    const { shared, wall, other, fader } = setup();
    for (let i = 0; i < 60; i++) fader.update(1 / 60, eye, target);
    const m = wall.material as THREE.Material;
    expect(m).not.toBe(shared);
    expect(m.transparent).toBe(true);
    expect(m.opacity).toBeLessThan(0.3);
    expect(other.material).toBe(shared);
    expect(shared.opacity).toBe(1);
  });

  it('ignores meshes beyond the robot and restores the original material once clear', () => {
    const { shared, wall, fader } = setup();
    for (let i = 0; i < 60; i++) fader.update(1 / 60, eye, [new THREE.Vector3(-1, 0, 0)]);
    expect(wall.material).toBe(shared);
    for (let i = 0; i < 60; i++) fader.update(1 / 60, eye, target);
    for (let i = 0; i < 120; i++) fader.update(1 / 60, eye, []);
    expect(wall.material).toBe(shared);
  });

  it('fades a mesh the camera is inside or right next to', () => {
    const { shared, wall, fader } = setup();
    for (let i = 0; i < 60; i++) fader.update(1 / 60, new THREE.Vector3(0, 0.5, 0.5), [new THREE.Vector3(3, 0, 0)]);
    expect(wall.material).not.toBe(shared);
  });
});
