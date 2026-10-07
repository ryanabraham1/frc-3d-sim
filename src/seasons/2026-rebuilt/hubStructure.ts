import * as THREE from 'three';
import type { Alliance } from '../../engine/coords';
import type { FieldBuilder, Vec3 } from '../../engine/field/builder';
import * as C from './constants';

const inch = (n: number) => n * 0.0254;

/** Field manual pp. 88, 92–95: six plastic funnel panels and rear net frame.
 * Unspecified throat/net dimensions are visual approximations. */
export const HUB_THROAT_RADIUS = C.HUB_OPENING_HEX / Math.sqrt(3) * 0.70;
export const HUB_THROAT_Z = C.HUB_CUP_FLOOR + inch(2);
// Leave enough depth beneath the throat for the entire 5.9-inch FUEL to enter.
export const HUB_SENSOR_FLOOR_Z = C.HUB_CUP_FLOOR - inch(6);

/** Only collect FUEL once it has cleared the sloped panels into the throat. */
export function fuelInsideHubThroat(x: number, y: number, z: number, radius: number): boolean {
  if (z - radius < HUB_SENSOR_FLOOR_Z - 0.02 || z + radius > HUB_THROAT_Z - 0.005) return false;
  const clearance = HUB_THROAT_RADIUS * Math.sqrt(3) / 2 - radius;
  for (let i = 0; i < 6; i++) {
    const angle = Math.PI / 3 + i * Math.PI / 3;
    if (x * Math.cos(angle) + y * Math.sin(angle) > clearance) return false;
  }
  return true;
}

export function buildHubFunnelAndNet(b: FieldBuilder, alliance: Alliance, c: { x: number; y: number }): void {
  const forward = alliance === 'blue' ? 1 : -1;
  const point = (x: number, y: number, z: number): Vec3 => [c.x + forward * x, c.y + y, z];
  const mouthR = C.HUB_OPENING_HEX / Math.sqrt(3);
  const throatR = HUB_THROAT_RADIUS;
  const baseZ = HUB_THROAT_Z;
  const rimZ = C.HUB_RIM_HEIGHT;
  const plastic = new THREE.MeshStandardMaterial({ color: 0xdde3e7, transparent: true, opacity: 0.53, roughness: 0.48, metalness: 0.05, side: THREE.DoubleSide, depthWrite: false });
  const panel = (name: string, vertices: Vec3[], material: THREE.Material, restitution = 0.38) => {
    const world = vertices.map(v => b.frame.toWorld(...v));
    const geometry = new THREE.BufferGeometry().setFromPoints(world);
    geometry.setIndex(vertices.length === 3 ? [0, 1, 2] : [0, 1, 2, 0, 2, 3]);
    geometry.computeVertexNormals();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.visible = material.visible;
    mesh.name = name;
    mesh.receiveShadow = true;
    b.root.add(mesh);
    // Thin, closed hulls avoid turning the open funnel into a solid collider.
    const normal = new THREE.Vector3().subVectors(new THREE.Vector3(...vertices[1]), new THREE.Vector3(...vertices[0]))
      .cross(new THREE.Vector3().subVectors(new THREE.Vector3(...vertices[2]), new THREE.Vector3(...vertices[0])))
      .normalize().multiplyScalar(inch(0.12));
    b.convex([0, 0, 0], vertices.flatMap(v => [v, [v[0] + normal.x, v[1] + normal.y, v[2] + normal.z] as Vec3]), { visible: false, collide: 'pieces', restitution, friction: 0.22 });
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
  const front = -C.HUB_SIZE / 2;
  const footZ = baseZ - inch(5);
  const topZ = rimZ + C.HUB_NET_HEIGHT;
  const netMaterial = new THREE.MeshBasicMaterial({ visible: false, side: THREE.DoubleSide });
  panel(`hub-${alliance}-net-rear-collision`, [point(rear, -half, baseZ), point(rear, half, baseZ), point(rear, half, topZ), point(rear, -half, topZ)], netMaterial, 0.05);
  const cords: THREE.Vector3[] = [];
  const cord = (a: Vec3, d: Vec3) => cords.push(b.frame.toWorld(...a), b.frame.toWorld(...d));
  const spacing = inch(2);
  for (let y = -half; y <= half; y += spacing) cord(point(rear, y, baseZ), point(rear, y, topZ));
  for (let z = baseZ; z <= topZ; z += spacing) cord(point(rear, -half, z), point(rear, half, z));
  const pole = { color: C.COLORS.alu, metalness: 0.65, roughness: 0.35, collide: false as const };
  for (const side of [-1, 1]) {
    const y = side * half;
    panel(`hub-${alliance}-net-wing-${side}-collision`, [point(front, y, footZ), point(rear, y, footZ), point(rear, y, topZ)], netMaterial, 0.05);
    for (let x = front; x <= rear; x += spacing) {
      const height = footZ + (topZ - footZ) * (x - front) / (rear - front);
      cord(point(x, y, footZ), point(x, y, height));
    }
    for (let z = footZ; z <= topZ; z += spacing) {
      const x = front + (rear - front) * (z - footZ) / (topZ - footZ);
      cord(point(x, y, z), point(rear, y, z));
    }
    b.cylinder(point(front, y, footZ), point(rear, y, topZ), inch(0.65), pole, 10);
    b.cylinder(point(rear, y, footZ), point(rear, y, topZ), inch(0.65), pole, 10);
    b.cylinder(point(front, y, footZ), point(rear, y, footZ), inch(0.5), pole, 10);
  }
  b.cylinder(point(rear, -half, topZ), point(rear, half, topZ), inch(0.65), pole, 10);
  const net = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(cords), new THREE.LineBasicMaterial({ color: 0x282b2e }));
  net.name = `hub-${alliance}-net-mesh`;
  b.root.add(net);
}
