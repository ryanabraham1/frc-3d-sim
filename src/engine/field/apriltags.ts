import * as THREE from 'three';
import { FieldBuilder } from './builder';
import { inch } from '../units';
import { HEADLESS } from '../render/text';

/** WPILib AprilTagFieldLayout JSON shape (same format every year). */
export interface AprilTagLayout {
  tags: {
    ID: number;
    pose: {
      translation: { x: number; y: number; z: number };
      rotation: { quaternion: { W: number; X: number; Y: number; Z: number } };
    };
  }[];
  field: { length: number; width: number };
}

export interface TagPose {
  id: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
}

/** Tag poses in field frame; yaw is the direction the tag faces. */
export function tagPoses(layout: AprilTagLayout): TagPose[] {
  return layout.tags.map((t) => {
    const q = t.pose.rotation.quaternion;
    const yaw = Math.atan2(2 * (q.W * q.Z + q.X * q.Y), 1 - 2 * (q.Y * q.Y + q.Z * q.Z));
    return { id: t.ID, x: t.pose.translation.x, y: t.pose.translation.y, z: t.pose.translation.z, yaw };
  });
}

/** Stylised tag texture: black square with a deterministic bit pattern and ID label. Not a decodable 36h11 tag. */
function tagTexture(id: number): THREE.Texture {
  if (HEADLESS) return new THREE.Texture();
  const size = 256;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, size, size);
  const tagPx = size * (8.125 / 10.5);
  const off = (size - tagPx) / 2;
  g.fillStyle = '#000000';
  g.fillRect(off, off, tagPx, tagPx);
  const cell = tagPx / 8;
  let h = (id * 2654435761) >>> 0;
  g.fillStyle = '#ffffff';
  for (let r = 0; r < 6; r++) {
    for (let col = 0; col < 6; col++) {
      h = (h ^ (h << 13)) >>> 0;
      h = (h ^ (h >>> 17)) >>> 0;
      h = (h ^ (h << 5)) >>> 0;
      if (h & 1) g.fillRect(off + cell * (col + 1), off + cell * (r + 1), cell, cell);
    }
  }
  g.fillStyle = '#000000';
  g.font = 'bold 26px system-ui, sans-serif';
  g.textAlign = 'center';
  g.fillText(String(id), size / 2, size - 6);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.NearestFilter;
  return tex;
}

/** Place a 10.5in panel for every tag in the layout (visual only, offset slightly off its mount). */
export function addAprilTags(builder: FieldBuilder, layout: AprilTagLayout, panelSize = inch(10.5)): void {
  for (const t of tagPoses(layout)) {
    const nx = Math.cos(t.yaw) * 0.004;
    const ny = Math.sin(t.yaw) * 0.004;
    builder.panel([t.x + nx, t.y + ny, t.z], panelSize, panelSize, tagTexture(t.id), t.yaw, { name: `apriltag-${t.id}` });
  }
}
