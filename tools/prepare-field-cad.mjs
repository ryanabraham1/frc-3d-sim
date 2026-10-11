/**
 * Visual assets from the official 2026 REBUILT field CAD (FE-2026 REBUILT Playing Field.glb; Onshape export in metres,
 * Z up, origin at field centre, blue alliance at -x). Collision comes from tools/prepare-field-cad.py.
 *
 *   node tools/prepare-field-cad.mjs "/path/FE-2026- REBUILT Playing Field.glb"
 *
 * Writes public/models/field/2026-hub.glb: the blue HUB in its hub-local FIELD frame (x toward the NEUTRAL ZONE, y left,
 * z up, origin on the floor at the hub centre), fasteners and tape removed, parts joined per material, meshopt-compressed.
 * The DMX light bars stay a separate node, `hub-diffusers`, so the game can light them; parts are coloured by role.
 */
import fs from 'node:fs/promises';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression } from '@gltf-transform/extensions';
import { dedup, prune, weld, join, meshopt, flatten, simplify } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import { Matrix4 } from 'three';

const [src] = process.argv.slice(2);
const HUB_X = -3.645;
const HARDWARE = /PEM S-|Rivet|Tape|Hex Spacer|Screw|[Bb]olt|Nut\b|Washer|Bearing|Connector Pin|Knob|Zip Tie|Hinge, Insert|Gas Spring|Hub Net \(Aesthetic\)/; // the net is drawn by the flexible NetSheet
// The DMX light bars' "Diffuser" parts light up in alliance colour; their "Case" housings are dark.
const LIGHT = /^Diffuser$/;
const SKIP = /AprilTag/; // the game draws textured tags at the welded positions
/** [part name, colour, metalness, roughness, opacity] — the export only carries grey shades, so parts are coloured by role. */
const LOOKS = [
  [/Side Panel Vinyl/, 0x17191c, 0, 0.7, 1], // drawn plain black (the printed artwork is not in the CAD)
  [/Hub (Side|Front|Rear) Panel/, 0x17191c, 0.2, 0.6, 1],
  [/Funnel Side|Funnel Base/, 0xdfe6ea, 0.05, 0.25, 0.42],
  [/Hub (Front|Rear|Side) Diffuser/, 0xf2f4f5, 0, 0.5, 0.75],
  [/Side Frame|Brace|Crossbar|Hub Base|Pole|Holder|Bracket|Ramp Angle|Roof Riser|Light Mount/, 0xb9bfc5, 0.7, 0.35, 1],
  [/2in Tread|^Case$/, 0x2a2c2e, 0, 0.8, 1],
  [/Wheel|REV-|Gearbox/, 0x55595d, 0.4, 0.5, 1],
  [/.*/, 0xc9cfd4, 0.1, 0.45, 1],
];
await MeshoptEncoder.ready;
await MeshoptSimplifier.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
const doc = await io.read(src);
const root = doc.getRoot();
const scene = root.getDefaultScene() ?? root.listScenes()[0];

// Part name: the nearest named ancestor (Onshape wraps each mesh in "occurrence of ..." nodes).
const parentOf = new Map();
for (const n of root.listNodes()) for (const c of n.listChildren()) parentOf.set(c, n);
const nameOf = (n) => { let k = n; while (k && (!k.getName() || k.getName().startsWith('occurrence'))) k = parentOf.get(k); return k?.getName() ?? ''; };
const looks = new Map();

await doc.transform(flatten());
// Keep everything of the blue HUB (by location: its footprint, up to the top of the net), drop hardware and tags.
const keep = [];
const box = [[-0.75, 0.82], [-0.82, 0.82], [-0.01, 3.2]]; // hub-local metres
for (const n of root.listNodes()) {
  const mesh = n.getMesh();
  if (!mesh) continue;
  const name = nameOf(n);
  const m = new Matrix4().fromArray(n.getWorldMatrix());
  let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const p of mesh.listPrimitives()) {
    const pos = p.getAttribute('POSITION');
    const a = pos.getMin([]), b = pos.getMax([]);
    for (const x of [a[0], b[0]]) for (const y of [a[1], b[1]]) for (const z of [a[2], b[2]]) {
      const w = [x * m.elements[0] + y * m.elements[4] + z * m.elements[8] + m.elements[12] - HUB_X,
        x * m.elements[1] + y * m.elements[5] + z * m.elements[9] + m.elements[13],
        x * m.elements[2] + y * m.elements[6] + z * m.elements[10] + m.elements[14]];
      for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], w[k]); hi[k] = Math.max(hi[k], w[k]); }
    }
  }
  const inBox = [0, 1, 2].every((k) => lo[k] >= box[k][0] && hi[k] <= box[k][1]);
  if (!inBox || HARDWARE.test(name) || SKIP.test(name)) { n.setMesh(null); continue; }
  const light = LIGHT.test(name);
  if (!light) {
    const [, color, metal, rough, opacity] = LOOKS.find(([re]) => re.test(name));
    const key = `${color}|${metal}|${rough}|${opacity}`;
    let mat = looks.get(key);
    if (!mat) {
      mat = doc.createMaterial(key).setBaseColorFactor([((color >> 16) & 255) / 255, ((color >> 8) & 255) / 255, (color & 255) / 255, opacity])
        .setMetallicFactor(metal).setRoughnessFactor(rough).setAlphaMode(opacity < 1 ? 'BLEND' : 'OPAQUE').setDoubleSided(opacity < 1);
      looks.set(key, mat);
    }
    for (const p of mesh.listPrimitives()) p.setMaterial(mat);
  }
  keep.push({ n, diffuser: light });
}
// Re-parent into two groups in the hub-local frame: the CAD node transforms are already world (flattened), so shift by the
// hub centre. Z-up stays (the game rotates the asset to its y-up world).
const hub = doc.createNode('hub-structure');
const diffusers = doc.createNode('hub-diffusers');
const top = doc.createNode('hub-2026').addChild(hub).addChild(diffusers);
top.setTranslation([-HUB_X, 0, 0]);
for (const { n, diffuser } of keep) {
  const p = parentOf.get(n);
  p?.removeChild(n);
  for (const s of root.listScenes()) s.removeChild(n);
  (diffuser ? diffusers : hub).addChild(n);
}
for (const s of root.listScenes()) for (const c of s.listChildren()) if (c !== top) s.removeChild(c);
scene.addChild(top);
await doc.transform(
  prune(),
  dedup(),
  weld({ tolerance: 1e-4 }),
  simplify({ simplifier: MeshoptSimplifier, ratio: 0.5, error: 0.0008 }),
  join({ keepNamed: true }),
  prune(),
  meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
);
doc.createExtension(EXTMeshoptCompression).setRequired(true);
await fs.mkdir('public/models/field', { recursive: true });
await io.write('public/models/field/2026-hub.glb', doc);
const size = (await fs.stat('public/models/field/2026-hub.glb')).size;
console.log(`hub: ${keep.length} meshes (${keep.filter((k) => k.diffuser).length} diffusers) -> public/models/field/2026-hub.glb ${(size / 1024).toFixed(0)} KB`);
