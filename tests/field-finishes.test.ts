import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { applyCadFinishes } from '../src/engine/field/cadFinishes';
import { mergeStatic } from '../src/engine/render/mergeStatic';
import { COLORS } from '../src/seasons/2026-rebuilt/constants';

describe('field CAD surface finishes', () => {
  it('the real field separates clear windows, diamond plate, vinyl and alliance paint', async () => {
    const b = readFileSync('public/models/field/2026-field.glb');
    const root = (await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(
      b.buffer.slice(b.byteOffset, b.byteOffset+b.byteLength), '')).scene;
    root.updateMatrixWorld(true);
    // The export's aesthetic net is an opaque sheet, not net cords. NetSheet draws the real flexible net separately.
    const ray = new THREE.Raycaster(new THREE.Vector3(-2, 0, 2), new THREE.Vector3(-1, 0, 0), 0, 2);
    expect(ray.intersectObject(root, true).length).toBe(0);
    applyCadFinishes(root);
    const seen = new Set<string>();
    root.traverse(o => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const raw of materials) {
        const m = raw as THREE.MeshStandardMaterial;
        const finish = m.userData.fieldFinish;
        seen.add(finish);
        if (finish === 'clear') {
          expect(m.transparent).toBe(true); expect(m.opacity).toBeLessThan(.2);
          expect(m.depthWrite).toBe(false); expect(mesh.castShadow).toBe(false);
          expect(m.forceSinglePass).toBe(true);
        } else {
          expect(m.transparent).toBe(false); expect(m.depthWrite).toBe(true);
          expect(m.roughnessMap).toBeDefined(); expect(m.bumpMap).toBeDefined();
          expect(mesh.geometry.getAttribute('uv')).toBeDefined();
        }
        if (finish === 'vinyl') { expect(m.polygonOffset).toBe(true); expect(m.polygonOffsetUnits).toBeLessThan(0); }
        if (finish === 'diamond') expect(m.metalness).toBeGreaterThan(.5);
        if (m.name === 'alliance-blue') expect(m.color.equals(new THREE.Color(COLORS.blue))).toBe(true);
        if (m.name === 'alliance-red') expect(m.color.equals(new THREE.Color(COLORS.red))).toBe(true);
      }
    });
    for (const finish of ['clear', 'diamond', 'metal', 'vinyl', 'paint', 'plastic']) expect(seen.has(finish), finish).toBe(true);
  });

  it('keeps roughness-only texture UVs through static batching', () => {
    const root = new THREE.Group();
    const material = new THREE.MeshStandardMaterial(); material.userData.fieldFinish = 'metal';
    for (const x of [-2, 2]) {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(), material); mesh.position.x = x; root.add(mesh);
    }
    applyCadFinishes(root);
    const map = material.roughnessMap;
    mergeStatic(root);
    expect(root.children.length).toBe(1);
    const merged = root.children[0] as THREE.Mesh;
    expect(merged.geometry.getAttribute('uv')).toBeDefined();
    expect((merged.material as THREE.MeshStandardMaterial).roughnessMap).toBe(map);
  });

  it('does not merge different surface textures with the same base paint', () => {
    const root = new THREE.Group();
    for (const finish of ['metal', 'diamond']) for (let i = 0; i < 2; i++) {
      const m = new THREE.MeshStandardMaterial(); m.userData.fieldFinish = finish;
      root.add(new THREE.Mesh(new THREE.BoxGeometry(), m));
    }
    applyCadFinishes(root); mergeStatic(root);
    expect(root.children.length).toBe(2);
  });
});
