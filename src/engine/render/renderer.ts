import * as THREE from 'three';

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

  constructor(
    readonly container: HTMLElement,
    fieldLength: number,
    fieldWidth: number,
    opts: RendererOptions = {},
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, opts.pixelRatioCap ?? 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = opts.shadows ?? true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(55, 1, 0.05, 200);
    this.camera.position.set(0, 10, 12);

    this.scene.background = new THREE.Color(0xe4e6ee);
    this.scene.fog = new THREE.Fog(0xe4e6ee, 45, 100);

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

  /** Venue floor + simple stands so the field doesn't float in a void. */
  private addArenaBackdrop(L: number, W: number): void {
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(L + 30, W + 30),
      new THREE.MeshStandardMaterial({ color: 0xc9ccd6, roughness: 0.95 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.01;
    floor.receiveShadow = true;
    this.scene.add(floor);

    const standMat = new THREE.MeshStandardMaterial({ color: 0xb4b2c8, roughness: 0.9 });
    for (const side of [-1, 1]) {
      for (let tier = 0; tier < 6; tier++) {
        const step = new THREE.Mesh(new THREE.BoxGeometry(L + 6, 0.45, 0.9), standMat);
        step.position.set(0, 0.25 + tier * 0.45, side * (W / 2 + 4 + tier * 0.9));
        step.receiveShadow = true;
        this.scene.add(step);
      }
    }
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

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }

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
