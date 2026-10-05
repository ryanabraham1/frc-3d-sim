/** Convert supplied Onshape GLBs into articulated, browser-sized robot assets. No Blender required. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, weld, simplifyPrimitive, join, meshopt, getBounds } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptDecoder, MeshoptSimplifier } from 'meshoptimizer';
import { Matrix4 } from 'three';

const specs = {
  'toploader-604': { file: 'Toploader Assembly.glb', axes: 'yzx', groups: [
    ['flywheel', /Main Roller Assembly/], ['hood', /Turret Hood Assembly/],
    ['turret', /Turret Assembly/], ['intake', /Intake Arm Assembly/],
    ['hopper-slide', /Hopper Slider Assembly/], ['serializer', /DPC Rotor Assembly/],
  ] },
  'limestone-1678': { file: '1678-26c-0000.glb', axes: 'yzx', groups: [
    ['intake', /1500 Single Roller Intake/], ['climber', /1900 Climber/],
    ['flywheel', /Drum silicone/], ['hood', /Hood silicone|1678-26c-16(?:06|09|10|11|12|13|14|15|17|74|75|85)(?:\/|$)/],
  ] },
  'rubble-581': { file: '2026 Dumper Champs Bot581.glb', axes: 'xzy', groups: [
    ['hood', /Hood Assem/], ['flywheel', /#1: 4.*Roller Shaft/],
    ['intake', /Champs Intake Assembly/],
  ] },
};
const inputDir = process.argv[2];
if (!inputDir) throw new Error('Usage: node tools/prepare-robot-cad.mjs <directory containing original GLBs> [model-id]');
const ids = process.argv[3] ? [process.argv[3]] : Object.keys(specs);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });
await Promise.all([MeshoptEncoder.ready, MeshoptSimplifier.ready]);
// CAD face boundaries duplicate normals. Permit seam collapses while keeping geometry error bounded.
const cadSimplifier = { ...MeshoptSimplifier, simplify: (indices, positions, stride, target, error, flags = []) =>
  MeshoptSimplifier.simplify(indices, positions, stride, target, error, [...flags, 'Permissive']) };
const outDir = 'public/models/robots/2026';
await fs.mkdir(outDir, { recursive: true });
for (const id of ids) {
  const spec = specs[id];
  if (!spec) throw new Error(`Unknown model: ${id}`);
  const source = path.join(inputDir, spec.file);
  const doc = await io.read(source);
  const root = doc.getRoot(), scene = root.listScenes()[0];
  const triangleCount = () => {
    let count = 0;
    scene.traverse(n => { for (const p of n.getMesh()?.listPrimitives() ?? []) count += (p.getIndices()?.getCount() ?? p.getAttribute('POSITION').getCount()) / 3; });
    return count;
  };
  const inputTriangles = triangleCount();
  // CAD exports use Z up. Preserve meters; turn the real intake toward robot -X.
  const axes = spec.axes === 'yzx' ? new Matrix4().set(0,1,0,0, 0,0,1,0, 1,0,0,0, 0,0,0,1)
    : new Matrix4().set(1,0,0,0, 0,0,1,0, 0,-1,0,0, 0,0,0,1);
  const nodes = root.listNodes();
  const retained = [];
  let omitted = 0;
  const surfaces = new Set();
  for (const n of nodes) {
    if (!n.getMesh()) continue;
    const names = [n.getName()];
    for (let p = n.getParentNode(); p; p = p.getParentNode()) names.push(p.getName());
    const full = names.join('/');
    // Keep structure and mechanism geometry; remove fasteners and electrical interiors.
    const bounds = getBounds(n);
    // Limestone's export includes an unnamed six-triangle reference sheet outside the robot.
    const looseReference = id === 'limestone-1678' && !n.getName() && bounds.max[1] > .8;
    const hardware = /screw|washer|blind rivet|locknut|hex nut|nutstrip|nut strip|spacer|bearing|bushing|crush block/i.test(n.getName())
      && !/plate|mount|support|arm|shaft|tube/i.test(n.getName());
    if (looseReference || hardware || /PDP 2\.0|Import for Mass/i.test(full)
      || /bumper assembly|26B0000 Bumpers|^Bumpers\//i.test(full)) { n.setMesh(null); omitted++; continue; }
    let group = spec.groups.find(([, re]) => re.test(full))?.[0] ?? 'frame';
    if (id === 'limestone-1678' && group === 'intake') {
      // Fixed gearbox, side containment sheets and rear posts belong to the chassis, not the slapdown arm.
      const centerZ = (bounds.min[2] + bounds.max[2])/2;
      if (centerZ < .20 || /1529|^part 26$|^part 73$|^Part 41$/i.test(n.getName())) group = 'frame';
    }
    if (id === 'limestone-1678') {
      if (/1900 Climber/.test(full)) {
        if (/1924|^Part 58(?:-Mirrored)?$|^Part 60$/.test(n.getName())) group='hopper-lift';
        else if (/1902|1943|1928|1915|1935/.test(n.getName())) group='hopper-lift';
      }
      if (/1500 Single Roller Intake/.test(full) && /^part 26$|^Part 41$|^Part 73$/i.test(n.getName())) group='hopper-front';
    }
    // Some exported configurations repeat the same wall in exactly the same place.
    const signature = n.getName() + '/' + [...bounds.min, ...bounds.max].map(v => v.toFixed(6)).join(',');
    if (/wall|coroplast|panel/i.test(n.getName()) && surfaces.has(signature)) { n.setMesh(null); omitted++; continue; }
    surfaces.add(signature);
    const dims = bounds.max.map((v,i) => v-bounds.min[i]);
    const sheet = /wall|coroplast|panel|plate|bellypan|polycarb/i.test(n.getName()) || (Math.min(...dims)<.012 && dims.filter(v=>v>.15).length>=2) || (id === 'limestone-1678' && /^Part 60$/.test(n.getName()));
    const themed = /arm plate|hood plate|slider mount|slot reinforcement|sponsor panel|printed|wire guide/i.test(n.getName()) || (id === 'limestone-1678' && /1678-26c-16(?:14|85)/.test(n.getName()));
    // Retain CAD colors, with rubber and clear-sheet finishes identified by part names.
    for (const p of n.getMesh().listPrimitives()) {
      if (!p.getMaterial()) continue;
      if (sheet || themed) {
        const m = p.getMaterial().clone().setExtras({ cadSheet: sheet });
        if (themed) {
          const c = id === 'toploader-604' ? [.91,.68,.04,1] : id === 'limestone-1678' ? [.22,.55,.13,1] : [.88,.25,.035,1];
          m.setBaseColorFactor(c).setMetallicFactor(.18).setName('team-accent');
        } else if (id === 'toploader-604' && /superstructure frame/i.test(full)) m.setBaseColorFactor([.12,.13,.14,1]);
        p.setMaterial(m);
      }
      if (/silicone|rubber|belt/i.test(n.getName())) {
        p.setMaterial(p.getMaterial().clone().setBaseColorFactor([.028,.032,.036,1]).setMetallicFactor(0).setRoughnessFactor(.85).setName('rubber'));
      } else if (id === 'limestone-1678' && /^(?:Part 60|Part 58(?:-Mirrored)?|1678-26c-1529|part 26|1678-26c-1118)$/i.test(n.getName())) {
        p.setMaterial(p.getMaterial().clone().setBaseColorFactor([.64,.72,.76,.20]).setAlphaMode('BLEND').setDoubleSided(true).setMetallicFactor(0).setRoughnessFactor(.38).setName('clear-hopper-sheet'));
      } else if (/polycarb|coroplast/i.test(n.getName()) && !/roller|plug|shaft/i.test(n.getName())) {
        const m = p.getMaterial().clone();
        if (/polycarb/i.test(n.getName())) m.setBaseColorFactor([.65,.72,.78,.24]).setAlphaMode('BLEND').setDoubleSided(true);
        m.setMetallicFactor(0).setRoughnessFactor(.55); p.setMaterial(m);
      }
    }
    const matrix = axes.clone().multiply(new Matrix4().fromArray(n.getWorldMatrix())).toArray();
    retained.push({ n, group, matrix });
  }
  // Detach leaves before deleting old CAD hierarchy. Each rigid group merges independently.
  const groups = new Map();
  for (const { n, group, matrix } of retained) {
    n.getParentNode()?.removeChild(n);
    n.setMatrix(matrix).setName('');
    n.getMesh().setName('');
    if (!groups.has(group)) groups.set(group, doc.createNode(group));
    groups.get(group).addChild(n);
  }
  for (const n of scene.listChildren()) scene.removeChild(n);
  for (const n of nodes) if (!retained.some(r => r.n === n)) n.dispose();
  for (const n of groups.values()) scene.addChild(n);
  // Onshape exports flat CAD colors. Set a useful PBR finish and retain color distinctions.
  for (const m of root.listMaterials()) {
    const c = m.getBaseColorFactor();
    m.setMetallicFactor(Math.max(...c.slice(0,3)) - Math.min(...c.slice(0,3)) < .1 && c[0] > .45 ? .55 : .12);
    if (m.getName() !== 'rubber') m.setRoughnessFactor(.55);
  }
  const reduce = (simplifier, ratio, error) => document => {
    for (const mesh of document.getRoot().listMeshes()) for (const p of mesh.listPrimitives()) {
      // Thin walls and cut plates keep their original CAD face normals and boundaries.
      if (!p.getMaterial()?.getExtras().cadSheet) simplifyPrimitive(p, { simplifier, ratio, error });
      else if (simplifier === MeshoptSimplifier) simplifyPrimitive(p, { simplifier, ratio: .15, error: .0001, lockBorder: true });
      if (!p.getAttribute('POSITION')?.getCount() || p.getIndices()?.getCount() === 0) { mesh.removePrimitive(p); p.dispose(); }
    }
  };
  await doc.transform(prune(), dedup(), weld(), reduce(MeshoptSimplifier,.10,.003), join(), weld(), reduce(cadSimplifier,.04,.002), prune());
  const outputTriangles = triangleCount();
  const bounds = getBounds(scene);
  await doc.transform(meshopt({ encoder: MeshoptEncoder, level: 'high', quantizePosition: 16 }));
  const destination = `${outDir}/${id}.glb`;
  await io.write(destination, doc);
  const report = { id, sourceFile: spec.file, inputBytes: (await fs.stat(source)).size, outputBytes: (await fs.stat(destination)).size,
    inputTriangles, outputTriangles, omittedOccurrences: omitted, bounds, groups: [...groups.keys()] };
  await fs.writeFile(`${outDir}/${id}.report.json`, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report));
}
