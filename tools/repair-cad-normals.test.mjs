import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Document } from '@gltf-transform/core';
import { repairCadNormals } from './repair-cad-normals.mjs';

test('repairs unrelated face normals while preserving valid smooth normals and triangle positions', async () => {
  const doc = new Document(), buffer = doc.createBuffer();
  const positions = [0,0,0, 1,0,0, 0,1,0, 2,0,0, 3,0,0, 2,1,0];
  const smooth = [0,.1,Math.sqrt(.99)];
  const p = doc.createPrimitive()
    .setAttribute('POSITION', doc.createAccessor().setBuffer(buffer).setType('VEC3').setArray(new Float32Array(positions)))
    .setAttribute('NORMAL', doc.createAccessor().setBuffer(buffer).setType('VEC3').setArray(new Float32Array([1,0,0, 0,1,0, 0,0,-1, ...smooth,...smooth,...smooth])))
    .setIndices(doc.createAccessor().setBuffer(buffer).setType('SCALAR').setArray(new Uint16Array([0,1,2,3,4,5])));
  doc.createScene().addChild(doc.createNode().setMesh(doc.createMesh().addPrimitive(p)));
  assert.equal(await repairCadNormals(doc), 1);
  for (let i = 0; i < 6; i++) {
    const index = p.getIndices().getScalar(i);
    assert.deepEqual(p.getAttribute('POSITION').getElement(index, []), positions.slice(i*3,i*3+3));
    const n = p.getAttribute('NORMAL').getElement(index, []);
    if (i < 3) assert.deepEqual(n, [0,0,1]);
    else n.forEach((v, j) => assert.ok(Math.abs(v-smooth[j]) < 1e-6));
  }
  assert.equal(await repairCadNormals(doc), 0);
});
