import * as THREE from 'three';
import { MeshBVH, type HitPointInfo } from 'three-mesh-bvh';

const trees = new WeakMap<THREE.BufferGeometry, MeshBVH>();
interface Surface {
  mesh: THREE.Mesh;
  toBin: THREE.Matrix4;
  fromBin: THREE.Matrix4;
  bounds: THREE.Box3;
  scale: number;
}

/** Sphere contacts against the rendered robot triangles, including articulated CAD assemblies.
 * Trees are built lazily only for nearby geometry; chassis motion cancels in the bin frame.
 * No global Three.js prototype patches, extra render geometry, or per-ball allocations.
 */
export class FuelContacts {
  private readonly surfaces: Surface[] = [];
  private readonly inverse = new THREE.Matrix4();
  private readonly local = new THREE.Vector3();
  private readonly centre = new THREE.Vector3();
  private readonly normal = new THREE.Vector3();
  private readonly hit: HitPointInfo = { point: new THREE.Vector3(), distance: 0, faceIndex: 0 };
  private readonly previous = new THREE.Matrix4();
  private readonly envelope = new THREE.Box3();
  private initialized = false;

  constructor(private readonly visual: THREE.Object3D, private readonly bin: THREE.Object3D, private readonly transport = false, private readonly importedOnly = false) {}

  /** Called after model animation, before the sleeping particle solver. */
  sync(): boolean {
    this.visual.updateMatrixWorld(true);
    this.inverse.copy(this.bin.matrixWorld).invert();
    if (!this.initialized) {
      this.visual.traverseVisible(o => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh || (mesh as THREE.InstancedMesh).isInstancedMesh || mesh.userData.flowToken || mesh.userData.fuelNoContact) return;
        // Driven rollers are compliant pickup/feeder surfaces, not stationary barriers to their own transported ball.
        // Their traction is represented by the transport lane; structural hopper walls remain solid.
        let imported = !!mesh.userData.fuelCadContact;
        if (this.transport && mesh.userData.fuelDrivenSurface) return;
        for (let part: THREE.Object3D | null = mesh; part && part !== this.visual; part = part.parent) {
          if (part.userData.cadModel || part.userData.cadDonor) imported = true;
          if (part.userData.flowToken || part.userData.fuelNoContact || (this.transport && /(?:intake|feeder|serializer|flywheel)/i.test(part.name))) return;
        }
        if (this.importedOnly && !imported) return;
        if (!mesh.geometry.getAttribute('position')) return;
        mesh.geometry.computeBoundingBox();
        this.surfaces.push({mesh, toBin: new THREE.Matrix4(), fromBin: new THREE.Matrix4(), bounds: new THREE.Box3(), scale: 1});
      });
      this.initialized = true;
    }
    let changed = false;
    const b = this.bin.userData.fuelBin ?? {x:0,length:2,width:2,y0:0,height:2};
    this.envelope.min.set(b.x-b.length/2-.1,b.y0-.1,-b.width/2-.1);
    this.envelope.max.set(b.x+b.length/2+.1,b.y0+b.height+.1,b.width/2+.1);
    for (const s of this.surfaces) {
      this.previous.copy(s.toBin);
      s.toBin.multiplyMatrices(this.inverse, s.mesh.matrixWorld);
      s.fromBin.copy(s.toBin).invert();
      s.bounds.copy(s.mesh.geometry.boundingBox!).applyMatrix4(s.toBin);
      if (s.bounds.intersectsBox(this.envelope) && s.toBin.elements.some((v, i) => Math.abs(v - this.previous.elements[i]) > 1e-5)) changed = true;
      const e = s.fromBin.elements;
      s.scale = Math.max(Math.hypot(e[0],e[1],e[2]), Math.hypot(e[4],e[5],e[6]), Math.hypot(e[8],e[9],e[10]));
    }
    return changed;
  }

  resolve(p: Float32Array, v: Float32Array, j: number, radius: number): void {
    this.centre.fromArray(p, j);
    for (const s of this.surfaces) {
      if (!s.mesh.visible || s.bounds.distanceToPoint(this.centre) >= radius) continue;
      let tree = trees.get(s.mesh.geometry);
      if (!tree) {
        tree = new MeshBVH(s.mesh.geometry, { indirect: true });
        trees.set(s.mesh.geometry, tree);
      }
      this.local.copy(this.centre).applyMatrix4(s.fromBin);
      if (!tree.closestPointToPoint(this.local, this.hit, 0, radius * s.scale)) continue;
      this.hit.point.applyMatrix4(s.toBin);
      this.normal.subVectors(this.centre, this.hit.point);
      const distance = this.normal.length();
      if (distance >= radius || distance < 1e-8) continue;
      this.normal.multiplyScalar(1 / distance);
      this.centre.addScaledVector(this.normal, radius - distance + 0.0001);
      const closing = v[j] * this.normal.x + v[j+1] * this.normal.y + v[j+2] * this.normal.z;
      if (closing < 0) {
        v[j] -= this.normal.x * closing * 1.08;
        v[j+1] -= this.normal.y * closing * 1.08;
        v[j+2] -= this.normal.z * closing * 1.08;
      }
    }
    this.centre.toArray(p, j);
  }
}
