import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { acceleratedRaycast } from 'three-mesh-bvh';
import { cloneSpatialField, prepareSpatialField } from '../src/engine/render/spatialField';
import { OcclusionFader } from '../src/engine/render/occlusionFader';
import { prepareHubVisual, restoreAllianceColors } from '../src/seasons/2026-rebuilt/hubCad';
import { COLORS } from '../src/seasons/2026-rebuilt/constants';

function field() {
  const root = new THREE.Group();
  const material = new THREE.MeshStandardMaterial();
  // Two remote structures sharing a material and one joined mesh, like the field CAD export.
  const near = new THREE.BoxGeometry(1, 1, 2).translate(-6, 0, 1);
  const far = new THREE.BoxGeometry(1, 1, 2).translate(6, 0, 1);
  root.add(new THREE.Mesh(mergeGeometries([near, far])!, material));
  return root;
}
const meshes = (root: THREE.Object3D) => {
  const out: THREE.Mesh[] = [];
  root.traverse(o => { if ((o as THREE.Mesh).isMesh) out.push(o as THREE.Mesh); });
  return out;
};
const triangles = (root: THREE.Object3D) => meshes(root).reduce((n, m) => n + (m.geometry.index?.count ?? m.geometry.getAttribute('position').count) / 3, 0);

describe('spatial field camera occlusion', () => {
  it('batches the real HUB while preserving its independently colored lights', async () => {
    const bytes = readFileSync('public/models/field/2026-hub.glb');
    const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
    const root = gltf.scene;
    const before = meshes(root).filter(m => m.visible).length;
    const bounds = new THREE.Box3().setFromObject(root, true);
    prepareHubVisual(root);
    expect(meshes(root).filter(m => m.visible).length).toBeLessThan(before / 2);
    expect(new THREE.Box3().setFromObject(root, true).min.distanceTo(bounds.min)).toBeLessThan(1e-5);
    expect(new THREE.Box3().setFromObject(root, true).max.distanceTo(bounds.max)).toBeLessThan(1e-5);
    const clone = cloneSpatialField(root);
    const lights = clone.getObjectByName('hub-diffusers')!;
    expect(lights).toBeDefined();
    const paint = new THREE.MeshStandardMaterial({ color: 0xff0000 });
    meshes(lights).forEach(m => m.material = paint);
    expect(meshes(clone).filter(m => m.material === paint).length).toBe(meshes(lights).length);
    expect(meshes(root).every(m => m.material !== paint)).toBe(true);
  });

  it('skips off-ray triangles and hidden subtrees, and invalidates static bounds after a parent moves', () => {
    const root = new THREE.Group();
    const visible = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
    visible.position.set(0, 3, 0);
    const remote = visible.clone(); remote.position.set(50, 3, 0);
    let remoteRaycasts = 0;
    remote.raycast = () => { remoteRaycasts++; };
    const hidden = new THREE.Group(); hidden.visible = false;
    const hiddenMesh = visible.clone(); hiddenMesh.position.set(0, 2, 0); hidden.add(hiddenMesh);
    visible.userData.staticField = true;
    root.add(visible, remote, hidden); root.updateMatrixWorld(true);
    const fader = new OcclusionFader(root);
    const eye = new THREE.Vector3(0, 0, 0), target = new THREE.Vector3(0, 5, 0);
    fader.update(1, eye, [target]);
    expect((visible.material as THREE.Material).transparent).toBe(true);
    expect(remoteRaycasts).toBe(0);
    expect((hiddenMesh.material as THREE.Material).transparent).toBe(false);
    root.position.x = 10; root.updateMatrixWorld(true);
    fader.update(1, eye, [target]);
    expect((visible.material as THREE.Material).transparent).toBe(false);
    fader.clear();
  });
  it('keeps the real compressed field CAD intact and gives every match mesh a shared acceleration tree', async () => {
    const bytes = readFileSync('public/models/field/2026-field.glb');
    const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
    const root = gltf.scene;
    const count = triangles(root);
    const bounds = new THREE.Box3().setFromObject(root);
    prepareSpatialField(root);
    const clone = cloneSpatialField(root);
    expect(triangles(clone)).toBe(count);
    expect(new THREE.Box3().setFromObject(clone).min.distanceTo(bounds.min)).toBeLessThan(1e-5);
    expect(new THREE.Box3().setFromObject(clone).max.distanceTo(bounds.max)).toBeLessThan(1e-5);
    expect(meshes(clone).every(m => m.geometry.boundsTree && m.raycast === acceleratedRaycast)).toBe(true);
  });
  it('restores alliance paint to the same sRGB colors as the procedural field', () => {
    const root = new THREE.Group();
    const blue = new THREE.MeshStandardMaterial({ name: 'alliance-blue' });
    const red = new THREE.MeshStandardMaterial({ name: 'alliance-red' });
    const metal = new THREE.MeshStandardMaterial({ color: 0x888888 });
    const metalBefore = metal.color.clone();
    root.add(new THREE.Mesh(new THREE.BoxGeometry(), [blue, red, metal]));
    restoreAllianceColors(root);
    expect(blue.color.equals(new THREE.Color(COLORS.blue))).toBe(true);
    expect(red.color.equals(new THREE.Color(COLORS.red))).toBe(true);
    expect(metal.color.equals(metalBefore)).toBe(true);
  });
  it('preserves CAD triangles, transforms and ray hits while separating remote material batches', () => {
    const root = field();
    root.rotation.x = -Math.PI / 2;
    root.position.set(2, 0, 3);
    root.updateMatrixWorld(true);
    const beforeBounds = new THREE.Box3().setFromObject(root);
    const count = triangles(root);
    const ray = new THREE.Raycaster(new THREE.Vector3(-4, 1, 8), new THREE.Vector3(0, 0, -1));
    const before = ray.intersectObject(root, true);
    expect(before.length).toBeGreaterThan(0);
    prepareSpatialField(root);
    root.updateMatrixWorld(true);
    expect(triangles(root)).toBe(count);
    expect(new THREE.Box3().setFromObject(root).equals(beforeBounds)).toBe(true);
    const after = ray.intersectObject(root, true);
    expect(after[0].distance).toBeCloseTo(before[0].distance, 6);
    expect(meshes(root).length).toBeGreaterThan(1);
    expect(meshes(root).every(m => m.geometry.boundsTree && m.raycast === acceleratedRaycast)).toBe(true);
  });

  it('accelerates match clones with shared trees and fades only the local obstruction', () => {
    const original = field();
    prepareSpatialField(original);
    const root = cloneSpatialField(original);
    root.updateMatrixWorld(true);
    expect(meshes(root).every(m => m.raycast === acceleratedRaycast)).toBe(true);
    expect(meshes(root)[0].geometry).toBe(meshes(original)[0].geometry);
    const fader = new OcclusionFader(root);
    const eye = new THREE.Vector3(-6, -4, 1);
    fader.update(1, eye, [new THREE.Vector3(-6, 2, 1)]);
    const near = meshes(root).filter(m => new THREE.Box3().setFromObject(m).max.x < 0);
    const far = meshes(root).filter(m => new THREE.Box3().setFromObject(m).min.x > 0);
    expect(near.some(m => (m.material as THREE.Material).opacity < .2)).toBe(true);
    expect(far.every(m => !(m.material as THREE.Material).transparent)).toBe(true);
    expect(meshes(original).every(m => !(m.material as THREE.Material).transparent)).toBe(true);
    fader.update(1, eye, []);
    expect(meshes(root).every(m => !(m.material as THREE.Material).transparent)).toBe(true);
    fader.clear();
  });
});
