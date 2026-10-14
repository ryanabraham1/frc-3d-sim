import * as THREE from 'three';

type Finish = 'clear' | 'metal' | 'diamond' | 'vinyl' | 'paint' | 'plastic';
const textures = new Map<Finish, THREE.DataTexture>();

/** Small repeating height/roughness maps, rather than extra geometry or expensive refraction passes. */
function surfaceTexture(finish: Finish): THREE.DataTexture {
  const existing = textures.get(finish);
  if (existing) return existing;
  const size = 128, data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const noise = ((Math.imul(x + 17, 374761393) ^ Math.imul(y + 29, 668265263)) >>> 0) % 256 / 255;
    let value = .85 + noise * .15;
    if (finish === 'metal') value = .8 + .12 * Math.sin(y * 1.7) + noise * .08;
    if (finish === 'diamond') {
      const cell = size / 2;
      const cx = Math.floor(x / cell), cy = Math.floor(y / cell);
      const u = (x % cell + .5) / cell - .5, v = (y % cell + .5) / cell - .5;
      const a = (u + v) * Math.SQRT1_2, b = (u - v) * Math.SQRT1_2;
      const long = (cx + cy) % 2 ? a : b, short = (cx + cy) % 2 ? b : a;
      const ridge = Math.max(0, 1 - Math.abs(long) / .36 - Math.abs(short) / .07);
      value = .55 + .43 * Math.min(1, ridge * 5) + noise * .02;
    }
    const p = (y * size + x) * 4;
    data[p] = data[p+1] = data[p+2] = Math.round(value * 255); data[p+3] = 255;
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 4;
  texture.repeat.setScalar(finish === 'diamond' ? 16 : 24);
  texture.needsUpdate = true;
  textures.set(finish, texture);
  return texture;
}

/** Source HUB assets predate finish metadata. Their material names encode the authored sRGB paint and finish. */
function finishOf(material: THREE.MeshStandardMaterial): Finish | undefined {
  if (material.userData.fieldFinish) return material.userData.fieldFinish as Finish;
  const fields = material.name.split('|').map(Number);
  if (fields.length !== 4 || !fields.every(Number.isFinite)) return undefined;
  material.color.setHex(fields[0]);
  const finish: Finish = material.transparent ? 'clear' : material.metalness > .3 ? 'metal' : fields[0] === 0x17191c ? 'vinyl' : 'plastic';
  material.userData.fieldFinish = finish;
  return finish;
}

/** Assign metre-scale UVs to legacy HUB parts. Clone shared CAD geometry before adding instance-specific UVs. */
function ensureUV(mesh: THREE.Mesh): void {
  if (mesh.geometry.getAttribute('uv')) return;
  const geo = mesh.geometry.clone();
  const pos = geo.getAttribute('position');
  if (!geo.boundingBox) geo.computeBoundingBox();
  const bounds = new THREE.Box3().copy(geo.boundingBox!).applyMatrix4(mesh.matrixWorld);
  const size = bounds.getSize(new THREE.Vector3()).toArray();
  const thin = size.indexOf(Math.min(...size));
  const axes = [0, 1, 2].filter(k => k !== thin);
  const uv = new Float32Array(pos.count * 2), p = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
    uv[i*2] = p.getComponent(axes[0]); uv[i*2+1] = p.getComponent(axes[1]);
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  mesh.geometry = geo;
}

/** Visual only: genuine clear panels do not write opaque depth, and vinyl sits above its plastic backing. */
export function applyCadFinishes(root: THREE.Object3D, environment?: THREE.Texture | null): void {
  root.updateMatrixWorld(true);
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const raw of materials) {
      const material = raw as THREE.MeshStandardMaterial;
      if (!material.isMeshStandardMaterial) continue;
      const finish = finishOf(material);
      if (!finish) continue;
      if (finish === 'clear') {
        material.depthWrite = false;
        material.forceSinglePass = true;
        mesh.castShadow = false;
      } else {
        ensureUV(mesh);
        material.roughnessMap = surfaceTexture(finish);
        material.bumpMap = material.roughnessMap;
        material.bumpScale = finish === 'diamond' ? .0012 : finish === 'metal' ? .00012 : .000035;
      }
      if (finish === 'vinyl') {
        material.polygonOffset = true;
        material.polygonOffsetFactor = -1;
        material.polygonOffsetUnits = -2;
      }
      if (environment !== undefined && (finish === 'clear' || material.metalness > .25)) {
        material.envMap = environment;
        material.envMapIntensity = finish === 'clear' ? .35 : .22;
      }
      material.needsUpdate = true;
    }
  });
}
