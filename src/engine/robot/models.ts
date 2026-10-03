import * as THREE from 'three';
import type { Alliance } from '../coords';
import type { RobotConfig } from './config';
import { HEADLESS, makeTextTexture } from '../render/text';

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
  /** Launch elevation of the latest shot (rad), or the config's default angle. */
  hood: number;
  /** Pieces held / capacity, 0–1. */
  fill: number;
  /** 0 = stowed, 1 = hooks raised to grab (align), 0.25 = pulled in (rising / hanging). */
  climb: number;
  /** Season-supplied placement mechanism pose (REEFSCAPE end effector): height above robot origin, forward reach. */
  place: { height: number; forward: number; level: number } | null;
  /** Chassis-frame velocity (m/s; x forward, z = robot right) and yaw rate (rad/s) — swerve modules steer/roll with it. */
  vx: number;
  vz: number;
  omega: number;
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
  /** Status light position (robot frame), on top of the model's structure. */
  lightAt?: [number, number, number];
}

export type RobotModelBuilder = (kit: ModelKit) => RobotModel;

const REGISTRY = new Map<string, RobotModelBuilder>();

export function registerRobotModel(id: string, build: RobotModelBuilder): void {
  REGISTRY.set(id, build);
}

export function robotModelBuilder(id: string | undefined): RobotModelBuilder | undefined {
  return id ? REGISTRY.get(id) : undefined;
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
  const drum = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, length, 14), m);
  drum.rotation.x = Math.PI / 2;
  g.add(drum);
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
export function hopperWalls(parent: THREE.Object3D, o: { x: number; y0: number; length: number; width: number; height: number; m: THREE.Material; frame?: THREE.Material }): THREE.Group {
  const g = new THREE.Group();
  g.position.set(o.x, o.y0, 0);
  const t = 0.008;
  box(g, o.length, o.height, t, o.m, 0, o.height / 2, o.width / 2);
  box(g, o.length, o.height, t, o.m, 0, o.height / 2, -o.width / 2);
  box(g, t, o.height, o.width, o.m, o.length / 2, o.height / 2, 0);
  box(g, t, o.height, o.width, o.m, -o.length / 2, o.height / 2, 0);
  // Floor and edge caps make the enclosure read as a finished hopper from above.
  const frame = o.frame ?? DARK_METAL;
  box(g, o.length, 0.008, o.width, frame, 0, 0.004, 0);
  for (const sz of [-1, 1]) box(g, o.length, 0.018, 0.018, frame, 0, o.height, sz * o.width / 2);
  for (const sx of [-1, 1]) box(g, 0.018, 0.018, o.width, frame, sx * o.length / 2, o.height, 0);
  if (o.frame) for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(g, 0.022, o.height, 0.022, o.frame, (sx * o.length) / 2, o.height / 2, (sz * o.width) / 2);
  parent.add(g);
  return g;
}

/**
 * Round FUEL inside the hopper, filled from the floor up with `set(fill)` (0–1).
 * Instancing preserves the recognizable game-piece shape without one draw call per ball.
 */
export function fillBlock(parent: THREE.Object3D, o: { x: number; y0: number; length: number; width: number; height: number; color: number }): { set(f: number): void } {
  // A single instanced draw call gives FUEL a readable round silhouette instead of a solid yellow cube.
  const r = Math.min(0.06, o.length / 6, o.width / 6);
  const nx = Math.max(1, Math.floor(o.length / (r * 2)));
  const nz = Math.max(1, Math.floor(o.width / (r * 2)));
  const ny = Math.max(1, Math.floor(o.height / (r * 1.75)));
  const count = nx * nz * ny;
  const mesh = new THREE.InstancedMesh(new THREE.SphereGeometry(r, 10, 7), mat(o.color, { rough: 0.8, metal: 0 }), count);
  const transform = new THREE.Object3D();
  let i = 0;
  for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) for (let z = 0; z < nz; z++) {
    transform.position.set(o.x + (x - (nx - 1) / 2) * r * 2, o.y0 + r + y * r * 1.75, (z - (nz - 1) / 2) * r * 2);
    transform.updateMatrix();
    mesh.setMatrixAt(i++, transform.matrix);
  }
  mesh.computeBoundingSphere();
  mesh.count = 0;
  parent.add(mesh);
  return { set(f) { mesh.count = Math.min(count, Math.round(Math.max(0, f) * count)); mesh.visible = mesh.count > 0; } };
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
  for (const sz of [-1, 1]) plate(parent, pts, t, m, sz * halfGap, holes);
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
export function deployableIntake(kit: ModelKit, o: { reach: number; hingeY?: number; width?: number; rollers?: number; frame?: THREE.Material; stow?: number }): { update(s: RobotAnimState, deploy: number): void; hinge: THREE.Group } {
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
  const orange = INTAKE_ORANGE();
  const rollers: THREE.Group[] = [];
  const nr = o.rollers ?? 2;
  for (let i = 0; i < nr; i++) rollers.push(roller(arms, 0.03, w, orange, side * (len - i * 0.075), 0, 0));
  sidePlates(arms, [[side * (len - nr * 0.075), -0.035], [side * (len + 0.04), -0.035], [side * (len + 0.04), 0.035], [side * (len - nr * 0.075), 0.035]], w / 2 + 0.012, frameM);
  box(arms, 0.012, 0.012, w, frameM, side * (len * 0.5), 0.02, 0);
  let speed = 0;
  return {
    hinge,
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
