import * as THREE from 'three';
import { ConvexGeometry } from 'three/examples/jsm/geometries/ConvexGeometry.js';
import type RAPIER from '@dimforge/rapier3d-compat';
import { FieldFrame } from '../coords';
import { GROUPS, PhysicsWorld } from '../physics/world';
import { makeTextTexture } from '../render/text';

export type Vec3 = [number, number, number];

/** Which physics layer a field element collides with. */
export type CollideMode = 'all' | 'pieces' | 'robots' | false;

export interface ElementOptions {
  color?: THREE.ColorRepresentation;
  material?: THREE.Material;
  opacity?: number;
  emissive?: THREE.ColorRepresentation;
  emissiveIntensity?: number;
  metalness?: number;
  roughness?: number;
  collide?: CollideMode;
  visible?: boolean;
  castShadow?: boolean;
  receiveShadow?: boolean;
  friction?: number;
  restitution?: number;
  name?: string;
  parent?: THREE.Object3D;
  /** Rotation about vertical axis (field yaw, CCW from +x). */
  yaw?: number;
  /** Rotation about the element's local field-y axis: positive tilts +x end upward. */
  pitch?: number;
  /** Rotation about the element's local field-x axis: positive tilts +y end upward. */
  roll?: number;
}

export interface Element {
  mesh: THREE.Mesh | null;
  collider: RAPIER.Collider | null;
}

/**
 * Builds static field geometry (visual mesh + fixed Rapier collider) from FIELD-FRAME
 * coordinates (WPILib convention, meters). Seasons compose their field from these primitives.
 */
export class FieldBuilder {
  readonly root = new THREE.Group();
  private readonly body: RAPIER.RigidBody;
  private readonly matCache = new Map<string, THREE.Material>();

  constructor(
    readonly physics: PhysicsWorld,
    readonly scene: THREE.Scene,
    readonly frame: FieldFrame,
  ) {
    this.root.name = 'field';
    scene.add(this.root);
    this.body = physics.fixedBody();
  }

  material(o: ElementOptions): THREE.Material {
    if (o.material) return o.material;
    const key = [o.color ?? 0x888888, o.opacity ?? 1, o.emissive ?? 0, o.emissiveIntensity ?? 1, o.metalness ?? 0.1, o.roughness ?? 0.7].join('|');
    let m = this.matCache.get(key);
    if (!m) {
      const transparent = (o.opacity ?? 1) < 1;
      m = new THREE.MeshStandardMaterial({
        color: o.color ?? 0x888888,
        transparent,
        opacity: o.opacity ?? 1,
        depthWrite: !transparent,
        emissive: o.emissive ?? 0x000000,
        emissiveIntensity: o.emissiveIntensity ?? 1,
        metalness: o.metalness ?? 0.1,
        roughness: o.roughness ?? 0.7,
        side: transparent ? THREE.DoubleSide : THREE.FrontSide,
      });
      this.matCache.set(key, m);
    }
    return m;
  }

  /** World-space quaternion for field yaw/pitch/roll. */
  rotation(o: ElementOptions): THREE.Quaternion {
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), o.yaw ?? 0);
    // field +y == world -Z; field +x == world +X
    if (o.pitch) q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), o.pitch));
    if (o.roll) q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), o.roll));
    return q;
  }

  private finishMesh(mesh: THREE.Mesh, pos: THREE.Vector3, q: THREE.Quaternion, o: ElementOptions): THREE.Mesh {
    mesh.position.copy(pos);
    mesh.quaternion.copy(q);
    mesh.castShadow = o.castShadow ?? (o.opacity ?? 1) >= 1;
    mesh.receiveShadow = o.receiveShadow ?? true;
    if (o.name) mesh.name = o.name;
    (o.parent ?? this.root).add(mesh);
    return mesh;
  }

  private finishCollider(desc: RAPIER.ColliderDesc, pos: THREE.Vector3, q: THREE.Quaternion, o: ElementOptions): RAPIER.Collider | null {
    const mode = o.collide ?? 'all';
    if (mode === false) return null;
    desc.setTranslation(pos.x, pos.y, pos.z);
    desc.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w });
    desc.setFriction(o.friction ?? 0.6);
    desc.setRestitution(o.restitution ?? 0.2);
    desc.setCollisionGroups(mode === 'all' ? GROUPS.field : mode === 'pieces' ? GROUPS.pieceOnly : GROUPS.robotOnly);
    return this.physics.world.createCollider(desc, this.body);
  }

  /** Axis-aligned (before yaw/pitch) box. center = [x, y, zCenter]; size = [sx, sy, sz] along field x/y/up. */
  box(center: Vec3, size: Vec3, o: ElementOptions = {}): Element {
    const pos = this.frame.toWorld(center[0], center[1], center[2]);
    const q = this.rotation(o);
    let mesh: THREE.Mesh | null = null;
    if (o.visible ?? true) {
      mesh = this.finishMesh(new THREE.Mesh(new THREE.BoxGeometry(size[0], size[2], size[1]), this.material(o)), pos, q, o);
    }
    const collider = this.finishCollider(this.physics.R.ColliderDesc.cuboid(size[0] / 2, size[2] / 2, size[1] / 2), pos, q, o);
    return { mesh, collider };
  }

  /** Box given by min/max corners in field frame (no rotation). */
  boxMinMax(min: Vec3, max: Vec3, o: ElementOptions = {}): Element {
    return this.box(
      [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2],
      [Math.abs(max[0] - min[0]), Math.abs(max[1] - min[1]), Math.abs(max[2] - min[2])],
      o,
    );
  }

  /** Convex hull from points given in the element's local FIELD axes (relative to center). */
  convex(center: Vec3, localPoints: Vec3[], o: ElementOptions = {}): Element {
    const pos = this.frame.toWorld(center[0], center[1], center[2]);
    const q = this.rotation(o);
    const pts = localPoints.map((p) => new THREE.Vector3(p[0], p[2], -p[1]));
    let mesh: THREE.Mesh | null = null;
    if (o.visible ?? true) {
      mesh = this.finishMesh(new THREE.Mesh(new ConvexGeometry(pts), this.material(o)), pos, q, o);
    }
    const arr = new Float32Array(pts.flatMap((p) => [p.x, p.y, p.z]));
    const desc = this.physics.R.ColliderDesc.convexHull(arr);
    const collider = desc ? this.finishCollider(desc, pos, q, o) : null;
    return { mesh, collider };
  }

  /** Cylinder between two field points (rungs, pipes, posts). */
  cylinder(a: Vec3, b: Vec3, radius: number, o: ElementOptions = {}, radialSegments = 16): Element {
    const wa = this.frame.toWorld(a[0], a[1], a[2]);
    const wb = this.frame.toWorld(b[0], b[1], b[2]);
    const dir = new THREE.Vector3().subVectors(wb, wa);
    const len = dir.length();
    const pos = new THREE.Vector3().addVectors(wa, wb).multiplyScalar(0.5);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
    let mesh: THREE.Mesh | null = null;
    if (o.visible ?? true) {
      mesh = this.finishMesh(new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, len, radialSegments), this.material(o)), pos, q, o);
    }
    const collider = this.finishCollider(this.physics.R.ColliderDesc.cylinder(len / 2, radius), pos, q, o);
    return { mesh, collider };
  }

  /** Floor tape line between two field points. */
  tape(x0: number, y0: number, x1: number, y1: number, width: number, color: THREE.ColorRepresentation): THREE.Mesh {
    const len = Math.hypot(x1 - x0, y1 - y0);
    const yaw = Math.atan2(y1 - y0, x1 - x0);
    const el = this.box([(x0 + x1) / 2, (y0 + y1) / 2, 0.0015], [len, width, 0.002], {
      color,
      collide: false,
      castShadow: false,
      yaw,
      roughness: 0.9,
    });
    return el.mesh!;
  }

  /** Rectangle outline of tape (zones). */
  tapeRect(x0: number, y0: number, x1: number, y1: number, width: number, color: THREE.ColorRepresentation): void {
    this.tape(x0, y0, x1, y0, width, color);
    this.tape(x1, y0, x1, y1, width, color);
    this.tape(x1, y1, x0, y1, width, color);
    this.tape(x0, y1, x0, y0, width, color);
  }

  /** A flat textured panel (labels, AprilTags, signs). Faces direction `yaw` (its normal). */
  panel(center: Vec3, width: number, height: number, texture: THREE.Texture, yaw: number, o: ElementOptions = {}): THREE.Mesh {
    const mat = new THREE.MeshStandardMaterial({ map: texture, roughness: 0.8, transparent: true });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), mat);
    // PlaneGeometry faces +Z (world); rotate so its normal points along field yaw.
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw + Math.PI / 2);
    mesh.castShadow = false;
    return this.finishMesh(mesh, this.frame.toWorld(center[0], center[1], center[2]), q, { ...o, castShadow: false });
  }

  label(center: Vec3, text: string, height: number, yaw: number, color = '#ffffff', background?: string): THREE.Mesh {
    const tex = makeTextTexture(text, { color, background, width: 512, height: 128 });
    return this.panel(center, height * 4, height, tex, yaw);
  }

  /** Big static floor collider + carpet mesh covering the field. */
  carpet(color: THREE.ColorRepresentation, friction = 0.9): void {
    const L = this.frame.length;
    const W = this.frame.width;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(L, W), this.material({ color, roughness: 1 }));
    mesh.rotation.x = -Math.PI / 2;
    mesh.receiveShadow = true;
    this.root.add(mesh);
    const desc = this.physics.R.ColliderDesc.cuboid(L / 2 + 5, 0.5, W / 2 + 5).setTranslation(0, -0.5, 0).setFriction(friction).setRestitution(0.1);
    desc.setCollisionGroups(GROUPS.field);
    this.physics.world.createCollider(desc, this.body);
  }
}
