import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { FieldFrame } from '../coords';

export interface CadOverlayOptions {
  /** URL of a .glb exported from the official field CAD (Onshape → export → glTF). */
  url: string;
  /** Scale to meters (Onshape glTF exports are already meters → 1). */
  scale?: number;
  /** Where the CAD origin sits in FIELD frame, and its yaw. */
  originField?: { x: number; y: number; z: number; yaw: number };
  /** Hide the procedural visual meshes when the overlay loads (colliders stay procedural). */
  hideProcedural?: boolean;
}

/**
 * Optional visual-only overlay of official CAD. Physics stays on the procedural colliders,
 * which are much cheaper and more robust than mesh colliders from CAD.
 */
export async function loadCadOverlay(scene: THREE.Scene, frame: FieldFrame, proceduralRoot: THREE.Object3D, o: CadOverlayOptions): Promise<THREE.Object3D> {
  const gltf = await new GLTFLoader().loadAsync(o.url);
  const root = gltf.scene;
  root.scale.setScalar(o.scale ?? 1);
  const org = o.originField ?? { x: 0, y: 0, z: 0, yaw: 0 };
  frame.toWorld(org.x, org.y, org.z, root.position);
  root.rotation.y = org.yaw;
  root.traverse((obj) => {
    const m = obj as THREE.Mesh;
    if (m.isMesh) {
      m.castShadow = true;
      m.receiveShadow = true;
    }
  });
  scene.add(root);
  if (o.hideProcedural) {
    proceduralRoot.traverse((obj) => {
      const m = obj as THREE.Mesh;
      if (m.isMesh && !m.name.startsWith('keep')) m.visible = false;
    });
  }
  return root;
}
