import * as THREE from 'three';
import { FuelPile } from './fuelPile';
import { FuelContacts } from './fuelContacts';
import type { Alliance } from '../coords';
import type { RobotConfig } from './config';
import { HEADLESS, makeTextTexture } from '../render/text';
import { cadRobotModelBuilder } from './cadModels';

/**
 * TEAM ROBOT MODELS — simplified, animated 3D recreations of real teams' robots (254's turret, 4414's dye rotor…).
 * A model is purely visual: physics, capture zones and scoring still come from the RobotConfig, so a model must
 * draw its mechanisms where the config says they are (intake on `groundSide`, launcher at `launcher.height`…).
 * Seasons register builders by id (`registerRobotModel`) and a config opts in with `config.model = id`.
 *
 * Animation is driven once per rendered frame from `RobotAnimState` — a handful of transforms per robot, no
 * geometry rebuilds — so it costs next to nothing.
 */

/** Generic robot parts a team model can replace (they are hidden when listed in `RobotModel.replaces`). */
export type ModelPart = 'bumpers' | 'chassis' | 'hopper' | 'launcher' | 'climber' | 'intakeRollers' | 'funnel' | 'mast';

/**
 * Placement mechanism pose from the season rules. `forward` is the reach from the robot center along the scoring
 * direction: the front (+x), or the robot's left / right when `side` is +1 / -1 (side-scoring arms). `handoff` runs
 * 0→1 while a floor-intaken piece is passed from the ground intake to the end effector (0 = no handoff).
 */
export interface PlaceAnim { height: number; forward: number; level: number; side?: number; handoff?: number; algae?: boolean }

/** What a model sees each frame. */
export interface RobotAnimState {
  /** Seconds since the last frame (clamped) and a running clock. */
  dt: number;
  time: number;
  enabled: boolean;
  /** Intake command held (or replicated). */
  intaking: boolean;
  /** 1 right after a piece leaves the robot, decaying to 0 over ~0.35 s. */
  firing: number;
  /** Pass / AMP button held. */
  passing: boolean;
  /** Season AMP deployment, distinct from a midfield pass. */
  amp?: boolean;
  /** Shoot or pass held: the shooter is spun up and the hood is tracking the shot (`hood`). */
  aiming: boolean;
  /** Launch elevation of the latest shot (rad), or the config's default angle. */
  hood: number;
  /** Pieces held / capacity, 0–1. */
  fill: number;
  /** 0 = stowed, 1 = hooks raised to grab (align), 0.25 = pulled in (rising / hanging). */
  climb: number;
  /** Shot blocker deployment (config.shotBlocker): 0 = stowed flat on top, 1 = swung out over the intake side. */
  blocker: number;
  /** Season-supplied placement mechanism pose (REEFSCAPE end effector): height above robot origin, forward reach. */
  place: PlaceAnim | null;
  /** Chassis-frame velocity (m/s; x forward, z = robot right) and yaw rate (rad/s) — swerve modules steer/roll with it. */
  vx: number;
  vz: number;
  omega: number;
  /** World up expressed in the chassis frame (level = 0,1,0): tilts pour loose FUEL toward the low side. */
  upx?: number;
  upy?: number;
  upz?: number;
}

export interface ModelKit {
  config: RobotConfig;
  alliance: Alliance;
  /** Footprint with bumpers. */
  fp: { length: number; width: number };
  /** Chassis-attached group (local +x forward, +y up, -z robot left). */
  visual: THREE.Group;
  /** Group that yaws with the turret (positioned at the launcher by the robot). Add launcher parts here. */
  turret: THREE.Group;
  mats: { dark: THREE.Material; alu: THREE.Material; bumper: THREE.Material };
  /** +1 / -1: chassis face of the floor intake and of the station intake. */
  groundSide: 1 | -1;
  stationSide: 1 | -1;
}

export interface RobotModel {
  replaces: ModelPart[];
  update(s: RobotAnimState): void;
  /** Where the robot's held game piece is drawn (seasons parent their held-piece mesh here). */
  heldAnchor?: THREE.Object3D;
  /** Tube axis in the held anchor's local frame, measured from the actual tool. */
  coralAxis?: [number,number,number];
  /** Actual moving cage-contact point for the seasonal climbing visual. */
  climbAnchor?: THREE.Object3D;
  /** Separate ALGAE holder when it is mounted on the opposite end of a shared arm. */
  algaeAnchor?: THREE.Object3D;
  /** Visual ALGAE compression in the local axes of its holder. */
  algaeGripScale?: [number, number, number];
  /** A round ball with localized compression at the claw throat. */
  algaeGripThroat?: boolean;
  /** Where a piece rides on the ground intake (its roller), so seasons can animate the handoff to `heldAnchor`. */
  intakeAnchor?: THREE.Object3D;
  /** A folding intake carries CORAL until the rollers meet the receiving tool. */
  handoffStyle?: 'fold' | 'conveyor' | 'direct' | 'toss';
  /** Status light position (robot frame), on top of the model's structure. */
  lightAt?: [number, number, number];
  /**
   * Game-piece flow through this robot (see pieceFlow.ts), as points in the robot frame. `intake` runs from just
   * inside the intake mouth to the stow point (omit the stow point: `stow` or the held anchor / hopper is appended);
   * `feed` runs from the stow point up into the shooter. Anything omitted uses the generic path.
   */
  flow?: {
    intake?(): THREE.Vector3[];
    stow?(): THREE.Vector3;
    feed?(shotIndex?: number): THREE.Vector3[];
    /** Floor CORAL transfer: intake → conveyor/cradle → end effector, re-read as mechanisms move. */
    handoff?(): THREE.Vector3[];
  };
}

export type RobotModelBuilder = (kit: ModelKit) => RobotModel;

const REGISTRY = new Map<string, RobotModelBuilder>();

export function registerRobotModel(id: string, build: RobotModelBuilder): void {
  REGISTRY.set(id, build);
}

export function robotModelBuilder(id: string | undefined): RobotModelBuilder | undefined {
  return cadRobotModelBuilder(id) ?? (id ? REGISTRY.get(id) : undefined);
}

export function hasRobotModel(id: string): boolean {
  return REGISTRY.has(id);
}

// ───────────────────────── shared parts ─────────────────────────

/** Studio environment map for model materials (set by the renderer; absent headless). */
let ENV: THREE.Texture | null = null;
export function setRobotEnvironment(t: THREE.Texture | null): void {
  ENV = t;
}
export function getRobotEnvironment(): THREE.Texture | null { return ENV; }

export function mat(color: number, o: { metal?: number; rough?: number; opacity?: number; emissive?: number } = {}): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color,
    // With the studio environment, metals reflect it; without one (headless) very metallic surfaces would go black.
    // Dark parts (black anodizing, plastic, rubber) stay matte so they don't mirror the studio as silver.
    metalness: new THREE.Color(color).getHSL({ h: 0, s: 0, l: 0 }).l < 0.18 ? Math.min(o.metal ?? 0.3, 0.12) : ENV ? (o.metal ?? 0.3) : Math.min(o.metal ?? 0.3, 0.45),
    roughness: o.rough ?? 0.55,
    envMap: ENV,
    envMapIntensity: 0.9,
    transparent: o.opacity !== undefined,
    opacity: o.opacity ?? 1,
    depthWrite: o.opacity === undefined,
    side: o.opacity !== undefined ? THREE.DoubleSide : THREE.FrontSide,
    emissive: o.emissive ?? 0x000000,
    emissiveIntensity: o.emissive ? 0.35 : 0,
  });
}

/** Box at (x, y, z) in `parent`. */
export function box(parent: THREE.Object3D, sx: number, sy: number, sz: number, m: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), m);
  mesh.position.set(x, y, z);
  parent.add(mesh);
  return mesh;
}

/**
 * Roller / flywheel whose axis runs across the robot (local z). Spin it with `spin(roller, rad/s, dt)`. Rollers
 * get a contrasting stripe so the rotation is visible.
 */
export function roller(parent: THREE.Object3D, radius: number, length: number, m: THREE.Material, x = 0, y = 0, z = 0): THREE.Group {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  g.userData.flowSpinAxis = 'z';
  g.userData.fuelDrivenSurface = true;
  const drum = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, length, 20), m);
  drum.rotation.x = Math.PI / 2;
  g.add(drum);
  // Aluminum hubs, axle and radial spokes distinguish wheels from featureless cylinders.
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, length + 0.025, 8), HUB);
  shaft.rotation.x = Math.PI / 2; g.add(shaft);
  for (const sign of [-1, 1]) {
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.33, radius * 0.33, 0.005, 12), HUB);
    hub.rotation.x = Math.PI / 2; hub.position.z = sign * (length / 2 + 0.003); g.add(hub);
    for (let i = 0; i < 3; i++) {
      const spoke = box(g, radius * 1.3, radius * 0.08, 0.003, HUB, 0, 0, sign * (length / 2 + 0.006));
      spoke.rotation.z = i * Math.PI / 3;
    }
  }
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(radius * 0.5, radius * 0.25, length * 1.01), STRIPE);
  stripe.position.y = radius * 0.92;
  g.add(stripe);
  parent.add(g);
  return g;
}
const STRIPE = new THREE.MeshStandardMaterial({ color: 0x15171a, roughness: 0.8 });

export function spin(o: THREE.Object3D, rate: number, dt: number, axis: 'x' | 'y' | 'z' = 'z'): void {
  o.rotation[axis] = (o.rotation[axis] + rate * dt) % (Math.PI * 2);
}

/** Exponential approach of `cur` toward `target` at `rate` (1/s). */
export function approach(cur: number, target: number, rate: number, dt: number): number {
  return target + (cur - target) * Math.exp(-rate * dt);
}

/** A pivot group at (x, y, z): rotate `.rotation.z` to swing parts in the robot's forward/up plane. */
export function pivot(parent: THREE.Object3D, x: number, y: number, z = 0): THREE.Group {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  parent.add(g);
  return g;
}

/**
 * Nested elevator stages (each slightly narrower) that telescope with `set(extension)`: stage k rises k/n of the
 * extension, like a continuous-rigged elevator. Base sits on the chassis at height `y0`.
 */
export function elevator(parent: THREE.Object3D, o: { x: number; y0: number; height: number; width: number; stages: number; m: THREE.Material }): { set(ext: number): void; stages: THREE.Group[] } {
  const stages: THREE.Group[] = [];
  for (let k = 0; k < o.stages; k++) {
    const g = new THREE.Group();
    g.position.set(o.x - k * 0.012, o.y0, 0);
    const w = o.width - k * 0.04;
    for (const sz of [-1, 1]) box(g, 0.03, o.height, 0.03, o.m, 0, o.height / 2, (sz * w) / 2);
    box(g, 0.03, 0.03, w, o.m, 0, o.height - 0.015, 0);
    if (k === 0) box(g, 0.03, 0.03, w, o.m, 0, 0.015, 0);
    parent.add(g);
    stages.push(g);
  }
  return {
    stages,
    set(ext: number) {
      for (let k = 1; k < stages.length; k++) stages[k].position.y = o.y0 + (ext * k) / (stages.length - 1);
    },
  };
}

/** Continuous curved hood plate over a flywheel, opening toward +x. */
export function hoodShell(parent: THREE.Object3D, radius: number, width: number, m: THREE.Material, n = 16): THREE.Group {
  const g = new THREE.Group();
  // A continuous bent sheet, rather than disconnected rectangular tiles.
  const outer = radius * 1.25;
  const inner = outer - 0.008;
  const shape = new THREE.Shape();
  const start = Math.PI * 0.25;
  const end = Math.PI * 0.95;
  shape.absarc(radius * 0.4, 0, outer, start, end, false);
  shape.lineTo(radius * 0.4 + Math.cos(end) * inner, Math.sin(end) * inner);
  shape.absarc(radius * 0.4, 0, inner, end, start, true);
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, { depth: width, bevelEnabled: false, curveSegments: n });
  geo.translate(0, 0, -width / 2);
  g.add(new THREE.Mesh(geo, m));
  parent.add(g);
  return g;
}

/** Translucent box hopper walls (open top), centered at (x, y0 + h/2). */
export function hopperWalls(parent: THREE.Object3D, o: { x: number; y0: number; length: number; width: number; height: number; m: THREE.Material; frame?: THREE.Material; intakeSide?: number; floorDepth?: number }): THREE.Group {
  const g = new THREE.Group();
  g.position.set(o.x, o.y0, 0);
  g.name = 'hopper-walls';
  g.userData.fuelStructure = true;
  const t = 0.008;
  box(g, o.length, o.height, t, o.m, 0, o.height / 2, o.width / 2);
  box(g, o.length, o.height, t, o.m, 0, o.height / 2, -o.width / 2);
  for (const side of [-1, 1]) {
    if (side === o.intakeSide) {
      // Open intake mouth, bounded by the side cheek plates. A solid sheet here would block pickup.
      for (const z of [-1, 1]) box(g, t, o.height, o.width * .08, o.m, side * o.length / 2, o.height / 2, z * o.width * .46);
    } else box(g, t, o.height, o.width, o.m, side * o.length / 2, o.height / 2, 0);
  }
  // Floor and edge caps make the enclosure read as a finished hopper from above.
  const frame = o.frame ?? DARK_METAL;
  box(g, o.length, 0.008, o.width, frame, 0, 0.004 - (o.floorDepth ?? 0), 0);
  for (const sz of [-1, 1]) box(g, o.length, 0.018, 0.018, frame, 0, o.height, sz * o.width / 2);
  for (const sx of [-1, 1]) box(g, 0.018, 0.018, o.width, frame, sx * o.length / 2, o.height, 0);
  if (o.frame) for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(g, 0.022, o.height, 0.022, o.frame, (sx * o.length) / 2, o.height / 2, (sz * o.width) / 2);
  parent.add(g);
  return g;
}

/** Small deterministic PRNG (mulberry32) so a robot's random-looking details are the same every frame and session. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Height of a hopper floor above the carpet (m): chassis rails + belly pan. */
const HOPPER_FLOOR = 0.09;

/**
 * Round FUEL inside the hopper, filled from the floor up with `set(fill)` (0–1).
 * Instancing keeps one draw call per bin. A sleeping visual particle solver lets gravity, ball contacts and chassis
 * impacts form the pile; initial packing is only a starting pose, never a fixed resting target. Intake tokens hand
 * their exact endpoint to the new particle so it rolls into the pile without a second spawn.
 */
export function fillBlock(parent: THREE.Object3D, bin: { x: number; y0: number; length: number; width: number; height: number; color: number; capacity?: number; exactFloor?: boolean; inside?: (x: number, z: number) => boolean; ceiling?: (x: number, z: number) => number }): { set(f: number): void } {
  // A real hopper floor rides just above the chassis tubing, not up at bumper-top height: lower the bin to it (same roof) so
  // the FUEL fills the room under the old floor instead of leaving a dead gap above the frame.
  const drop = bin.exactFloor ? 0 : Math.max(0, Math.min(bin.y0 - HOPPER_FLOOR, 0.12));
  const o = { ...bin, y0: bin.y0 - drop, height: bin.height + drop };
  type Slot = { x: number; y: number; z: number; s: number; key: number; sy?: number };
  const rand = seededRandom(Math.round(o.length * 1e4) * 31 + Math.round(o.width * 1e4) * 17 + Math.round(o.height * 1e4));
  // Pour `n` balls of radius r into the bin the way they really settle: foam FUEL rolls off whatever it lands on and
  // comes to rest in the lowest pocket nearby, so the heap fills the whole floor before it builds up, with every ball
  // nested against its neighbors (no gaps) and an uneven, lumpy top. `inside` (robot-frame x/z) trims the footprint
  // for a non-rectangular hopper.
  const pour = (r: number, n: number, k = 1.92): Slot[] => {
    const halfX = Math.max(0, o.length / 2 - r), halfZ = Math.max(0, o.width / 2 - r);
    const reach2 = (r * k) ** 2; // foam FUEL squashes a little where it touches (k = 2 would be rigid spheres)
    const out: Slot[] = [];
    const restHeight = (px: number, pz: number): number => {
      let py = r;
      for (const q of out) {
        const dx = q.x - (o.x + px), dz = q.z - pz, d2 = dx * dx + dz * dz;
        if (d2 < reach2) py = Math.max(py, q.y - o.y0 + Math.sqrt(reach2 - d2));
      }
      return py;
    };
    // Candidate pockets sit on a fine jittered grid (not a handful of random spots) so each ball really finds the lowest
    // nook beside its neighbors and the heap packs close to a real random pile instead of leaving air gaps.
    const step = r * 0.55, nx = Math.max(1, Math.floor(2 * halfX / step)), nz = Math.max(1, Math.floor(2 * halfZ / step));
    for (let i = 0; i < n; i++) {
      let bx = 0, bz = 0, by = Infinity, bk = Infinity;
      for (let a = 0; a <= nx; a++) for (let b = 0; b <= nz; b++) {
        const px = nx ? -halfX + 2 * halfX * a / nx + (rand() - 0.5) * step * 0.3 : 0;
        const pz = nz ? -halfZ + 2 * halfZ * b / nz + (rand() - 0.5) * step * 0.3 : 0;
        if (Math.abs(px) > halfX || Math.abs(pz) > halfZ) continue;
        if (o.inside && !o.inside(o.x + px, pz)) continue;
        const py = restHeight(px, pz), key = py + rand() * r * 0.06;
        const ceiling = Math.min(o.y0 + o.height, o.ceiling?.(o.x + px,pz) ?? Infinity);
        if (o.y0 + py + r * .95 * k / 1.92 > ceiling) continue;
        if (key < bk) { bk = key; by = py; bx = px; bz = pz; }
      }
      if (by === Infinity) break; // Try another pocket before giving up, never fill then discard an entire upper layer.
      out.push({ x: o.x + bx, y: o.y0 + by, z: bz, s: 0.97 + rand() * 0.05, key: by + rand() * r * 0.4, sy: Math.min(1, 0.95 * k / 1.92) });
    }
    return out;
  };
  const top = (sl: Slot[], r: number) => sl.reduce((m, q) => Math.max(m, q.y - o.y0 + r), 0);
  // A greedy random pour can strand pockets even when the requested load fits. Try a close-packed starting
  // arrangement before silently dropping balls. It is only an initial pose; the sleeping solver still settles it.
  const closePack = (r:number, n:number, k:number): Slot[] => {
    let best:Slot[]=[];
    const gap=r*k, row=gap*Math.sqrt(3)/2, layer=gap*Math.sqrt(2/3), sy=.95*k/1.92;
    for(const swapped of [false,true]) for(const phase of [0,.5]) {
      const out:Slot[]=[];
      const spanX=(swapped?o.width:o.length)-2*r, spanZ=(swapped?o.length:o.width)-2*r;
      for(let h=0;h<Math.ceil(o.height/layer);h++) for(let b=0;b<=Math.floor(spanZ/row);b++) {
        const dz=-spanZ/2+b*row+(h%2)*row/3;
        for(let a=0;a<=Math.floor(spanX/gap);a++) {
          const dx=-spanX/2+(a+((b+h)%2)*.5+phase)*gap;
          if(dx>spanX/2 || dz>spanZ/2)continue;
          const x=o.x+(swapped?dz:dx),z=swapped?dx:dz,y=o.y0+r*sy+h*layer;
          if(o.inside&&!o.inside(x,z))continue;
          if(y+r*sy>Math.min(o.y0+o.height,o.ceiling?.(x,z)??Infinity))continue;
          out.push({x,y,z,s:1,sy,key:y-o.y0});
        }
      }
      if(out.length>best.length)best=out.slice(0,n);
    }
    return best;
  };
  // Balls are always real FUEL size (r = 0.075 m), the same as outside the robot. A hopper too small for `capacity`
  // balls packs them tighter instead (foam compresses a little, down to k = 1.7) rather than shrinking the balls.
  const r = o.capacity ? 0.075 : Math.min(0.06, o.length / 6, o.width / 6);
  let slots: Slot[];
  if (o.capacity) {
    let k = 1.92;
    slots = pour(r, o.capacity, k);
    while ((slots.length < o.capacity || top(slots, r) > o.height) && k > 1.7) { k -= 0.02; slots = pour(r, o.capacity, k); }
    if(slots.length<o.capacity) {
      const packed=closePack(r,o.capacity,k);
      if(packed.length>slots.length)slots=packed;
    }
    // Still too tall: the bin holds fewer real-size balls than `capacity`, so show it full of those (never poking out).
    slots = slots.filter((q) => q.y - o.y0 + r * q.s * (q.sy ?? .94) <= o.height);
  } else {
    slots = pour(r, Math.floor(o.length / (r * 2)) * Math.floor(o.width / (r * 2)) * Math.max(1, Math.floor((o.height - r * 0.25) / (r * 1.75))));
  }
  if (o.ceiling) slots = slots.filter(q => q.y + r * q.s * (q.sy ?? .94) <= o.ceiling!(q.x,q.z));
  slots.sort((a, b) => a.key - b.key);
  const count = slots.length;
  // One spare particle lets an uncovered hopper attempt pickup at the brim. It is not stored capacity.
  slots.push({ x: o.x, y: o.y0 + o.height + r, z: 0, s: 1, key: Infinity, sy: .94 });
  const mesh = new THREE.InstancedMesh(new THREE.SphereGeometry(r, 12, 8), mat(o.color, { rough: 0.85, metal: 0 }), count + 1);
  mesh.name = 'hopper-fuel-pile';
  mesh.userData.fuelBin = { x: o.x, y0: o.y0, length: o.length, width: o.width, height: o.height };
  mesh.userData.fuelSlots = count; // how many real-size FUEL this bin physically holds
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  const transform = new THREE.Object3D(), tint = new THREE.Color(o.color);
  // Subtle foam color variation gives the pile depth without textures or extra draw calls.
  for (let i = 0; i <= count; i++) mesh.setColorAt(i, tint.clone().multiplyScalar(0.9 + rand() * 0.1));
  const pile = new FuelPile(o, slots, r);
  mesh.userData.bindFuelContacts = (visual?: THREE.Object3D, importedOnly = false) => { pile.contacts = visual ? new FuelContacts(visual, mesh, false, importedOnly) : undefined; };
  mesh.userData.resizeFuelBin = (bounds: { x: number; length: number; height: number }) => {
    if (Math.abs(o.x - bounds.x) + Math.abs(o.length - bounds.length) + Math.abs(o.height - bounds.height) < 1e-5) return;
    Object.assign(o, bounds);
    Object.assign(mesh.userData.fuelBin, bounds);
    mesh.boundingSphere!.center.set(o.x, o.y0 + o.height / 2, 0);
    mesh.boundingSphere!.radius = Math.hypot(o.length, o.width, o.height) / 2 + r;
    pile.wake();
  };
  const place = (i: number) => {
    const b = slots[i], j = i * 3, p = pile.positions;
    transform.position.set(p[j], p[j + 1], p[j + 2]);
    transform.rotation.set(0, i * 2.39996, 0);
    transform.scale.set(b.s, b.s * (b.sy ?? 0.94), b.s);
    transform.updateMatrix();
    mesh.setMatrixAt(i, transform.matrix);
  };
  for (let i = 0; i < count; i++) place(i);
  mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(o.x, o.y0 + o.height / 2, 0), Math.hypot(o.length, o.width, o.height) / 2 + r);
  mesh.count = 0;
  parent.add(mesh);
  mesh.userData.setFuelOpen = (open: boolean) => { pile.open = open; };
  mesh.userData.fuelEntry = (hint: THREE.Vector3) => pile.entry(hint);
  mesh.userData.receiveFuel = (position: THREE.Vector3) => pile.receive(position);
  mesh.userData.animateFuel = (s: RobotAnimState) => {
    const moved = pile.step(s, (x, y, z, vx, vy, vz) => mesh.userData.fuelEscape?.(mesh, x, y, z, vx, vy, vz));
    if (pile.size !== mesh.count) mesh.count = pile.size; // balls that went over the rim
    if (!moved) return;
    for (let i = 0; i < mesh.count; i++) place(i);
    mesh.instanceMatrix.needsUpdate = true;
  };
  const setCount = (want: number) => {
      if (want !== mesh.count) {
        pile.setCount(want);
        mesh.count = want;
        for (let i = 0; i < want; i++) place(i);
        mesh.instanceMatrix.needsUpdate = true;
      }
      mesh.visible = want > 0;
  };
  mesh.userData.setFuelCount = (n: number) => setCount(Math.min(count + (pile.open ? 1 : 0), Math.max(0, n)));
  mesh.userData.fuelSurface = () => ({positions: pile.positions, count: pile.size, radius: r});
  return { set(f) {
    mesh.userData.fuelRequestedFill = f;
    const n = Math.min(count, Math.round(THREE.MathUtils.clamp(f, 0, 1) * count));
    if (!mesh.userData.fuelManagedCount) setCount(pile.open && n === count && mesh.count > count ? mesh.count : n);
  } };
}

/**
 * Two telescoping climber tubes at x: a fixed outer sleeve bolted to the frame and an inner tube with a hook that
 * slides out with `set(climb)` (RobotAnimState.climb).
 */
export function climberHooks(parent: THREE.Object3D, o: { x: number; y0: number; length: number; spread: number; m: THREE.Material; hook: THREE.Material }): { set(c: number): void } {
  const tubes: THREE.Group[] = [];
  for (const sz of [-1, 1]) {
    const z = (sz * o.spread) / 2;
    box(parent, 0.04, o.length, 0.04, o.m, o.x, o.y0 + o.length / 2, z);
    box(parent, 0.06, 0.05, 0.06, DARK_METAL, o.x, o.y0 + 0.025, z); // gearbox / winch at the base
    const g = new THREE.Group();
    g.position.set(o.x, o.y0, z);
    box(g, 0.028, o.length, 0.028, o.m, 0, o.length / 2 + 0.01, 0);
    box(g, 0.07, 0.022, 0.03, o.hook, 0.025, o.length + 0.01, 0);
    box(g, 0.022, 0.05, 0.03, o.hook, 0.055, o.length - 0.01, 0);
    parent.add(g);
    tubes.push(g);
  }
  return {
    set(c: number) {
      for (const g of tubes) g.position.y = o.y0 + c * o.length * 0.85;
    },
  };
}
const DARK_METAL = new THREE.MeshStandardMaterial({ color: 0x2b2f36, metalness: 0.5, roughness: 0.5 });

/**
 * Flat plate cut from an outline (robot-frame x/y points, extruded `t` along z, centered on `z`) with optional round
 * lightening holes — the pocketed aluminum / polycarbonate side plates real robots are built from.
 */
export function plate(parent: THREE.Object3D, pts: [number, number][], t: number, m: THREE.Material, z = 0, holes: [number, number, number][] = []): THREE.Mesh {
  const shape = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));
  for (const [hx, hy, r] of holes) {
    const h = new THREE.Path();
    h.absarc(hx, hy, r, 0, Math.PI * 2, true);
    shape.holes.push(h);
  }
  const geo = new THREE.ExtrudeGeometry(shape, { depth: t, bevelEnabled: false, curveSegments: 10 });
  geo.translate(0, 0, -t / 2);
  const mesh = new THREE.Mesh(geo, m);
  mesh.position.z = z;
  parent.add(mesh);
  return mesh;
}

/** Pair of mirrored side plates at ±z (see `plate`). */
export function sidePlates(parent: THREE.Object3D, pts: [number, number][], halfGap: number, m: THREE.Material, holes: [number, number, number][] = [], t = 0.006): void {
  for (const sz of [-1, 1]) {
    plate(parent, pts, t, m, sz * halfGap, holes);
    const bolts = new THREE.InstancedMesh(new THREE.CylinderGeometry(.0035,.0035,.004,6),HUB,pts.length);
    const center = pts.reduce((a,p)=>[a[0]+p[0]/pts.length,a[1]+p[1]/pts.length],[0,0]);
    const d = new THREE.Object3D(); d.rotation.x = Math.PI/2;
    pts.forEach(([x,y],i)=> {
      const dx=center[0]-x, dy=center[1]-y, length=Math.hypot(dx,dy);
      d.position.set(x+dx/length*.012,y+dy/length*.012,sz*(halfGap+t/2+.002));
      d.updateMatrix(); bolts.setMatrixAt(i,d.matrix);
    });
    parent.add(bolts);
  }
}

/** Vertical post / standoff from y0 to y1. */
export function post(parent: THREE.Object3D, x: number, z: number, y0: number, y1: number, m: THREE.Material, w = 0.025): THREE.Mesh {
  return box(parent, w, Math.max(0.001, y1 - y0), w, m, x, (y0 + y1) / 2, z);
}

const WHEEL = new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.95 });
const HUB = new THREE.MeshStandardMaterial({ color: 0x8d949e, metalness: 0.7, roughness: 0.35 });
const MOTOR = new THREE.MeshStandardMaterial({ color: 0x1b1d21, metalness: 0.4, roughness: 0.45 });

/**
 * Detailed drivebase replacing the generic chassis ('chassis' part): perimeter box tubing, cross rails, bellypan,
 * four swerve modules (wheel + steering housing + two motors) that steer and roll with the robot's real motion.
 * Returns an updater for the modules.
 */
export function drivebase(kit: ModelKit, o: { tube?: THREE.Material; motorRing?: number; crossRails?: number[]; outline?: [number, number][]; modulePositions?: [number, number][] } = {}): { update(s: RobotAnimState): void; deckY: number } {
  const c = kit.config;
  const tube = o.tube ?? kit.mats.alu;
  const L = c.frameLength;
  const W = c.frameWidth;
  const y = c.bumperBottom + 0.03; // tube centerline (2 in tall tubing inside the bumpers)
  const th = 0.05;
  const tw = 0.025;
  // Match nonrectangular team's actual outline instead of leaving square corners outside its bumpers.
  if (o.outline) {
    const shape = new THREE.Shape(o.outline.map(([x, z]) => new THREE.Vector2(x, -z)));
    const pan = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: 0.008, bevelEnabled: false }), mat(0x30343b));
    pan.rotation.x = -Math.PI / 2;
    pan.position.y = y - th / 2;
    kit.visual.add(pan);
    o.outline.forEach(([x, z], i) => {
      const next = o.outline![(i + 1) % o.outline!.length];
      bar(kit.visual, [x, y, z], [next[0], y, next[1]], 0.035, tube);
    });
  } else {
    box(kit.visual, L, th, tw, tube, 0, y, W / 2 - tw / 2);
    box(kit.visual, L, th, tw, tube, 0, y, -W / 2 + tw / 2);
    box(kit.visual, tw, th, W - 2 * tw, tube, L / 2 - tw / 2, y, 0);
    box(kit.visual, tw, th, W - 2 * tw, tube, -L / 2 + tw / 2, y, 0);
    for (const x of o.crossRails ?? [L * 0.18, -L * 0.18]) box(kit.visual, tw, th, W - 2 * tw, tube, x, y, 0);
    box(kit.visual, L - 0.03, 0.004, W - 0.03, mat(0x30343b, { metal: 0.5, rough: 0.6 }), 0, y - th / 2 - 0.002, 0);
    // Bumper backing supports the upper mechanisms all the way down to the drivetrain.
    for (const sz of [-1, 1]) box(kit.visual, L - 0.04, Math.max(0.025, c.bumperTop - y), 0.022, tube, 0, (y + c.bumperTop) / 2, sz * (W / 2 - 0.025));
  }
  // Swerve modules in the corners.
  const ring = mat(o.motorRing ?? 0xcfd3d8, { metal: 0.6 });
  const modules: { steer: THREE.Group; wheel: THREE.Group; x: number; z: number }[] = [];
  const inset = 0.075;
  const positions = o.modulePositions ?? [-1, 1].flatMap(sx => [-1, 1].map(sz => [sx * (L / 2 - inset), sz * (W / 2 - inset)] as [number, number]));
  for (const [x, z] of positions) {
    box(kit.visual, 0.12, 0.008, 0.12, kit.mats.alu, x, y + th / 2 + 0.004, z); // module top plate
    for (const [mx, mz] of [[0.025, 0.025], [-0.025, -0.025]] as const) {
      const motor = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.065, 14), MOTOR);
      motor.position.set(x + mx, y + th / 2 + 0.04, z + mz);
      kit.visual.add(motor);
      const band = new THREE.Mesh(new THREE.CylinderGeometry(0.031, 0.031, 0.008, 14), ring);
      band.position.set(x + mx, y + th / 2 + 0.06, z + mz);
      kit.visual.add(band);
    }
    const steer = new THREE.Group();
    steer.position.set(x, 0.05, z);
    box(steer, 0.025, 0.07, 0.07, kit.mats.alu, 0, 0.03, 0.03); // fork
    const wheel = new THREE.Group();
    const tire = new THREE.Mesh(new THREE.CylinderGeometry(0.048, 0.048, 0.035, 18), WHEEL);
    tire.rotation.x = Math.PI / 2;
    wheel.add(tire);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.037, 10), HUB);
    hub.rotation.x = Math.PI / 2;
    wheel.add(hub);
    const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.012, 0.038), HUB);
    wheel.add(spoke);
    steer.add(wheel);
    kit.visual.add(steer);
    modules.push({ steer, wheel, x, z });
  }
  let roll = 0;
  return {
    deckY: y + th / 2,
    update(s) {
      roll += (Math.hypot(s.vx, s.vz) / 0.048) * s.dt;
      for (const m of modules) {
        // Module velocity = chassis velocity + ω × r (ω about +y, r = (x, 0, z)).
        const mvx = s.vx + s.omega * m.z;
        const mvz = s.vz - s.omega * m.x;
        const sp = Math.hypot(mvx, mvz);
        if (sp > 0.05) {
          let ang = Math.atan2(-mvz, mvx);
          // Swerve modules flip the drive direction instead of turning past 90°.
          const cur = m.steer.rotation.y;
          while (ang - cur > Math.PI / 2) ang -= Math.PI;
          while (ang - cur < -Math.PI / 2) ang += Math.PI;
          m.steer.rotation.y = approach(cur, ang, 18, s.dt);
        }
        m.wheel.rotation.z = roll; // axle remains across the steering fork
      }
    },
  };
}

/** Intake orange (reserved for intakes so they read at a glance; matches Robot.buildGroundIntake). */
export const INTAKE_ORANGE = (): THREE.MeshStandardMaterial => mat(0xff7a1a, { rough: 0.55, metal: 0.1, emissive: 0xff5a00 });

/**
 * Under-bumper intake: `n` orange rollers across the intake face just outside the bumper (where
 * `groundMouthContains` captures). They spin while the driver intakes.
 */
export function underBumperIntake(kit: ModelKit, o: { n?: number; width?: number } = {}): { update(s: RobotAnimState): void } {
  const c = kit.config;
  const side = kit.groundSide;
  const w = Math.min(o.width ?? c.intake.width, kit.fp.width - 0.04);
  const orange = INTAKE_ORANGE();
  const edge = kit.fp.length / 2;
  const rollers: THREE.Group[] = [];
  const n = o.n ?? 2;
  for (let i = 0; i < n; i++) rollers.push(roller(kit.visual, 0.028, w, orange, side * (edge + 0.03 - i * 0.045), 0.07 + i * 0.045, 0));
  for (const sz of [-1, 1]) box(kit.visual, 0.1, 0.06, 0.012, kit.mats.dark, side * (edge - 0.01), 0.09, sz * (w / 2 + 0.008));
  let speed = 0;
  return {
    update(s) {
      speed = approach(speed, s.intaking && s.enabled ? 28 : 0, 8, s.dt);
      for (const r of rollers) spin(r, -side * speed, s.dt);
    },
  };
}

/**
 * Over-the-bumper intake on a hinge at the top of the intake face: stowed upright inside the frame perimeter,
 * swings out and down over the bumper to the carpet when `set(deploy)` reaches 1. An orange roller bar at the tip
 * spins while intaking. `reach` = how far past the frame the roller lands.
 */
/** Ground intake deploy target: out while the driver intakes, folding back in (carrying the piece) during a handoff. */
export function intakeDeployTarget(s: RobotAnimState): number {
  return s.intaking && s.enabled && !(s.place?.handoff ?? 0) ? 1 : 0;
}

export function deployableIntake(kit: ModelKit, o: { reach: number; hingeY?: number; width?: number; rollers?: number; frame?: THREE.Material; stow?: number; rollerMaterial?: THREE.Material }): { update(s: RobotAnimState, deploy: number): void; hinge: THREE.Group; tip: THREE.Group } {
  const c = kit.config;
  const side = kit.groundSide;
  const hingeY = o.hingeY ?? c.bumperTop + 0.06;
  const halfFrame = c.frameLength / 2;
  const hinge = pivot(kit.visual, side * (halfFrame + 0.01), hingeY);
  const w = Math.min(o.width ?? c.intake.width, kit.fp.width - 0.06);
  // Arm length from hinge to roller when deployed (roller sits ~4 cm above the carpet).
  const dx = o.reach + 0.03;
  const dy = hingeY - 0.05;
  const len = Math.hypot(dx, dy);
  const down = Math.atan2(dy, dx); // angle below horizontal when deployed
  for (const sz of [-1, 1]) bar(kit.visual, [side * (halfFrame - 0.04), c.bumperTop - 0.02, sz * (w / 2 + 0.012)], [side * (halfFrame + 0.01), hingeY, sz * (w / 2 + 0.012)], 0.035, o.frame ?? kit.mats.alu);
  const arms = new THREE.Group();
  hinge.add(arms);
  const frameM = o.frame ?? kit.mats.alu;
  for (const sz of [-1, 1]) box(arms, len, 0.035, 0.02, frameM, (side * len) / 2, 0, sz * (w / 2 + 0.012));
  const orange = o.rollerMaterial ?? INTAKE_ORANGE();
  const rollers: THREE.Group[] = [];
  const nr = o.rollers ?? 2;
  for (let i = 0; i < nr; i++) rollers.push(roller(arms, 0.03, w, orange, side * (len - i * 0.075), 0, 0));
  // A captured piece rides just inboard of the rollers.
  const tip = pivot(arms, side * (len - 0.06), 0.05);
  sidePlates(arms, [[side * (len - nr * 0.075), -0.035], [side * (len + 0.04), -0.035], [side * (len + 0.04), 0.035], [side * (len - nr * 0.075), 0.035]], w / 2 + 0.012, frameM);
  box(arms, 0.012, 0.012, w, frameM, side * (len * 0.5), 0.02, 0);
  let speed = 0;
  return {
    hinge,
    tip,
    update(s, deploy) {
      // Stowed: arms point straight up (angle +90° from the intake face); deployed: `down` below horizontal.
      // Default stow: upright against the frame; `stow` > 90° folds it back in over the robot.
      const stowed = o.stow ?? Math.PI / 2;
      const ang = stowed + (-down - stowed) * deploy;
      arms.rotation.z = side * ang;
      speed = approach(speed, s.intaking && s.enabled && deploy > 0.8 ? 26 : 0, 8, s.dt);
      for (const r of rollers) spin(r, -side * speed, s.dt);
    },
  };
}

/** Parallel-link floor intake: both links pivot, while the roller bank stays level. */
export function fourBarIntake(kit: ModelKit, o: { reach: number; frame: THREE.Material; rollerMaterial: THREE.Material; stow?: number }): ReturnType<typeof deployableIntake> {
  const c = kit.config, side = kit.groundSide, w = Math.min(c.intake.width, kit.fp.width - .06);
  const y = c.bumperTop + .15, spacing = .085;
  const hinge = pivot(kit.visual, side * (c.frameLength / 2 - .02), y);
  const dx = o.reach + .09, dy = y - .11, len = Math.hypot(dx, dy);
  const links = [pivot(hinge, 0, 0), pivot(hinge, 0, -spacing)];
  for (let i = 0; i < links.length; i++) {
    links[i].name = `four-bar-link-${i}`;
    for (const sign of [-1,1]) {
      bar(links[i], [0,0,sign*w/2], [side*len,0,sign*w/2], .018, o.frame);
      bar(kit.visual, [side*(c.frameLength/2-.07),c.bumperTop,sign*w/2],
        [hinge.position.x,y-i*spacing,sign*w/2], .025, o.frame);
    }
  }
  const bank = pivot(links[0], side * len, 0);
  bank.name = 'four-bar-roller-bank';
  sidePlates(bank, [[-.09,-spacing],[.07,-spacing],[.07,.04],[-.09,.04]], w/2, o.frame);
  const rolls = [roller(bank,.035,w*.92,o.rollerMaterial,side*.02,-.035),
    roller(bank,.025,w*.92,o.rollerMaterial,-side*.06,.005)];
  const tip = pivot(bank, -side*.015, .02);
  let speed = 0;
  return { hinge, tip, update(s, deploy) {
    const angle = side * ((o.stow ?? Math.PI*.92) * (1-deploy) - Math.atan2(dy,dx)*deploy);
    for (const link of links) link.rotation.z = angle;
    bank.rotation.z = -angle;
    speed = approach(speed, s.enabled && (s.intaking || s.firing > 0) && deploy > .8 ? 26 : 0, 8, s.dt);
    for (const r of rolls) spin(r,-side*speed,s.dt);
  } };
}

/** Flat decal (sponsor logo / name plate) facing +z or −z: a text texture on a disc or rectangle. */
export function decal(parent: THREE.Object3D, text: string, o: { w: number; h: number; color?: string; background?: string; round?: boolean; x?: number; y?: number; z?: number; rotY?: number }): THREE.Mesh {
  const tex = makeTextTexture(text, { color: o.color ?? '#ffffff', background: o.background, width: 256, height: Math.round((256 * o.h) / o.w) });
  const geo = o.round ? new THREE.CircleGeometry(o.w / 2, 28) : new THREE.PlaneGeometry(o.w, o.h);
  const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: tex, transparent: !o.background, polygonOffset: true, polygonOffsetFactor: -2 }));
  m.position.set(o.x ?? 0, o.y ?? 0, o.z ?? 0);
  m.rotation.y = o.rotY ?? 0;
  m.userData.noShadow = true;
  parent.add(m);
  return m;
}

/** Round tube between two points (robot frame). */
export function tube(parent: THREE.Object3D, a: [number, number, number], b: [number, number, number], r: number, m: THREE.Material): THREE.Mesh {
  const va = new THREE.Vector3(...a);
  const vb = new THREE.Vector3(...b);
  const len = va.distanceTo(vb);
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 10), m);
  mesh.position.copy(va).add(vb).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), vb.sub(va).normalize());
  parent.add(mesh);
  return mesh;
}

/**
 * Round rod whose two ends are re-pinned every frame (gas struts, leadscrews, linkage bars between a fixed and a moving
 * part): `set(a, b)` with both points in `parent`'s frame, so the rod never floats off either mount.
 */
export function link(parent: THREE.Object3D, r: number, m: THREE.Material): { mesh: THREE.Mesh; set(a: THREE.Vector3, b: THREE.Vector3): void } {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 1, 10), m);
  parent.add(mesh);
  const up = new THREE.Vector3(0, 1, 0);
  const d = new THREE.Vector3();
  return {
    mesh,
    set(a, b) {
      d.subVectors(b, a);
      const len = Math.max(1e-4, d.length());
      mesh.position.copy(a).addScaledVector(d, 0.5);
      mesh.scale.set(1, len, 1);
      mesh.quaternion.setFromUnitVectors(up, d.divideScalar(len));
    },
  };
}

/** A point of `child` expressed in `parent`'s frame (for `link` ends on moving parts); `out` is reused. */
export function pointIn(parent: THREE.Object3D, child: THREE.Object3D, x: number, y: number, z: number, out = new THREE.Vector3()): THREE.Vector3 {
  child.updateWorldMatrix(true, false);
  parent.updateWorldMatrix(true, false);
  return parent.worldToLocal(child.localToWorld(out.set(x, y, z)));
}

/** Square box tube between two points (robot frame) — 1×1 / 2×1 aluminum tubing. */
export function bar(parent: THREE.Object3D, a: [number, number, number], b: [number, number, number], w: number, m: THREE.Material): THREE.Mesh {
  const va = new THREE.Vector3(...a);
  const vb = new THREE.Vector3(...b);
  const geo = new THREE.BoxGeometry(w, va.distanceTo(vb), w);
  tileBoxUVs(geo, w, va.distanceTo(vb), w);
  const mesh = new THREE.Mesh(geo, m);
  mesh.position.copy(va).add(vb).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), vb.sub(va).normalize());
  parent.add(mesh);
  return mesh;
}

/**
 * Truss / lattice panel (laser-cut X-pattern walls, triangulated tube frames): a border of bars around the
 * parallelogram origin → origin+u → origin+u+v → origin+v, split into `cells` along u, each crossed by an X (or a
 * single zig-zag diagonal with `zig`).
 */
export function lattice(parent: THREE.Object3D, origin: [number, number, number], u: [number, number, number], v: [number, number, number], o: { cells: number; w: number; m: THREE.Material; zig?: boolean; border?: boolean }): void {
  const at = (a: number, b: number): [number, number, number] => [origin[0] + u[0] * a + v[0] * b, origin[1] + u[1] * a + v[1] * b, origin[2] + u[2] * a + v[2] * b];
  if (o.border !== false) {
    bar(parent, at(0, 0), at(1, 0), o.w, o.m);
    bar(parent, at(0, 1), at(1, 1), o.w, o.m);
    bar(parent, at(0, 0), at(0, 1), o.w, o.m);
    bar(parent, at(1, 0), at(1, 1), o.w, o.m);
  }
  for (let i = 0; i < o.cells; i++) {
    const a0 = i / o.cells;
    const a1 = (i + 1) / o.cells;
    if (o.zig) bar(parent, at(a0, i % 2 ? 1 : 0), at(a1, i % 2 ? 0 : 1), o.w * 0.7, o.m);
    else {
      bar(parent, at(a0, 0), at(a1, 1), o.w * 0.7, o.m);
      bar(parent, at(a0, 1), at(a1, 0), o.w * 0.7, o.m);
      if (i > 0) bar(parent, at(a0, 0), at(a0, 1), o.w * 0.8, o.m);
    }
  }
}

/** Glowing LED strip (emissive, unlit-looking) between two points. */
export function ledStrip(parent: THREE.Object3D, a: [number, number, number], b: [number, number, number], color: number): THREE.Mesh {
  const m = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 1.6, roughness: 0.4 });
  const mesh = bar(parent, a, b, 0.012, m);
  mesh.userData.noShadow = true;
  return mesh;
}

/** Hole pitch of perforated tube / plate textures (½ in, like MAXTube and pre-drilled tubing). */
const HOLE_PITCH = 0.0127;

/** Rescale a BoxGeometry's UVs so a repeating texture tiles every HOLE_PITCH meters on every face. */
export function tileBoxUVs(geo: THREE.BoxGeometry, sx: number, sy: number, sz: number): void {
  const uv = geo.attributes.uv as THREE.BufferAttribute;
  // Face order: +x, −x (u=z, v=y), +y, −y (u=x, v=z), +z, −z (u=x, v=y); 4 vertices each.
  const dims: [number, number][] = [[sz, sy], [sz, sy], [sx, sz], [sx, sz], [sx, sy], [sx, sy]];
  for (let f = 0; f < 6; f++) {
    for (let i = 0; i < 4; i++) {
      const k = f * 4 + i;
      uv.setXY(k, (uv.getX(k) * dims[f][0]) / HOLE_PITCH, (uv.getY(k) * dims[f][1]) / HOLE_PITCH);
    }
  }
  uv.needsUpdate = true;
}

let HOLE_TEX: THREE.Texture | null = null;
/** Tiling texture: one dark hole per ½ in cell (white elsewhere, so the material color shows through). */
function holeTexture(): THREE.Texture | null {
  if (HEADLESS) return null;
  if (HOLE_TEX) return HOLE_TEX;
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const g = c.getContext('2d')!;
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, 32, 32);
  g.fillStyle = '#1a1a1a';
  g.beginPath();
  g.arc(16, 16, 5.5, 0, Math.PI * 2);
  g.fill();
  HOLE_TEX = new THREE.CanvasTexture(c);
  HOLE_TEX.wrapS = HOLE_TEX.wrapT = THREE.RepeatWrapping;
  HOLE_TEX.colorSpace = THREE.SRGBColorSpace;
  HOLE_TEX.anisotropy = 4;
  return HOLE_TEX;
}

/** Perforated aluminum tube material (pre-drilled hole pattern), for `bar()` frames. */
export function tubeMat(color: number, o: { metal?: number; rough?: number } = {}): THREE.MeshStandardMaterial {
  const m = mat(color, { metal: o.metal ?? 0.6, rough: o.rough ?? 0.38 });
  m.map = holeTexture();
  return m;
}

let LIGHT_HOLE_TEX: THREE.Texture | null = null;
/** Dark tube with light holes showing through (black powder-coated perforated tube). */
export function darkTubeMat(color: number): THREE.MeshStandardMaterial {
  const m = mat(0xffffff, { metal: 0.1, rough: 0.5 });
  if (!HEADLESS) {
    if (!LIGHT_HOLE_TEX) {
      const c = document.createElement('canvas');
      c.width = c.height = 32;
      const g = c.getContext('2d')!;
      g.fillStyle = '#' + new THREE.Color(color).getHexString();
      g.fillRect(0, 0, 32, 32);
      g.fillStyle = '#d8dadd';
      g.beginPath();
      g.arc(16, 16, 5, 0, Math.PI * 2);
      g.fill();
      LIGHT_HOLE_TEX = new THREE.CanvasTexture(c);
      LIGHT_HOLE_TEX.wrapS = LIGHT_HOLE_TEX.wrapT = THREE.RepeatWrapping;
      LIGHT_HOLE_TEX.colorSpace = THREE.SRGBColorSpace;
    }
    m.map = LIGHT_HOLE_TEX;
  } else m.color.set(color);
  return m;
}

/**
 * Bumper ring of any outline (robot-frame x/z points of the FRAME perimeter, counter-clockwise seen from above): an
 * extruded band `thickness` wide outside the frame, from bumperBottom to bumperTop. For non-rectangular robots.
 */
export function bumperRing(kit: ModelKit, outline: [number, number][], thickness: number): THREE.Mesh {
  const c = kit.config;
  const inner = outline.map(([x, z]) => new THREE.Vector2(x, z));
  const centroid = inner.reduce((a, p) => a.add(p), new THREE.Vector2()).multiplyScalar(1 / inner.length);
  const outer = inner.map((p) => p.clone().sub(centroid).setLength(p.clone().sub(centroid).length() + thickness).add(centroid));
  const shape = new THREE.Shape(outer);
  shape.holes.push(new THREE.Path([...inner].reverse()));
  const h = c.bumperTop - c.bumperBottom;
  const geo = new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: true, bevelThickness: h * 0.15, bevelSize: h * 0.12, bevelSegments: 3, curveSegments: 24 });
  geo.rotateX(Math.PI / 2); // shape x/y → robot x/z, extrusion → −y
  const mesh = new THREE.Mesh(geo, kit.mats.bumper);
  mesh.position.y = c.bumperTop - h * 0.12;
  kit.visual.add(mesh);
  return mesh;
}

/** A wire / cable run: smooth tube through robot-frame points (CAN, power leads). */
export function wire(parent: THREE.Object3D, pts: [number, number, number][], color: number, r = 0.004): THREE.Mesh {
  const curve = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p)));
  const mesh = new THREE.Mesh(new THREE.TubeGeometry(curve, Math.max(8, pts.length * 6), r, 6, false), mat(color, { rough: 0.7, metal: 0 }));
  mesh.userData.noShadow = true;
  parent.add(mesh);
  return mesh;
}

/** J-shaped climb hook rising from (x, y0, z): a rod of `h` with a curl at the top opening toward +x·dir. */
export function hook(parent: THREE.Object3D, x: number, y0: number, z: number, h: number, m: THREE.Material, dir: 1 | -1 = 1, r = 0.008): THREE.Mesh {
  const pts = [new THREE.Vector3(x, y0, z), new THREE.Vector3(x, y0 + h * 0.85, z), new THREE.Vector3(x + dir * 0.02, y0 + h, z), new THREE.Vector3(x + dir * 0.05, y0 + h * 0.97, z), new THREE.Vector3(x + dir * 0.06, y0 + h * 0.88, z)];
  const mesh = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, r, 8, false), m);
  parent.add(mesh);
  return mesh;
}

/**
 * Compliant / flex wheels on a shaft across z (shooter wheels, intake wheels): `n` wheels of radius r spread over
 * `span`, with a gray shaft. Returns the spinning group (spin about z).
 */
export function wheelShaft(parent: THREE.Object3D, x: number, y: number, o: { n: number; r: number; w: number; span: number; colors: number[]; shaft?: THREE.Material }): THREE.Group {
  const g = new THREE.Group();
  g.position.set(x, y, 0);
  g.userData.flowSpinAxis = 'z';
  g.userData.fuelDrivenSurface = true;
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, o.span + 0.04, 8), o.shaft ?? mat(0x9aa0a8, { metal: 0.7, rough: 0.3 }));
  shaft.rotation.x = Math.PI / 2;
  g.add(shaft);
  for (let i = 0; i < o.n; i++) {
    const z = o.n === 1 ? 0 : -o.span / 2 + (o.span * i) / (o.n - 1);
    const wheel = new THREE.Mesh(new THREE.CylinderGeometry(o.r, o.r, o.w, 20), mat(o.colors[i % o.colors.length], { rough: 0.85, metal: 0 }));
    wheel.rotation.x = Math.PI / 2;
    wheel.position.z = z;
    g.add(wheel);
    // Spokes so rotation reads.
    const spoke = new THREE.Mesh(new THREE.BoxGeometry(o.r * 1.6, o.r * 0.25, o.w * 1.02), STRIPE);
    spoke.position.z = z;
    g.add(spoke);
  }
  parent.add(g);
  return g;
}

/** Motor controller / module box with a status LED. */
export function controller(parent: THREE.Object3D, x: number, y: number, z: number, led = 0x39ff6a, body = 0x1c1d20): void {
  box(parent, 0.06, 0.025, 0.04, mat(body, { rough: 0.6 }), x, y + 0.0125, z);
  const l = box(parent, 0.008, 0.004, 0.008, new THREE.MeshStandardMaterial({ color: led, emissive: led, emissiveIntensity: 1.5 }), x + 0.02, y + 0.027, z);
  l.userData.noShadow = true;
}

/** Battery (12 V SLA) with red and black leads. */
export function battery(parent: THREE.Object3D, x: number, y: number, z: number, rotY = 0): THREE.Group {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  g.rotation.y = rotY;
  box(g, 0.18, 0.17, 0.077, mat(0x161718, { rough: 0.6 }), 0, 0.085, 0);
  box(g, 0.181, 0.03, 0.078, mat(0xc9cdd2, { rough: 0.5 }), 0, 0.15, 0);
  wire(g, [[0.05, 0.17, 0], [0.06, 0.21, 0.01], [0.1, 0.23, 0.02]], 0xc62828, 0.006);
  wire(g, [[-0.05, 0.17, 0], [-0.06, 0.21, 0.01], [-0.1, 0.23, 0.02]], 0x111111, 0.006);
  parent.add(g);
  return g;
}

// ───────────────────────── piece flow (RobotModel.flow) ─────────────────────────

/** Random offset in ±w/2 (spreads pieces across a hopper or a multi-lane shooter). */
export function jitter(w: number): number {
  return (Math.random() - 0.5) * w;
}

/** Robot-frame point on a (possibly moving) model part, read when a piece starts its trip. */
export function flowAt(k: ModelKit, o: THREE.Object3D, x = 0, y = 0, z = 0): THREE.Vector3 {
  // A throat offset is fixed relative to the roller's bearings, not its spinning tread.
  // Preserve parent pitch/yaw and static orientation (e.g. a lengthwise roller).
  if (o.userData.flowSpinAxis && o.parent) {
    const rotation = o.rotation.clone();
    rotation[o.userData.flowSpinAxis as 'x' | 'y' | 'z'] = 0;
    const p = new THREE.Vector3(x, y, z).applyEuler(rotation).add(o.position);
    return pointIn(k.visual, o.parent, p.x, p.y, p.z);
  }
  return pointIn(k.visual, o, x, y, z);
}

/**
 * Where an incoming piece lands in a box hopper: on top of the current pile, anywhere across the bin. Call
 * `setFill(s.fill)` from the model's update so the landing height follows the load.
 */
export function hopperStow(o: { x: number; y0: number; length: number; width: number; height: number; r: number }): { stow(): THREE.Vector3; setFill(f: number): void } {
  let fill = 0;
  return {
    setFill(f) { fill = f; },
    stow: () => new THREE.Vector3(o.x + jitter(o.length * 0.7), o.y0 + o.r + o.height * Math.min(0.92, fill) * 0.92, jitter(o.width * 0.7)),
  };
}

/**
 * Over-the-bumper intake path: picked up under the deployed roller (`tip`), carried up the arms, over the frame rail
 * and dropped into the hopper (the robot appends the stow point). `r` = piece radius.
 */
export function overBumperIntake(k: ModelKit, tip: THREE.Object3D, r: number): () => THREE.Vector3[] {
  const c = k.config;
  const side = k.groundSide;
  return () => {
    const z = jitter(c.intake.width * 0.6);
    return [flowAt(k, tip, 0, 0, z), new THREE.Vector3(side * (c.frameLength / 2 + 0.02), c.bumperTop + 0.08 + r, z * 0.8), new THREE.Vector3(side * c.frameLength * 0.32, c.bumperTop + 0.06 + r, z * 0.6)];
  };
}

/**
 * Feed up a center column into a turret: swept across the rotor floor (radius `rotorR`) to the column at `colX`,
 * lifted to the top, then into the shooter `wheel`. `r` = piece radius.
 */
export function columnFeed(k: ModelKit, colX: number, wheel: THREE.Object3D, rotorR: number, r: number): () => THREE.Vector3[] {
  const c = k.config;
  return () => {
    const a = Math.random() * Math.PI * 2;
    const y0 = c.bumperTop + 0.04 + r;
    return [new THREE.Vector3(colX + Math.cos(a) * rotorR, y0, Math.sin(a) * rotorR), new THREE.Vector3(colX + Math.cos(a + 1.2) * 0.1, y0, Math.sin(a + 1.2) * 0.1),
      new THREE.Vector3(colX, c.height - 0.14, 0), flowAt(k, wheel, -0.06, 0, 0), flowAt(k, wheel, 0.03, 0.03, 0)];
  };
}

/**
 * Dye rotor (2026 REBUILT indexer, as on 4414 / 1323 / 4946): a spinning pocketed floor plate inside a stationary
 * circular fence with a bolted top flange and standoffs; a curved guide wall lined with small vertical feed rollers
 * spirals the FUEL inward into an open, ring-framed tower that lifts it to the turret; Kraken motors drive the plate
 * from outside the fence. Positioned in `parent` with the plate center at (x, y0, z = 0) and the tower at `towerX`.
 * `floor` spins about y (positive = the direction FUEL travels along the spiral); `feed(r)` is the path a ball of
 * radius r takes from the rim, along the spiral wall and up the tower.
 */
export function dyeRotor(parent: THREE.Object3D, o: { x: number; y0: number; R: number; wallH: number; towerX: number; towerR: number; towerTop: number; plate: THREE.Material; pocket?: THREE.Material; accent?: THREE.Material; motors?: number; motorSide?: 1 | -1 }): { floor: THREE.Group; tower: THREE.Group; rollers: THREE.Object3D[]; feed(r: number): THREE.Vector3[] } {
  const { x, y0, R, wallH } = o;
  const pocketM = o.pocket ?? mat(0x34373d, { metal: 0.3, rough: 0.55 });
  const accent = o.accent ?? mat(0x24272c, { metal: 0.4, rough: 0.45 });
  const g = new THREE.Group();
  g.position.set(x, y0, 0);
  parent.add(g);
  // Spinning floor: a plate with two rings of lightening pockets, radial ribs and a hub.
  const floor = new THREE.Group();
  g.add(floor);
  floor.add(new THREE.Mesh(new THREE.CylinderGeometry(R, R, 0.008, 56), o.plate));
  const flat = (geo: THREE.BufferGeometry, y: number, m: THREE.Material) => {
    const mesh = new THREE.Mesh(geo, m);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = y;
    floor.add(mesh);
    return mesh;
  };
  const N = 14;
  for (let i = 0; i < N; i++) {
    const a0 = (i / N) * Math.PI * 2 + 0.03;
    const da = (Math.PI * 2) / N - 0.06;
    flat(new THREE.RingGeometry(R * 0.62, R * 0.94, 3, 1, a0, da), 0.0045, pocketM);
    flat(new THREE.RingGeometry(R * 0.3, R * 0.56, 2, 1, a0 + Math.PI / N, da), 0.0045, pocketM);
  }
  const bolts = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.004, 0.004, 0.006, 6), mat(0xb9c0c8, { metal: 0.8 }), 2 * N);
  const m4 = new THREE.Matrix4();
  for (let i = 0; i < 2 * N; i++) {
    const a = (i / (2 * N)) * Math.PI * 2;
    m4.makeTranslation(Math.cos(a) * R * 0.97, 0.006, Math.sin(a) * R * 0.97);
    bolts.setMatrixAt(i, m4);
  }
  floor.add(bolts);
  floor.add(new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.02, 20), accent));
  // Stationary fence with a top flange and standoffs.
  const fence = new THREE.Mesh(new THREE.CylinderGeometry(R + 0.012, R + 0.012, wallH, 56, 1, true), mat(0x1b1d21, { rough: 0.5 }));
  (fence.material as THREE.MeshStandardMaterial).side = THREE.DoubleSide;
  fence.position.y = wallH / 2;
  g.add(fence);
  const flange = new THREE.Mesh(new THREE.RingGeometry(R + 0.006, R + 0.035, 56), accent);
  flange.rotation.x = -Math.PI / 2;
  flange.position.y = wallH;
  (flange.material as THREE.MeshStandardMaterial).side = THREE.DoubleSide;
  g.add(flange);
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, wallH + 0.02, 6), mat(0x2a2d32, { metal: 0.6 }));
    post.position.set(Math.cos(a) * (R + 0.024), wallH / 2, Math.sin(a) * (R + 0.024));
    g.add(post);
  }
  // Spiral guide wall from the rim in to the tower, with a row of vertical feed rollers on its inner face.
  const tx = o.towerX - x;
  // The spiral winds in from the plate center (u = 0) to the tower center (u = 1).
  const pt = (a: number, rad: number, y: number, u = 0) => new THREE.Vector3(tx * u + Math.cos(a) * rad, y, -Math.sin(a) * rad);
  const a0 = Math.PI * 0.15;
  const sweep = Math.PI * 1.15;
  const rStart = R - 0.005;
  const rEnd = o.towerR + 0.02;
  const spiralR = (u: number) => rStart + (rEnd - rStart) * u;
  const wallM = mat(0x22252a, { rough: 0.45 });
  const SEG = 18;
  for (let i = 0; i < SEG; i++) {
    const p0 = pt(a0 + sweep * (i / SEG), spiralR(i / SEG), wallH / 2, i / SEG);
    const p1 = pt(a0 + sweep * ((i + 1) / SEG), spiralR((i + 1) / SEG), wallH / 2, (i + 1) / SEG);
    const seg = box(g, p0.distanceTo(p1) + 0.004, wallH * 0.95, 0.006, wallM, (p0.x + p1.x) / 2, wallH / 2, (p0.z + p1.z) / 2);
    seg.rotation.y = Math.atan2(-(p1.z - p0.z), p1.x - p0.x);
  }
  const rollers: THREE.Object3D[] = [];
  const rollerM = mat(0x111214, { rough: 0.8 });
  for (let i = 0; i < 7; i++) {
    const u = 0.55 + i * 0.065;
    const p = pt(a0 + sweep * u, spiralR(u) - 0.016, wallH * 0.48, u);
    const rl = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, wallH * 0.8, 10), rollerM);
    rl.position.copy(p);
    g.add(rl);
    rollers.push(rl);
  }
  // Open tower: ring plates joined by standoffs, a partial sheet wall (open toward the spiral) and lift rollers.
  const tower = new THREE.Group();
  tower.position.set(tx, 0, 0);
  g.add(tower);
  const th = o.towerTop - y0;
  for (const y of [0.01, th * 0.5, th - 0.01]) {
    const ring = new THREE.Mesh(new THREE.RingGeometry(o.towerR, o.towerR + 0.022, 32), accent);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = y;
    (ring.material as THREE.MeshStandardMaterial).side = THREE.DoubleSide;
    tower.add(ring);
  }
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const p = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, th, 6), mat(0x2a2d32, { metal: 0.6 }));
    p.position.set(Math.cos(a) * (o.towerR + 0.011), th / 2, Math.sin(a) * (o.towerR + 0.011));
    tower.add(p);
  }
  const entry = a0 + sweep; // the spiral ends here: leave the sheet open on that side
  const sheet = new THREE.Mesh(new THREE.CylinderGeometry(o.towerR, o.towerR, th * 0.62, 32, 1, true, entry + Math.PI / 2 + 0.9, Math.PI * 1.3), wallM);
  (sheet.material as THREE.MeshStandardMaterial).side = THREE.DoubleSide;
  sheet.position.y = th * 0.62 / 2 + th * 0.2;
  tower.add(sheet);
  for (const y of [th * 0.35, th * 0.7]) {
    const lift = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, o.towerR * 1.6, 10), rollerM);
    lift.rotation.x = Math.PI / 2;
    lift.position.set(-o.towerR * 0.55, y, 0);
    tower.add(lift);
    rollers.push(lift);
  }
  // Krakens driving the plate from outside the fence.
  const ms = o.motorSide ?? -1;
  for (let i = 0; i < (o.motors ?? 2); i++) {
    const a = Math.PI + ms * (0.35 + i * 0.32);
    const mx = Math.cos(a) * (R + 0.06);
    const mz = Math.sin(a) * (R + 0.06);
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.031, 0.031, 0.075, 16), mat(0x16171a, { rough: 0.6 }));
    body.position.set(mx, -0.005, mz);
    g.add(body);
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.0315, 0.0315, 0.01, 16), new THREE.MeshStandardMaterial({ color: 0x39d353, emissive: 0x1a7a2a, emissiveIntensity: 0.4 }));
    band.position.set(mx, 0.028, mz);
    g.add(band);
  }
  return {
    floor,
    tower,
    rollers,
    feed(r) {
      const pts: THREE.Vector3[] = [];
      // Picked up anywhere on the outer pocket ring, carried round to the start of the spiral, then along its inner face.
      const start = Math.random() * Math.PI * 1.4 - Math.PI * 0.9 + a0;
      pts.push(pt(start, rStart - r - 0.02, r + 0.006), pt((start + a0) / 2, rStart - r - 0.02, r + 0.006));
      for (let i = 0; i <= 6; i++) {
        const u = i / 6;
        pts.push(pt(a0 + sweep * u, Math.max(o.towerR * 0.4, spiralR(u) - r - 0.01), r + 0.006, u));
      }
      pts.push(pt(entry, 0, r + 0.01, 1), pt(entry, 0, th - r - 0.02, 1));
      return pts.map((p) => p.add(g.position));
    },
  };
}

/**
 * Under-bumper intake entry: the piece (half-thickness `r`) is pulled flat under the bumper on the intake face and
 * onto the deck just inside the frame.
 */
export function underBumperEntry(k: ModelKit, r: number): THREE.Vector3[] {
  const c = k.config;
  const side = k.groundSide;
  return [new THREE.Vector3(side * (k.fp.length / 2 - 0.02), Math.min(r + 0.008, c.bumperBottom + r), 0), new THREE.Vector3(side * (c.frameLength / 2 - 0.09), c.bumperTop + r, 0)];
}

/** Path riding `lift` above each roller in turn (indexers, conveyors, feeders), read where they are right now. */
export function overRollers(k: ModelKit, rollers: THREE.Object3D[], lift: number): THREE.Vector3[] {
  return rollers.map((o) => flowAt(k, o, 0, lift, 0));
}
