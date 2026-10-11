import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import type { Alliance } from '../../engine/coords';
import type { FieldBuilder, Vec3 } from '../../engine/field/builder';
import { HUB_CAD_NET, HUB_CAD_PARTS } from './hubCad.generated';

/**
 * The HUB as built: the official FE-2026 REBUILT field CAD (tools/prepare-field-cad.py / .mjs). Collision always comes
 * from the CAD (generated triangles, available everywhere incl. Node tests and the simulation worker); the drawn model
 * is the CAD asset once loaded (`prepareHubCad`), else the procedural stand-in.
 *
 * Hub-local frame: FIELD axes for the blue hub (x toward the NEUTRAL ZONE, y left, z up), origin on the floor at the hub
 * centre. The red hub is the same structure turned 180 degrees about z.
 */

/** [CAD] Openings and heights measured from the field CAD (m, hub-local). */
export const HUB_CAD = {
  /** Bottom of the funnel (GE-26315 Funnel Base): a ball dropping below it through the opening is scored. */
  funnelBaseZ: 1.402,
  /** Half extents of the funnel base's footprint: the opening a scored ball passes. */
  funnelHalfX: 0.381,
  funnelHalfY: 0.343,
  /** Exit slot in the NEUTRAL ZONE face, between Rear Panel, Bottom and Front Panel, Top (GE-26306 / GE-26308). */
  exitBottom: 0.765,
  exitTop: 0.991,
  /** Body (side panel) top. */
  bodyTop: 1.273,
  /** FUEL counter (GE-264xx) from the inlet funnel to the exit slot, and the top of its wheels. */
  counterFromX: 0.07,
  counterTopZ: 1.12,
  /** Surface speed of the counter's driven 2in wheels [EST: balls leave at a brisk roll]. */
  counterSpeed: 1.6,
  /** The foam FUEL compressed by the counter wheels: collider radius as a share of the ball's (0.11 m gap / 0.15 m ball). */
  counterSqueeze: 0.65,
  /** Front of the counter's lane dividers (GE-26404) and the four lanes' centres across the hub (|y|). */
  laneFromX: 0.341,
  laneCenters: [0.1335, 0.418],
  /** Centre lines of the divider pairs between the lanes (y). */
  dividerCenters: [0, 0.2675, -0.2675],
} as const;

let asset: THREE.Group | null = null;
let loading: Promise<void> | null = null;

/** Load the drawn CAD hub (pages only; the simulation side needs only the generated collision). */
export function prepareHubCad(): Promise<void> {
  if (typeof document === 'undefined' || typeof window === 'undefined') return Promise.resolve();
  return (loading ??= new GLTFLoader().setMeshoptDecoder(MeshoptDecoder)
    .loadAsync(`${import.meta.env.BASE_URL}models/field/2026-hub.glb`)
    .then((g) => { asset = g.scene; })
    .catch((e) => { console.warn('[field] HUB CAD unavailable, drawing the stand-in', e); }));
}

/** Hub-local point → FIELD point for an alliance's hub centred at `c`. */
export function hubToField(a: Alliance, c: { x: number; y: number }, x: number, y: number, z: number): Vec3 {
  return a === 'blue' ? [c.x + x, c.y + y, z] : [c.x - x, c.y - y, z];
}

/**
 * Static colliders for one hub. FUEL collides with the CAD itself (shell, funnel, ramps, counter). Robots meet a solid box
 * the size of the body instead: a thin CAD panel can be pushed through by a shoving robot, a solid block can't.
 */
export function addHubCadColliders(b: FieldBuilder, a: Alliance, c: { x: number; y: number }): void {
  const size = 47 * 0.0254;
  b.box([c.x, c.y, HUB_CAD.bodyTop / 2], [size, size, HUB_CAD.bodyTop], { visible: false, collide: 'robots', friction: 0.4, restitution: 0.1 });
  for (const part of HUB_CAD_PARTS) {
    const v = new Float32Array(part.vertices.length);
    for (let i = 0; i < v.length; i += 3) {
      const [x, y, z] = hubToField(a, c, part.vertices[i], part.vertices[i + 1], part.vertices[i + 2]);
      v[i] = x; v[i + 1] = y; v[i + 2] = z;
    }
    b.trimesh(v, part.indices, { collide: 'pieces', friction: 0.4, restitution: 0.25 });
  }
}

/**
 * Add the drawn CAD hub. Returns the diffuser material (the DMX lights shine through it) or null when the asset isn't
 * loaded (the caller draws the stand-in).
 */
export function addHubCadVisual(b: FieldBuilder, a: Alliance, c: { x: number; y: number }, light: THREE.MeshStandardMaterial): boolean {
  if (!asset) return false;
  const hub = asset.clone(true);
  hub.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    m.castShadow = true;
    m.receiveShadow = true;
    // The CAD's aesthetic net is drawn by the flexible NetSheet instead (it bulges); the stand-in tint keeps clear parts clear.
    if (/Net \(Aesthetic\)/.test(m.name) || /Net \(Aesthetic\)/.test(m.parent?.name ?? '')) m.visible = false;
  });
  hub.getObjectByName('hub-diffusers')?.traverse((o) => { if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).material = light; });
  // The asset is hub-local, Z up: rotate into the y-up world and turn the red hub 180 degrees.
  const g = new THREE.Group();
  g.add(hub);
  hub.rotation.x = -Math.PI / 2;
  const w = b.frame.toWorld(c.x, c.y, 0);
  g.position.copy(w);
  if (a === 'red') g.rotation.y = Math.PI;
  g.name = `hub-${a}-cad`;
  b.root.add(g);
  // [M Fig 5-5, 5-7] The side vinyl's teal REBUILT banner, below the AprilTag band (the CAD carries the vinyl as one solid).
  const inch = 0.0254;
  for (const sy of [-1, 1]) {
    const y = hubToField(a, c, 0, sy * 0.6, 0)[1];
    b.box([c.x, y, 22 * inch], [47 * inch * 0.84, 0.004, 26 * inch], { color: 0x4f8a99, roughness: 0.7, collide: false, name: `hub-${a}-banner-${sy}` });
    b.label([c.x, y + Math.sign(y - c.y) * 0.004, 23 * inch], 'REBUILT', 5.5 * inch, y > c.y ? Math.PI / 2 : -Math.PI / 2, '#ffffff');
  }
  return true;
}

/** The flexible net's rectangle (FIELD frame) and the side it is hit from, for NetSheet. */
export function hubCadNet(a: Alliance, c: { x: number; y: number }): { origin: Vec3; u: Vec3; v: Vec3; front: Vec3 } {
  const o = HUB_CAD_NET.origin, u = HUB_CAD_NET.u, v = HUB_CAD_NET.v;
  const s = a === 'blue' ? 1 : -1;
  return {
    origin: hubToField(a, c, o[0], o[1], o[2]),
    u: [s * u[0], s * u[1], u[2]],
    v: [s * v[0], s * v[1], v[2]],
    front: hubToField(a, c, 0, 0, 1.8),
  };
}
