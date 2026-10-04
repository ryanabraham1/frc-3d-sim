import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { setRobotEnvironment } from '../robot/models';
import { mergeStatic } from './mergeStatic';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** Arena background / fog color (house lights down). */
const ARENA_DARK = 0x0c0e13;

/** Dynamic resolution never renders below this many device pixels per CSS pixel. */
const MIN_PIXEL_RATIO = 0.75;

export interface RendererOptions {
  shadows?: boolean;
  pixelRatioCap?: number;
}

/** Owns the Three.js renderer, scene, main camera, lights and a generic arena backdrop. */
export class Renderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  private readonly onResize = () => this.resize();
  /** Highest pixel ratio used (device ratio, capped); `adaptQuality` works between MIN_PIXEL_RATIO and this. */
  private readonly maxPixelRatio: number;
  private pixelRatio: number;
  private slowWindows = 0;
  private fastWindows = 0;

  constructor(
    readonly container: HTMLElement,
    fieldLength: number,
    fieldWidth: number,
    opts: RendererOptions = {},
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    // 1.5 looks the same as 2 on high-DPI screens with antialiasing, at ~56% of the pixels.
    this.maxPixelRatio = Math.min(window.devicePixelRatio || 1, opts.pixelRatioCap ?? 1.5);
    this.pixelRatio = this.maxPixelRatio;
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = opts.shadows ?? true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.shadowMap.autoUpdate = false;
    container.appendChild(this.renderer.domElement);
    // Studio reflections for team robot models only (the field keeps its plain lighting): metal and polycarbonate
    // read as aluminum / smoked plastic instead of flat gray.
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    setRobotEnvironment(pmrem.fromScene(new RoomEnvironment(), 0.04).texture);
    pmrem.dispose();

    this.camera = new THREE.PerspectiveCamera(55, 1, 0.05, 200);
    this.camera.position.set(0, 10, 12);

    // Event venue: the field is lit, the arena around it is dark (like a real FRC event under the house lights).
    this.scene.background = new THREE.Color(ARENA_DARK);
    this.scene.fog = new THREE.Fog(ARENA_DARK, 28, 70);

    const hemi = new THREE.HemisphereLight(0xdfe8ff, 0x3a3228, 1.1);
    this.scene.add(hemi);

    const sun = new THREE.DirectionalLight(0xffffff, 2.2);
    sun.position.set(-6, 18, 8);
    sun.castShadow = opts.shadows ?? true;
    sun.shadow.mapSize.set(2048, 2048);
    const half = Math.max(fieldLength, fieldWidth) / 2 + 1;
    sun.shadow.camera.left = -half;
    sun.shadow.camera.right = half;
    sun.shadow.camera.top = half;
    sun.shadow.camera.bottom = -half;
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 50;
    sun.shadow.bias = -0.0005;
    this.scene.add(sun);

    const fill = new THREE.DirectionalLight(0xbfd4ff, 0.6);
    fill.position.set(8, 10, -6);
    this.scene.add(fill);

    this.addArenaBackdrop(fieldLength, fieldWidth);

    window.addEventListener('resize', this.onResize);
    this.resize();
  }

  /**
   * Event venue around the field (visual only, no colliders): dark arena floor, tiered stands with a seated crowd
   * along both sides, pipe-and-drape behind the driver stations and lighting trusses overhead.
   */
  private addArenaBackdrop(L: number, W: number): void {
    const venue = new THREE.Group();
    venue.name = 'venue';
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(L + 40, W + 40),
      new THREE.MeshStandardMaterial({ color: 0x24262c, roughness: 0.92 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.01;
    floor.receiveShadow = true;
    venue.add(floor);

    // Stands: risers with rows of empty seats and a front rail (seats are one instanced mesh).
    const TIERS = 9;
    const RISE = 0.42;
    const DEPTH = 0.85;
    const standLen = L + 8;
    const riserMat = new THREE.MeshStandardMaterial({ color: 0x30333c, roughness: 0.85 });
    const edgeMat = new THREE.MeshStandardMaterial({ color: 0x4a4f5c, roughness: 0.6, metalness: 0.4 });
    const railMat = new THREE.MeshStandardMaterial({ color: 0x8b919d, roughness: 0.35, metalness: 0.8 });
    const seatW = 0.55;
    const perRow = Math.floor(standLen / seatW);
    // Seat: pan + back in one L-shaped geometry.
    const seatGeo = mergeSeat();
    const seats = new THREE.InstancedMesh(seatGeo, new THREE.MeshStandardMaterial({ color: 0x23334f, roughness: 0.7 }), 2 * TIERS * perRow);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const one = new THREE.Vector3(1, 1, 1);
    let n = 0;
    for (const side of [-1, 1]) {
      const z0 = side * (W / 2 + 3.2);
      const face = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), side > 0 ? 0 : Math.PI);
      for (let tier = 0; tier < TIERS; tier++) {
        const y = RISE * (tier + 1);
        const z = z0 + side * tier * DEPTH;
        const step = new THREE.Mesh(new THREE.BoxGeometry(standLen, y, DEPTH), riserMat);
        step.position.set(0, y / 2, z + side * DEPTH / 2);
        step.receiveShadow = true;
        venue.add(step);
        const nose = new THREE.Mesh(new THREE.BoxGeometry(standLen, 0.04, 0.06), edgeMat);
        nose.position.set(0, y, z);
        venue.add(nose);
        for (let k = 0; k < perRow; k++) {
          if (k % 12 === 6) continue; // aisle
          const x = -standLen / 2 + seatW * (k + 0.5);
          q.copy(face);
          m.compose(new THREE.Vector3(x, y, z + side * DEPTH * 0.55), q, one);
          seats.setMatrixAt(n++, m);
        }
      }
      // Front rail along the lowest tier.
      for (const h of [0.5, 1.0]) {
        const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, standLen, 8), railMat);
        rail.rotation.z = Math.PI / 2;
        rail.position.set(0, h, z0 - side * 0.15);
        venue.add(rail);
      }
      for (let x = -standLen / 2; x <= standLen / 2 + 0.01; x += 2) {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.0, 8), railMat);
        post.position.set(x, 0.5, z0 - side * 0.15);
        venue.add(post);
      }
      // Back wall behind the top row.
      const back = new THREE.Mesh(new THREE.BoxGeometry(standLen, 7, 0.3), new THREE.MeshStandardMaterial({ color: 0x15171c, roughness: 0.95 }));
      back.position.set(0, 3.5, z0 + side * (TIERS * DEPTH + 0.15));
      venue.add(back);
    }
    seats.count = n;
    seats.instanceMatrix.needsUpdate = true;
    venue.add(seats);

    // Pipe-and-drape behind both driver stations.
    const drapeMat = new THREE.MeshStandardMaterial({ color: 0x14151a, roughness: 1 });
    for (const end of [-1, 1]) {
      const drape = new THREE.Mesh(new THREE.BoxGeometry(0.1, 3.2, W + 6), drapeMat);
      drape.position.set(end * (L / 2 + 5), 1.6, 0);
      venue.add(drape);
    }

    // Lighting trusses over the field: box truss with bright fixtures (emissive only; the scene lights do the work).
    const trussMat = new THREE.MeshStandardMaterial({ color: 0x3a3e47, roughness: 0.5, metalness: 0.7 });
    const lampMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff4e0, emissiveIntensity: 2.2 });
    const lampGeo = new THREE.BoxGeometry(0.5, 0.08, 0.5);
    const trussY = 10.5;
    for (const zt of [-W / 2 - 1, W / 2 + 1]) {
      const beam = new THREE.Mesh(new THREE.BoxGeometry(L + 6, 0.35, 0.35), trussMat);
      beam.position.set(0, trussY, zt);
      venue.add(beam);
      const lamps = new THREE.InstancedMesh(lampGeo, lampMat, 7);
      for (let i = 0; i < 7; i++) {
        m.makeTranslation(-L / 2 + (L * (i + 0.5)) / 7, trussY - 0.25, zt);
        lamps.setMatrixAt(i, m);
      }
      venue.add(lamps);
    }
    for (const xt of [-L / 2 - 2, L / 2 + 2]) {
      const cross = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.35, W + 2.4), trussMat);
      cross.position.set(xt, trussY, 0);
      venue.add(cross);
    }
    venue.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) mesh.castShadow = false;
    });
    // Nothing in the venue moves: bake it into one mesh per material.
    mergeStatic(venue);
    this.scene.add(venue);
  }

  resize(): void {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /**
   * Dynamic resolution: call with the measured frame rate every ~0.5 s. Sustained low fps lowers the
   * render resolution a step; sustained high fps raises it back (never above the starting ratio).
   */
  adaptQuality(fps: number): void {
    if (fps < 45) {
      this.fastWindows = 0;
      if (++this.slowWindows >= 2 && this.pixelRatio > MIN_PIXEL_RATIO) {
        this.slowWindows = 0;
        this.setPixelRatio(Math.max(MIN_PIXEL_RATIO, this.pixelRatio - 0.25));
      }
    } else if (fps > 57) {
      this.slowWindows = 0;
      if (++this.fastWindows >= 10 && this.pixelRatio < this.maxPixelRatio) {
        this.fastWindows = 0;
        this.setPixelRatio(Math.min(this.maxPixelRatio, this.pixelRatio + 0.25));
      }
    } else {
      this.slowWindows = 0;
      this.fastWindows = 0;
    }
  }

  get currentPixelRatio(): number {
    return this.pixelRatio;
  }

  private setPixelRatio(r: number): void {
    this.pixelRatio = r;
    this.renderer.setPixelRatio(r);
    this.resize();
  }

  render(): void {
    // Shadows refresh every other frame (~30 Hz at the 60 fps cap): the shadow pass redraws every caster, and a
    // robot moves ~1 cm between refreshes.
    if (this.renderer.shadowMap.enabled) this.renderer.shadowMap.needsUpdate = (this.frame++ & 1) === 0;
    this.renderer.render(this.scene, this.camera);
  }
  private frame = 0;

  dispose(): void {
    window.removeEventListener('resize', this.onResize);
    this.scene.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
      else mat?.dispose();
    });
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}

/** Stadium seat facing -z (pan + back), origin on the riser surface. */
function mergeSeat(): THREE.BufferGeometry {
  const pan = new THREE.BoxGeometry(0.44, 0.06, 0.38).translate(0, 0.32, 0);
  const back = new THREE.BoxGeometry(0.44, 0.38, 0.05).translate(0, 0.5, 0.19);
  const post = new THREE.BoxGeometry(0.06, 0.3, 0.06).translate(0, 0.15, 0.05);
  return mergeGeometries([pan, back, post])!;
}
