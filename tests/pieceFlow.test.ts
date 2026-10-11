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
  it('starts the indexer at the claimed ball and keeps advancing while the intake has no new ball ready', () => {
    const visual = new THREE.Group(), start = new THREE.Vector3(-.4, .4, 0), mouth = new THREE.Vector3(0, .2, 0), end = new THREE.Vector3(.5, .5, 0);
    const returned: THREE.Vector3[] = [];
    let available = true;
    const flow = new PieceFlow(visual, () => new THREE.Object3D(), {
      intake: () => [mouth], feed: () => [mouth, end],
      take: () => {
        if (!available) return null;
        available = false;
        return { position: start.clone(), release: p => returned.push(p.clone()) };
      },
    }, true);
    flow.update(0, 2, .1, false, true);
    const ball = visual.children.find(o => o.visible)!;
    expect(ball.position.distanceTo(start)).toBeLessThan(1e-6);
    for (let i = 0; i < 120; i++) flow.update(1/60, 2, .1, false, true);
    expect(flow.staged).toBe(1);
    expect(ball.position.distanceTo(end)).toBeLessThan(1e-6);
    for (let i = 0; i < 240; i++) flow.update(1/60, 2, .1);
    expect(flow.staged).toBe(0);
    expect(returned).toHaveLength(1);
    expect(returned[0].distanceTo(start)).toBeLessThan(1e-6);
  });
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

  it('never piles up intake tokens', () => {
    const { flow } = setup();
    flow.update(0, 0, 0.04);
    for (let i = 0; i < 40; i++) flow.noteCapture({ x: 1.4, y: 0.075, z: 1 });
    flow.update(0, 40, 0.04);
    expect(flow.inTransit).toBeLessThanOrEqual(14);
    for (let i = 0; i < 20; i++) flow.update(0.1, 40, 0.04);
    expect(flow.inTransit).toBe(0);
  });

  it('stages pieces nose to tail in the indexer while spun up, and each shot takes the lead piece', () => {
    const visual = new THREE.Group();
    const lane = [new THREE.Vector3(-0.5, 0.15, 0), new THREE.Vector3(0.1, 0.15, 0), new THREE.Vector3(0.2, 0.5, 0)];
    const flow = new PieceFlow(visual, () => new THREE.Mesh(new THREE.SphereGeometry(0.075)), {
      intake: () => [new THREE.Vector3(-0.4, 0.15, 0)],
      feed: () => lane.map((p) => p.clone()),
    }, true);
    flow.update(0, 30, 1 / 12);
    for (let i = 0; i < 60; i++) flow.update(1 / 60, 30, 1 / 12, false, true);
    // 0.6 + 0.36 m of lane holds seven 0.16 m pieces nose to tail; the lead one sits at the shooter end.
    expect(flow.staged).toBe(7);
    const shown = () => visual.children.filter((c) => c.visible);
    const lead = () => shown().reduce((a, b) => (a.position.y > b.position.y ? a : b));
    expect(lead().position.distanceTo(lane[2])).toBeLessThan(1e-6);
    const spacing = shown().map((o) => o.position).sort((a, b) => a.x - b.x || a.y - b.y);
    // One piece apart along the lane (a little closer across the corner).
    for (let i = 1; i < spacing.length; i++) expect(spacing[i].distanceTo(spacing[i - 1])).toBeGreaterThan(0.12);
    // A shot: the lead piece is gone at once, the next one steps up to the shooter, and the lane refills from the stow.
    const second = shown().sort((a, b) => b.position.y - a.position.y || b.position.x - a.position.x)[1];
    flow.update(1 / 60, 29, 1 / 12, false, true);
    expect(flow.staged).toBe(6);
    for (let i = 0; i < 30; i++) flow.update(1 / 60, 29, 1 / 12, false, true);
    expect(second.position.distanceTo(lane[2])).toBeLessThan(1e-6);
    expect(flow.staged).toBe(7);
  });

  it('never stages more than it holds, and backs pieces down into the stow when the shooter idles', () => {
    const { flow } = setup();
    flow.update(0, 2, 0.1);
    for (let i = 0; i < 60; i++) flow.update(1 / 60, 2, 0.1, false, true);
    expect(flow.staged).toBe(2);
    flow.update(1 / 60, 1, 0.1, false, true);
    expect(flow.staged).toBe(1);
    for (let i = 0; i < 180; i++) flow.update(1 / 60, 1, 0.1);
    expect(flow.staged).toBe(0);
  });

  it('feeds each shooter exit from its own lane', () => {
    const visual = new THREE.Group();
    let last = 0;
    const flow = new PieceFlow(visual, () => new THREE.Mesh(new THREE.SphereGeometry(0.075)), {
      intake: () => [new THREE.Vector3(-0.4, 0.15, 0)],
      feed: (lane) => [new THREE.Vector3(-0.3, 0.15, lane * 0.2), new THREE.Vector3(0.2, 0.4, lane * 0.2)],
      lanes: 3,
      shotLane: () => last,
    }, true);
    flow.update(0, 20, 1 / 15);
    for (let i = 0; i < 90; i++) flow.update(1 / 60, 20, 1 / 15, false, true);
    const count = (z: number) => visual.children.filter((c) => c.visible && Math.abs(c.position.z - z) < 1e-6).length;
    const before = [0, 0.2, 0.4].map(count);
    last = 2;
    flow.update(0, 19, 1 / 15, false, true);
    expect([0, 0.2, 0.4].map(count)).toEqual([before[0], before[1], before[2] - 1]);
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

it('hands intake tokens to the pile at their exact final point, once per ball', () => {
  const visual=new THREE.Group(), delivered: THREE.Vector3[]=[];
  const end=new THREE.Vector3(-0.15,0.35,0.1);
  const flow=new PieceFlow(visual,()=>new THREE.Mesh(new THREE.SphereGeometry(.075)),{
    intake: from => [new THREE.Vector3(-.4,.15,from?.z ?? 0),end.clone()],
    arrive: p => delivered.push(p.clone()),
  },true);
  flow.update(0,0,.1);flow.noteCapture({x:-.6,y:.075,z:.1});flow.update(0,1,.1);
  for(let frame=0;frame<60;frame++)flow.update(1/60,1,.1);
  expect(delivered).toHaveLength(1);
  expect(delivered[0].distanceTo(end)).toBeLessThan(1e-8);
  expect(flow.inTransit).toBe(0);
});
