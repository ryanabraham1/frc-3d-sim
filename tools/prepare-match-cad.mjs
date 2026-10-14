/** Build bounded-error match meshes. The full supplied assemblies remain available in the workshop. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression } from '@gltf-transform/extensions';
import { simplifyPrimitive } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptDecoder, MeshoptSimplifier } from 'meshoptimizer';

await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready, MeshoptSimplifier.ready]);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });
// Absolute error is in metres, independent of each part's size. Keep CAD face-normal seams,
// but allow redundant face vertices to collapse; motion groups, materials and UVs survive.
const simplifier = { ...MeshoptSimplifier, simplify: (indices, positions, stride, target, error, flags = []) =>
  MeshoptSimplifier.simplify(indices, positions, stride, target, error, [...flags, 'Permissive', 'ErrorAbsolute']) };
const reportPath = 'public/models/robots/match-cad-report.json';
const report = process.argv[2] ? JSON.parse(await fs.readFile(reportPath, 'utf8').catch(() => '[]')) : [];
for (const year of ['2024', '2025', '2026', 'wcp-hero-heist']) {
  const dir = `public/models/robots/${year}`;
  await fs.mkdir(`${dir}/match`, { recursive: true });
  for (const file of await fs.readdir(dir)) {
    if (!file.endsWith('.glb') || /supplied-parts/.test(file) || (process.argv[2] && !file.includes(process.argv[2]))) continue;
    const doc = await io.read(`${dir}/${file}`);
    let before = 0, after = 0;
    for (const mesh of doc.getRoot().listMeshes()) for (const p of mesh.listPrimitives()) {
      if (p.getMode() !== 4) continue;
      const n = p.getIndices()?.getCount() ?? p.getAttribute('POSITION').getCount();
      before += n / 3;
      if (n > 600) simplifyPrimitive(p, { simplifier, ratio: .20, error: .001 });
      after += (p.getIndices()?.getCount() ?? p.getAttribute('POSITION').getCount()) / 3;
    }
    // Preserve position precision: quantization of complete CAD assemblies can distort tiny parts.
    doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.FILTER });
    const out = `${dir}/match/${file}`;
    await io.write(out, doc);
    const entry = { id: path.basename(file, '.glb'), year, before, after, bytes: (await fs.stat(out)).size };
    const old = report.findIndex(r => r.id === entry.id && r.year === entry.year);
    if (old >= 0) report[old] = entry;
    else report.push(entry);
    console.log(`${year}/${entry.id}: ${before} → ${after} triangles`);
  }
}
await fs.writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
