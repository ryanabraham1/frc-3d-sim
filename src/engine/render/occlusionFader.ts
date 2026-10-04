import * as THREE from 'three';

/** Opacity a field element fades to while it hides the robot. */
const FADED_OPACITY = 0.15;
/** Fade speed (1/s, exponential). */
const FADE_RATE = 10;
/** Meshes whose bounds come this close to the camera (m) fade too: they fill the view (or enclose the camera). */
const EYE_MARGIN = 1.2;

interface Faded {
  mesh: THREE.Mesh;
  original: THREE.Material | THREE.Material[];
  faded: THREE.Material[];
  opacity: number;
  blocking: boolean;
}

/**
 * Makes field elements see-through while they sit between the camera and the robot, so a third-person camera
 * can stay put behind trusses and walls instead of zooming in. Meshes right around the camera (the SPEAKER hood it sits
 * in when the robot starts at the SUBWOOFER) fade too: a ray starting inside a mesh never hits it. FieldBuilder shares materials between meshes,
 * so each faded mesh gets its own transparent clone while it fades, and its original material back after.
 */
export class OcclusionFader {
  private readonly raycaster = new THREE.Raycaster();
  private readonly hits: THREE.Intersection[] = [];
  private readonly faded = new Map<THREE.Mesh, Faded>();
  private readonly dir = new THREE.Vector3();
  private readonly box = new THREE.Box3();

  constructor(private readonly root: THREE.Object3D) {}

  /** Fade whatever blocks the view from `eye` to any of `targets`; pass no targets to fade everything back in. */
  update(dt: number, eye: THREE.Vector3, targets: readonly THREE.Vector3[]): void {
    for (const f of this.faded.values()) f.blocking = false;
    if (targets.length) {
      this.root.traverseVisible((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
        this.box.copy(mesh.geometry.boundingBox!).applyMatrix4(mesh.matrixWorld);
        if (this.box.distanceToPoint(eye) < EYE_MARGIN) this.fade(mesh);
      });
    }
    for (const target of targets) {
      const dist = this.dir.copy(target).sub(eye).length();
      if (dist < 1e-3) continue;
      this.raycaster.set(eye, this.dir.divideScalar(dist));
      this.raycaster.far = dist;
      this.hits.length = 0;
      this.raycaster.intersectObject(this.root, true, this.hits);
      for (const h of this.hits) {
        const mesh = h.object as THREE.Mesh;
        if (mesh.isMesh && mesh.visible) this.fade(mesh);
      }
    }
    const k = 1 - Math.exp(-dt * FADE_RATE);
    for (const [mesh, f] of this.faded) {
      f.opacity += ((f.blocking ? FADED_OPACITY : 1) - f.opacity) * k;
      if (!f.blocking && f.opacity > 0.98) {
        mesh.material = f.original;
        for (const m of f.faded) m.dispose();
        this.faded.delete(mesh);
        continue;
      }
      const originals = Array.isArray(f.original) ? f.original : [f.original];
      f.faded.forEach((m, i) => (m.opacity = originals[i].opacity * f.opacity));
    }
  }

  private fade(mesh: THREE.Mesh): void {
    let f = this.faded.get(mesh);
    if (!f) {
      const original = mesh.material;
      const faded = (Array.isArray(original) ? original : [original]).map((m) => {
        const c = m.clone();
        c.transparent = true;
        c.depthWrite = false;
        return c;
      });
      mesh.material = Array.isArray(original) ? faded : faded[0];
      f = { mesh, original, faded, opacity: 1, blocking: true };
      this.faded.set(mesh, f);
    }
    f.blocking = true;
  }

  /** Restore every faded mesh immediately. */
  clear(): void {
    for (const [mesh, f] of this.faded) {
      mesh.material = f.original;
      for (const m of f.faded) m.dispose();
    }
    this.faded.clear();
  }
}
