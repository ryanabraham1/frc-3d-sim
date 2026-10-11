/**
 * The whole 2026 REBUILT field, drawn from the official field CAD (FE-2026 REBUILT Playing Field.glb; Onshape export in
 * metres, Z up, origin at field centre, blue alliance at -x), except the two HUBs (tools/prepare-field-cad.mjs makes the
 * HUB asset; the game places one per alliance) and the AprilTags (drawn textured by the game at the welded positions).
 *
 *   node tools/prepare-field-cad-field.mjs "/path/FE-2026- REBUILT Playing Field.glb"
 *
 * Writes public/models/field/2026-field.glb in the CAD frame (the game rotates it to its y-up world at the field centre).
 * Fasteners, velcro, carpet and tape are dropped (the game draws its own carpet and lines); parts are joined per material,
 * simplified and meshopt-compressed. Collision is unchanged: the game's own field colliders stay authoritative.
 */
import fs from 'node:fs/promises';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression } from '@gltf-transform/extensions';
import { dedup, prune, weld, join, meshopt, flatten, simplify } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import { Matrix4 } from 'three';

const [src] = process.argv.slice(2);
const HARDWARE = /PEM S-|Rivet|Hook Tape|Loop Tape|Seaming Tape|Hex Spacer|HEX Spacer|^Spacer$|Screw|[Bb]olt|Nut\b|Washer|Bearing|Connector Pin|Knob|Zip Tie|Hinge, Insert|Gas Spring|BLOCK CAD/;
// The game draws its own carpet and field-line tape (exact to the manual); the CAD's would z-fight with them.
const SKIP = /AprilTag|Playing Field Carpet|Gaffer Tape/;
const HUB_XS = [-3.645, 3.645];

await MeshoptEncoder.ready;
await MeshoptSimplifier.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
const doc = await io.read(src);
const root = doc.getRoot();
const parentOf = new Map();
for (const n of root.listNodes()) for (const c of n.listChildren()) parentOf.set(c, n);
const nameOf = (n) => { let k = n; while (k && (!k.getName() || k.getName().startsWith('occurrence'))) k = parentOf.get(k); return k?.getName() ?? ''; };

await doc.transform(flatten());
const rgb = (hex) => [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255, 1];
// Alliance colours as the game draws them (src/seasons/2026-rebuilt/constants.ts COLORS).
const blue = doc.createMaterial('alliance-blue').setBaseColorFactor(rgb(0x1e62d0)).setRoughnessFactor(0.6).setMetallicFactor(0.05);
const red = doc.createMaterial('alliance-red').setBaseColorFactor(rgb(0xd32f2f)).setRoughnessFactor(0.6).setMetallicFactor(0.05);
let kept = 0, dropped = 0;
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
      const w = [x * m.elements[0] + y * m.elements[4] + z * m.elements[8] + m.elements[12],
        x * m.elements[1] + y * m.elements[5] + z * m.elements[9] + m.elements[13],
        x * m.elements[2] + y * m.elements[6] + z * m.elements[10] + m.elements[14]];
      for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], w[k]); hi[k] = Math.max(hi[k], w[k]); }
    }
  }
  // Same footprint test as the HUB asset (everything of a hub sits in its 1.5 x 1.64 m box up to the net top).
  const inHub = HUB_XS.some((hx) => lo[0] >= hx - 0.75 && hi[0] <= hx + 0.75 && lo[1] >= -0.82 && hi[1] <= 0.82 && hi[2] <= 3.2);
  if (inHub || HARDWARE.test(name) || SKIP.test(name)) { n.setMesh(null); dropped++; continue; }
  // The export's alliance colours are unreliable (both colours on both sides): colour by side, blue at -x.
  const blueSide = (lo[0] + hi[0]) / 2 < 0;
  for (const p of mesh.listPrimitives()) {
    const c = p.getMaterial()?.getBaseColorFactor();
    if (c && ((c[0] > 0.9 && c[1] < 0.1 && c[2] < 0.1) || (c[0] < 0.1 && c[1] < 0.1 && c[2] > 0.9))) p.setMaterial(blueSide ? blue : red);
  }
  kept++;
}
await doc.transform(
  prune(),
  dedup(),
  weld({ tolerance: 2e-4 }),
  simplify({ simplifier: MeshoptSimplifier, ratio: 0.3, error: 0.0015 }),
  join({ keepNamed: false }),
  prune(),
  meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
);
doc.createExtension(EXTMeshoptCompression).setRequired(true);
await fs.mkdir('public/models/field', { recursive: true });
await io.write('public/models/field/2026-field.glb', doc);
const size = (await fs.stat('public/models/field/2026-field.glb')).size;
console.log(`field: kept ${kept} meshes, dropped ${dropped} -> public/models/field/2026-field.glb ${(size / 1024).toFixed(0)} KB`);
