import * as THREE from 'three';
import { expect, it } from 'vitest';
import { RobotMirror } from '../src/engine/sim/robotMirror';
import type { Robot } from '../src/engine/robot/robot';

it('an older CORAL eject pose stays in its original parent even after a newer held frame arrives', () => {
  const make = () => {
    const visual = new THREE.Group(), gripper = new THREE.Group();
    gripper.position.y = 1.8;
    const coral = new THREE.Mesh(new THREE.BoxGeometry(.1, .3, .1), new THREE.MeshBasicMaterial());
    coral.userData.mirrorParent = true;
    visual.add(gripper); gripper.add(coral);
    return { visual, gripper, coral, mirror: new RobotMirror({ visual } as unknown as Robot) };
  };
  const source = make(), view = make();
  source.visual.add(source.coral); source.coral.position.y = 1.8;
  const a = source.mirror.capture(true);
  source.coral.position.y = 1.82;
  const b = source.mirror.capture(true);
  source.gripper.add(source.coral); source.coral.position.y = 0; source.coral.visible = false;
  const future = source.mirror.capture(true);
  view.mirror.applyDiscrete(future);
  view.mirror.applyNodes(a.nodes, b.nodes, .5, a.parents, b.parents);
  view.visual.updateMatrixWorld(true);
  expect(view.coral.parent).toBe(view.visual);
  expect(view.coral.getWorldPosition(new THREE.Vector3()).y).toBeCloseTo(1.81);
  expect(view.coral.visible).toBe(true);
  // A parent transition holds the old local pose until the boundary, then uses the new one.
  view.mirror.applyNodes(b.nodes, future.nodes, .5, b.parents, future.parents);
  view.visual.updateMatrixWorld(true);
  expect(view.coral.getWorldPosition(new THREE.Vector3()).y).toBeCloseTo(1.82);
  expect(view.coral.visible).toBe(true);
  view.mirror.applyNodes(b.nodes, future.nodes, 1, b.parents, future.parents);
  expect(view.coral.parent).toBe(view.gripper);
  expect(view.coral.visible).toBe(false);
});
