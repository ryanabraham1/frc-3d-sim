import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { PieceFlow } from '../src/engine/robot/pieceFlow';

function setup(feed = true) {
  const visual = new THREE.Group();
  visual.position.set(2, 0, 1);
  visual.updateMatrixWorld();
  const stow = new THREE.Vector3(-0.1, 0.3, 0);
  const flow = new PieceFlow(visual, () => new THREE.Mesh(new THREE.SphereGeometry(0.075)), {
    intake: () => [new THREE.Vector3(-0.4, 0.15, 0), stow.clone()],
    feed: feed ? () => [stow.clone(), new THREE.Vector3(0.1, 0.6, 0)] : undefined,
  }, true);
  return { visual, flow, stow };
}

describe('PieceFlow', () => {
  it('starts a captured piece where it was picked up and delivers it to the stow point', () => {
    const { visual, flow, stow } = setup();
    flow.update(0, 0, 0.1);
    flow.noteCapture({ x: 2 - 0.6, y: 0.075, z: 1 }); // just outside the back bumper, in world space
    flow.update(0, 1, 0.1);
    expect(flow.inTransit).toBe(1);
    const token = visual.children.find((c) => c.visible)!;
    expect(token.position.x).toBeCloseTo(-0.6, 5);
    expect(token.position.y).toBeCloseTo(0.075, 5);
    // Mid-way it is between the mouth and the stow point, then it is handed to the hopper visual.
    flow.update(0.15, 1, 0.1);
    expect(token.position.x).toBeGreaterThan(-0.6);
    expect(token.position.x).toBeLessThan(stow.x + 1e-6);
    for (let i = 0; i < 10; i++) flow.update(0.1, 1, 0.1);
    expect(flow.inTransit).toBe(0);
    expect(token.visible).toBe(false);
  });

  it('only animates pieces with a capture point unless replicating', () => {
    const { flow } = setup();
    flow.update(0, 0, 0.1);
    flow.update(0, 8, 0.1); // preload
    expect(flow.inTransit).toBe(0);
    flow.update(0, 9, 0.1, true); // multiplayer replica: no capture points are sent
    expect(flow.inTransit).toBe(1);
  });

  it('feeds the next piece to the shooter after each shot, and never piles up tokens', () => {
    const { visual, flow } = setup();
    flow.update(0, 0, 0.04);
    for (let i = 0; i < 40; i++) flow.noteCapture({ x: 1.4, y: 0.075, z: 1 });
    flow.update(0, 40, 0.04);
    expect(flow.inTransit).toBeLessThanOrEqual(14);
    for (let i = 0; i < 20; i++) flow.update(0.1, 40, 0.04);
    expect(flow.inTransit).toBe(0);
    flow.update(0.01, 39, 0.04); // one shot leaves: the next piece rides up to the shooter
    expect(visual.children.filter((c) => c.visible)).toHaveLength(1);
    flow.update(0.2, 39, 0.04);
    expect(visual.children.filter((c) => c.visible)).toHaveLength(0);
  });

  it('feeds nothing when the robot is out of pieces or has no feed path', () => {
    const a = setup();
    a.flow.update(0, 1, 0.1);
    a.flow.update(0.01, 0, 0.1);
    expect(a.visual.children.filter((c) => c.visible)).toHaveLength(0);
    const b = setup(false);
    b.flow.update(0, 5, 0.1);
    b.flow.update(0.01, 4, 0.1);
    expect(b.visual.children.filter((c) => c.visible)).toHaveLength(0);
  });
});
