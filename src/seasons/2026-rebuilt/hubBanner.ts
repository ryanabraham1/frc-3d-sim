import * as THREE from 'three';
import type { Alliance } from '../../engine/coords';
import type { FieldBuilder } from '../../engine/field/builder';
import { inch } from '../../engine/units';

// FIRST drawing GE-26327: artwork is 39.64 x 25.61 in, starting 14.53 in below the panel top.
// The texture is extracted directly from its orthographic front view; see public/assets/field/rebuilt-hub-banner.md.
const WIDTH = inch(39.64), HEIGHT = inch(25.61);
const TOP = 1.273175 - inch(14.53);
let material: THREE.MeshStandardMaterial | null = null;
let loading: Promise<void> | null = null;

export function prepareHubBanner(): Promise<void> {
  if (typeof document === 'undefined') return Promise.resolve();
  return loading ??= new THREE.TextureLoader().loadAsync(`${import.meta.env.BASE_URL}assets/field/rebuilt-hub-banner.png`)
    .then(texture => {
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = 4;
      material = new THREE.MeshStandardMaterial({ name: 'official-rebuilt-hub-banner', map: texture, roughness: .78,
        polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 });
    }).catch(error => { console.warn('[field] HUB banner unavailable', error); });
}

/** A visual decal on each side, with the printed lower V cutout; no change to field collision. */
export function addHubBannerVisual(b: FieldBuilder, alliance: Alliance, center: { x: number; y: number }): void {
  if (!material) return;
  const shape = new THREE.Shape();
  shape.moveTo(-WIDTH / 2, HEIGHT / 2);
  shape.lineTo(-WIDTH / 2, -HEIGHT / 2);
  shape.lineTo(0, -HEIGHT / 2 + HEIGHT * .20);
  shape.lineTo(WIDTH / 2, -HEIGHT / 2);
  shape.lineTo(WIDTH / 2, HEIGHT / 2);
  shape.closePath();
  const geometry = new THREE.ShapeGeometry(shape);
  const position = geometry.getAttribute('position');
  const uv = geometry.getAttribute('uv');
  for (let i = 0; i < position.count; i++) uv.setXY(i, position.getX(i) / WIDTH + .5, position.getY(i) / HEIGHT + .5);
  const group = new THREE.Group();
  group.name = `hub-${alliance}-official-banners`;
  for (const side of [-1, 1]) {
    const banner = new THREE.Mesh(geometry, material);
    banner.name = `hub-${alliance}-banner-${side}`;
    // Hub-local CAD coordinates, Z up. Reading from the opposite side reverses horizontal X, never the artwork.
    banner.rotation.set(Math.PI / 2, side > 0 ? Math.PI : 0, 0);
    banner.position.set(0, side * .6005, TOP - HEIGHT / 2);
    banner.receiveShadow = true;
    group.add(banner);
  }
  group.rotation.x = -Math.PI / 2;
  if (alliance === 'red') group.rotation.z = Math.PI;
  group.position.copy(b.frame.toWorld(center.x, center.y, 0));
  b.root.add(group);
}
