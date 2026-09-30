import * as THREE from 'three';

export interface TextTextureOptions {
  font?: string;
  color?: string;
  background?: string;
  width?: number;
  height?: number;
  padding?: number;
}

/** Canvas-rendered text as a texture (team numbers, labels, AprilTag IDs). */
export function makeTextTexture(text: string, o: TextTextureOptions = {}): THREE.CanvasTexture {
  const w = o.width ?? 256;
  const h = o.height ?? 128;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  if (o.background) {
    ctx.fillStyle = o.background;
    ctx.fillRect(0, 0, w, h);
  }
  ctx.fillStyle = o.color ?? '#ffffff';
  ctx.font = o.font ?? `bold ${Math.floor(h * 0.7)}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, w / 2, h / 2 + h * 0.04, w - (o.padding ?? 8) * 2);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/** Billboard sprite with text; size is world height in meters. */
export function makeTextSprite(text: string, heightM: number, o: TextTextureOptions = {}): THREE.Sprite {
  const tex = makeTextTexture(text, o);
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
  const sprite = new THREE.Sprite(mat);
  const aspect = (o.width ?? 256) / (o.height ?? 128);
  sprite.scale.set(heightM * aspect, heightM, 1);
  return sprite;
}
