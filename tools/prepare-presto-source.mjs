/** Combine 6328's MIT-licensed AdvantageScope chassis/arm with the supplied intake. */
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { mergeDocuments, unpartition } from '@gltf-transform/functions';
import { MeshoptDecoder } from 'meshoptimizer';
const [repo, intake, output] = process.argv.slice(2);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'meshopt.decoder':MeshoptDecoder});
const doc = await io.read(`${repo}/ascope_assets/Robot_Presto/model.glb`);
const scene = doc.getRoot().listScenes()[0];
for (const [file, rotate] of [[`${repo}/ascope_assets/Robot_Presto/model_0.glb`,false],[intake,true]]) {
  const source = await io.read(file);
  if (rotate) for(const n of source.getRoot().listScenes()[0].listChildren()) n.setRotation([-Math.SQRT1_2,0,0,Math.SQRT1_2]);
  const mapped = mergeDocuments(doc, source);
  const copy = mapped.get(source.getRoot().listScenes()[0]);
  for(const n of copy.listChildren()) { copy.removeChild(n); scene.addChild(n); }
  copy.dispose();
}
await doc.transform(unpartition());
await io.write(output,doc);
