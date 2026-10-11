import * as THREE from 'three';
import type { Alliance } from '../../engine/coords';
import type { FieldBuilder, Vec3 } from '../../engine/field/builder';
import * as C from './constants';

const inch = (n: number) => n * 0.0254;

import { HUB_CAD } from './hubCad';

/**
 * HUB scoring test and the drawn stand-in used until the CAD asset loads. Collision is the field CAD (hubCad.ts).
 * [CAD] The funnel narrows to its base (GE-26315) 1.40 m up; below it the ball drops onto the internal ramps.
 */
export const HUB_THROAT_Z = HUB_CAD.funnelBaseZ;
const HUB_THROAT_RADIUS = C.HUB_OPENING_HEX / Math.sqrt(3) * 0.70;

/**
 * Scored: the ball's centre crossed down past the bottom of the funnel (`prevZ` above, `z` at or below) inside the funnel
 * base's opening. Hub-local `x`, `y` (either alliance: the opening is symmetric). Crossing, not a band, so no fall speed
 * skips it.
 */
export function fuelCrossedHubFunnel(prevZ: number, z: number, x: number, y: number, radius: number): boolean {
  const plane = HUB_CAD.funnelBaseZ - radius;
  return prevZ > plane && z <= plane && Math.abs(x) < HUB_CAD.funnelHalfX && Math.abs(y) < HUB_CAD.funnelHalfY;
}

/** Drawn stand-in for the funnel and net frame (no collision: the CAD collides), used until the CAD asset loads. */
export function buildHubStandIn(b: FieldBuilder, alliance: Alliance, c: { x: number; y: number }): void {
  const forward = alliance === 'blue' ? 1 : -1;
  const point = (x: number, y: number, z: number): Vec3 => [c.x + forward * x, c.y + y, z];
  const mouthR = C.HUB_OPENING_HEX / Math.sqrt(3);
  const throatR = HUB_THROAT_RADIUS;
  const baseZ = HUB_THROAT_Z;
  const rimZ = C.HUB_RIM_HEIGHT;
  const plastic = new THREE.MeshStandardMaterial({ color: 0xdde3e7, transparent: true, opacity: 0.53, roughness: 0.48, metalness: 0.05, side: THREE.DoubleSide, depthWrite: false });
  const panel = (name: string, vertices: Vec3[], material: THREE.Material) => {
    const world = vertices.map(v => b.frame.toWorld(...v));
    const geometry = new THREE.BufferGeometry().setFromPoints(world);
    geometry.setIndex(vertices.length === 3 ? [0, 1, 2] : [0, 1, 2, 0, 2, 3]);
    geometry.computeVertexNormals();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.visible = material.visible;
    mesh.name = name;
    mesh.receiveShadow = true;
    b.root.add(mesh);
  };
  for (let i = 0; i < 6; i++) {
    const angles = [i, i + 1].map(j => Math.PI / 6 + j * Math.PI / 3);
    const bottom = angles.map(t => point(throatR * Math.cos(t), throatR * Math.sin(t), baseZ));
    const top = angles.map(t => point(mouthR * Math.cos(t), mouthR * Math.sin(t), rimZ));
    panel(`hub-${alliance}-funnel-panel-${i}`, [bottom[0], bottom[1], top[1], top[0]], plastic);
    b.cylinder(top[0], top[1], inch(0.12), { color: 0xb4bdc4, collide: false }, 6);
    b.cylinder(bottom[0], top[0], inch(0.10), { color: 0x555b60, collide: false }, 6);
  }

  const half = C.HUB_SIZE / 2 + inch(3);
  const rear = C.HUB_SIZE / 2 + inch(1);
  // [EST, Game Manual Fig. 5-7 / field photo] The inclined poles attach
  // about a quarter of the way along the side, not at the front corners.
  const front = -C.HUB_SIZE / 4;
  const footZ = baseZ - inch(5);
  const topZ = rimZ + C.HUB_NET_HEIGHT;
  const pole = { color: C.COLORS.alu, metalness: 0.65, roughness: 0.35, collide: false as const };
  for (const side of [-1, 1]) {
    const y = side * half;
    b.cylinder(point(front, y, footZ), point(rear, y, topZ), inch(0.65), { ...pole, name: `hub-${alliance}-net-inclined-pole-${side}` }, 10);
    b.cylinder(point(rear, y, footZ), point(rear, y, topZ), inch(0.65), pole, 10);
    b.cylinder(point(front, y, footZ), point(rear, y, footZ), inch(0.5), pole, 10);
  }
  b.cylinder(point(rear, -half, topZ), point(rear, half, topZ), inch(0.65), pole, 10);
}
