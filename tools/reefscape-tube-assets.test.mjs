import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { getBounds } from '@gltf-transform/functions';
import { MeshoptDecoder } from 'meshoptimizer';

await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
for (const [id, expected] of [['quixilver-604-2025', 18], ['sublime-1678', 4], ['redundancy-190', 14], ['zuma-581', 4], ['firefly-118', 15]]) {
  test(`${id}: match assets retain every recovered tube in its original motion group`, async () => {
    const read = async subdir => {
      const doc = await io.read(`public/models/robots/2025/${subdir}${id}.glb`);
      return doc.getRoot().listNodes().filter(n => n.getName().startsWith('restored-tube:')).map(n => ({
        name: n.getName(), group: n.getParentNode()?.getName(), bounds: getBounds(n),
        triangles: n.getMesh().listPrimitives().reduce((sum, p) => sum + (p.getIndices()?.getCount() ?? p.getAttribute('POSITION').getCount()) / 3, 0),
      }));
    };
    const full = await read(''), match = await read('match/');
    assert.equal(full.length, expected);
    assert.equal(match.length, expected);
    assert.ok(full.reduce((sum, tube) => sum + tube.triangles, 0) > 1000, 'retain drilled source detail across the recovered tubes');
    full.forEach((tube, index) => {
      const other = match[index];
      assert.equal(other.name, tube.name);
      assert.equal(other.group, tube.group);
      assert.equal(other.triangles, tube.triangles);
      // Some supplied chassis profiles are intentionally solid 12-triangle parts.
      assert.ok(tube.triangles >= 12, `${tube.name}: retain its source faces`);
      for (const edge of ['min', 'max']) tube.bounds[edge].forEach((v, axis) => assert.ok(Math.abs(v - other.bounds[edge][axis]) < 1e-6));
    });
  });
}
