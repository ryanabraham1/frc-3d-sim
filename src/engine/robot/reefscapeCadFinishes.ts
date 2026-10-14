import * as THREE from 'three';

/** Competition finishes for pale manufacturing CAD swatches (refs/<team>-2025/sheet.jpg).
 * Preserve team colors, black components, rubber, transparency and Firefly's actual white paint.
 */
export function finishReefscapeCad(material: THREE.MeshStandardMaterial, id: string, group: string): void {
  if (!material.isMeshStandardMaterial || material.transparent || material.opacity < 1 || material.map || material.name === 'rubber') return;
  const { r, g, b } = material.color;
  const pale = Math.min(r, g, b) > .60 && Math.max(r, g, b) - Math.min(r, g, b) < .18;
  if (!pale) return;
  if (id === 'firefly-118') {
    // Robonauts intentionally use white coated plates alongside a gold elevator.
    material.metalness = .12;
    material.roughness = .52;
    return;
  }
  if (id === 'sublime-1678' && group === 'effector' && b > r + .05) {
    // The pale blue CAD head is clear polycarbonate in the Citrus pit photo.
    material.color.setRGB(.65, .73, .79);
    material.opacity = .28;
    material.transparent = true;
    material.depthWrite = false;
    material.side = THREE.DoubleSide;
    material.metalness = 0;
    material.roughness = .28;
  } else if (id === 'sublime-1678' && group === 'arm') {
    material.color.setRGB(.12, .13, .14);
    material.metalness = .08;
    material.roughness = .72;
  } else {
    // Bright diffuse white washed out the machined aluminum under the field lights.
    material.color.setRGB(.62, .64, .67);
    material.metalness = .88;
    material.roughness = .34;
  }
}
