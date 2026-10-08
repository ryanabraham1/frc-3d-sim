import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { Alliance } from '@engine/coords';
import type { FieldBuilder, Vec3 as BVec3 } from '@engine/field/builder';
import { HEADLESS } from '@engine/render/text';
import { COLORS, FIELD_LENGTH, FIELD_WIDTH, TRUSS_CLEARANCE } from './constants';
import {
  BLOCK_HALF, CHUTE, CX, DISTRICTS, DOWNTOWN, FOOTHILL, LAUNCH_ZONES, PAD_LENGTH, PAD_Y, PANEL_SLOT_Z, PROTECTIVE_BARRIER_X, ROW_X,
  TRUSS_HALF_DEPTH, UPTOWN, collectorZone, homeZone, mirrorX, panelSlotX, towerZone, trussX,
} from './geometry';

/**
 * Hero Heist field. Physics: procedural boxes/prisms built from the CAD measurements in geometry.ts, leaving every
 * CITY BLOCK opening physically open (pieces fly through the real window) and closing the MAILBOX slits (STORY PANEL
 * insertion is an assisted mechanism, see rules.ts). Visuals: the supplied Onshape field (prepared by
 * tools/prepare-hero-heist-cad.mjs) replaces the procedural meshes once it loads; its 80 POPULATION COUNTER LEDs and
 * the 8 tilting FOOTHILL MAILBOX baskets stay addressable.
 */
export interface HeroFieldRefs {
  /** LED strip materials per district (4 each), procedural until the CAD loads, then the CAD's own indicators. */
  lights: THREE.MeshStandardMaterial[][];
  /** FOOTHILL basket visuals by district id (tilt back when a panel is delivered). */
  baskets: Map<number, { object: THREE.Object3D; axis: THREE.Vector3; rest: THREE.Quaternion }>;
  /** Truss colliders by squad (G20: robots may only touch the CLIMB PADS). */
  truss: Record<Alliance, RAPIER.Collider>;
  /** Parent for season-drawn scored/held pieces. */
  pieces: THREE.Group;
  /** Resolves once the CAD visual is in (null headless or when it fails to load). */
  cad: Promise<THREE.Object3D | null>;
}

const PURPLE = 0x7b5bc9, GREEN = 0x5f9a3e, GREY = 0xb8bec6, DARK = 0x40454f;

export function buildHeroField(b: FieldBuilder): HeroFieldRefs {
  const L = FIELD_LENGTH, W = FIELD_WIDTH;
  b.carpet(COLORS.carpet);
  const wall = { color: GREY, opacity: 0.35, friction: 0.25, restitution: 0.25 };

  // ── GUARDRAILS (16 in polycarbonate, kept a little taller so pieces stay in) and SQUAD WALLS with the bubble chute ──
  for (const y of [-0.03, W + 0.03]) {
    b.box([2.3, y, 0.25], [4.6, 0.06, 0.5], wall);
    b.box([L - 2.3, y, 0.25], [4.6, 0.06, 0.5], wall);
  }
  b.box([CX, -0.03, 0.25], [2 * UPTOWN.halfLength + 0.4, 0.06, 0.5], { ...wall, visible: false });
  for (const a of ['blue', 'red'] as const) {
    const x = mirrorX(a, -0.03), out = mirrorX(a, -0.25);
    const end = { ...wall, color: a === 'blue' ? COLORS.blue : COLORS.red, opacity: 0.45 };
    b.box([x, (CHUTE.y1 + W) / 2, 1.0], [0.06, W - CHUTE.y1, 2.0], end);
    b.box([x, CHUTE.y0 / 2, 1.0], [0.06, CHUTE.y0, 2.0], end);
    b.box([x, (CHUTE.y0 + CHUTE.y1) / 2, CHUTE.z0 / 2], [0.06, CHUTE.y1 - CHUTE.y0, CHUTE.z0], end);
    b.box([x, (CHUTE.y0 + CHUTE.y1) / 2, (CHUTE.z1 + 2) / 2], [0.06, CHUTE.y1 - CHUTE.y0, 2 - CHUTE.z1], end);
    // Curved trough outside the slot, approximated by a floor and back stop the HUMAN PLAYER rolls bubbles down.
    b.box([out, (CHUTE.y0 + CHUTE.y1) / 2, CHUTE.z0 - 0.04], [0.4, CHUTE.y1 - CHUTE.y0, 0.08], { color: 0xf2f2f2 });
    b.box([mirrorX(a, -0.47), (CHUTE.y0 + CHUTE.y1) / 2, 1.1], [0.05, CHUTE.y1 - CHUTE.y0, 0.8], { ...wall, opacity: 0.2 });
    // STORY PANEL slide: the box behind the side guardrail with three horizontal exit slots facing the field.
    const x0 = mirrorX(a, 0.905), x1 = mirrorX(a, 3.648);
    b.boxMinMax([Math.min(x0, x1), -0.36, 0], [Math.max(x0, x1), -0.06, PANEL_SLOT_Z - 0.03], { color: GREY, friction: 0.1 }); // slick slide floor
    b.boxMinMax([Math.min(x0, x1), -0.36, PANEL_SLOT_Z + 0.07], [Math.max(x0, x1), -0.06, 1.22], { color: GREY });
    b.boxMinMax([Math.min(x0, x1), -0.38, 0], [Math.max(x0, x1), -0.36, 1.22], { color: GREY });
    for (let k = 0; k < 3; k++) b.box([panelSlotX(a, k), -0.07, PANEL_SLOT_Z + 0.02], [0.62, 0.02, 0.012], { color: 0xffffff, collide: false });
    // Low barrier between the COLLECTOR ZONE and the DOWNTOWN front.
    b.box([mirrorX(a, PROTECTIVE_BARRIER_X), 0.686, 0.2475], [0.02, 1.372, 0.495], { color: a === 'blue' ? COLORS.blue : COLORS.red, opacity: 0.5 });
  }

  // ── UPTOWN: lower face, chamfer (diagonal MAILBOX slits), upper face, 45° top with the CITY BLOCK windows ──
  const uLen = 2 * UPTOWN.halfLength;
  const up = { color: PURPLE, friction: 0.3, restitution: 0.2 };
  b.boxMinMax([CX - UPTOWN.halfLength, UPTOWN.face, 0], [CX + UPTOWN.halfLength, UPTOWN.back, 0.8], up);
  prism(b, CX, uLen, [[UPTOWN.face, 0.8], [UPTOWN.upperFace, 0.8], [UPTOWN.upperFace, 0.996]], up);
  b.boxMinMax([CX - UPTOWN.halfLength, UPTOWN.upperFace, 0.8], [CX + UPTOWN.halfLength, UPTOWN.back, UPTOWN.rampBack], up);
  for (const [x0, x1, hole] of segments(UPTOWN.halfLength)) {
    if (!hole) prism(b, (x0 + x1) / 2, x1 - x0, [[UPTOWN.upperFace, UPTOWN.rampBack], [UPTOWN.back, UPTOWN.rampBack], [UPTOWN.back, UPTOWN.frameTop], [UPTOWN.windowTop + 0.07, UPTOWN.frameTop], [UPTOWN.upperFace, UPTOWN.upperFaceTop]], up);
    else {
      // Inside: the ramp from the front lip down to the back carries scored bubbles away; frame bar across the top.
      prism(b, (x0 + x1) / 2, x1 - x0, [[UPTOWN.upperFace, UPTOWN.rampBack], [UPTOWN.back, UPTOWN.rampBack], [UPTOWN.upperFace + 0.02, UPTOWN.upperFaceTop], [UPTOWN.upperFace, UPTOWN.upperFaceTop]], up);
      b.boxMinMax([x0, UPTOWN.windowTop - 0.02, 1.83], [x1, UPTOWN.back, UPTOWN.frameTop], { ...up, color: 0xffffff });
    }
  }
  b.boxMinMax([CX - UPTOWN.halfLength, UPTOWN.back, UPTOWN.rampBack], [CX + UPTOWN.halfLength, UPTOWN.backboard, 2.88], { ...up, color: DARK });

  // ── DOWNTOWN: front face (horizontal MAILBOX slits), chamfer, flat top with the CITY BLOCK holes, LED backboard ──
  const dn = { color: GREEN, friction: 0.3, restitution: 0.2 };
  b.boxMinMax([CX - DOWNTOWN.halfLength, DOWNTOWN.back, 0], [CX + DOWNTOWN.halfLength, DOWNTOWN.face, 0.78], dn);
  prism(b, CX, uLen, [[DOWNTOWN.face, 0.78], [DOWNTOWN.holeFront, DOWNTOWN.top], [DOWNTOWN.holeFront, 0.78]], dn);
  for (const [x0, x1, hole] of segments(DOWNTOWN.halfLength)) {
    if (!hole) b.boxMinMax([x0, DOWNTOWN.holeBack, 0.78], [x1, DOWNTOWN.holeFront, DOWNTOWN.top], dn);
    else b.boxMinMax([x0, DOWNTOWN.holeBack, 0.78], [x1, DOWNTOWN.holeFront, DOWNTOWN.floor], { ...dn, color: 0xf2f2f2 });
  }
  b.boxMinMax([CX - DOWNTOWN.halfLength, DOWNTOWN.back, 0.78], [CX + DOWNTOWN.halfLength, DOWNTOWN.holeBack, DOWNTOWN.backTop], dn);
  b.boxMinMax([CX - DOWNTOWN.halfLength, DOWNTOWN.back, DOWNTOWN.backTop], [CX + DOWNTOWN.halfLength, DOWNTOWN.back + 0.02, DOWNTOWN.backboardTop], { ...dn, color: DARK });

  // ── FOOTHILLS: thin diagonal walls with square funnel holes (CITY BLOCKS) and top-fed baskets (MAILBOXES) ──
  const baskets = new Map<number, { object: THREE.Object3D; axis: THREE.Vector3; rest: THREE.Quaternion }>();
  for (const a of ['blue', 'red'] as const) {
    const s = a === 'blue' ? 1 : -1;
    const t = { x: FOOTHILL.t.x * s, y: FOOTHILL.t.y }, n = { x: FOOTHILL.n.x * s, y: FOOTHILL.n.y };
    const p0 = { x: mirrorX(a, FOOTHILL.p0.x), y: FOOTHILL.p0.y };
    const yaw = Math.atan2(t.y, t.x);
    const at = (tt: number, u: number) => ({ x: p0.x + t.x * tt + n.x * u, y: p0.y + t.y * tt + n.y * u });
    const fw = { color: a === 'blue' ? 0xe8973a : 0xe8d23a /* WEST orange, EAST yellow (manual p. 11) */, friction: 0.3, restitution: 0.2, yaw };
    const piece = (t0: number, t1: number, z0: number, z1: number) => {
      const c = at((t0 + t1) / 2, 0.025);
      b.box([c.x, c.y, (z0 + z1) / 2], [t1 - t0, 0.05, z1 - z0], fw);
    };
    const cols = [0, FOOTHILL.column];
    piece(-0.56, cols[0] - BLOCK_HALF, 0, 3.0);
    piece(cols[0] + BLOCK_HALF, cols[1] - BLOCK_HALF, 0, 3.0);
    piece(cols[1] + BLOCK_HALF, 1.62, 0, 3.0);
    for (const c of cols) {
      const holes = FOOTHILL.funnelZ.map(z => [z - 0.25, z + 0.25]);
      piece(c - BLOCK_HALF, c + BLOCK_HALF, 0, holes[0][0]);
      piece(c - BLOCK_HALF, c + BLOCK_HALF, holes[0][1], holes[1][0]);
      piece(c - BLOCK_HALF, c + BLOCK_HALF, holes[1][1], 3.0);
      for (const z of FOOTHILL.funnelZ) {
        // Funnel behind the hole: a backstop that catches what the exit sensor counted.
        const back = at(c, 0.5);
        b.box([back.x, back.y, z], [0.62, 0.04, 0.62], { ...fw, color: 0x9aa0a8, visible: false });
      }
      for (const top of FOOTHILL.basketTop) {
        const pocket = at(c, -0.06);
        const e = b.box([pocket.x, pocket.y, top - 0.33], [0.66, 0.12, 0.66], { color: 0x8c939b, yaw, friction: 0.3 });
        const district = DISTRICTS.find(d => d.region === (a === 'blue' ? 'west' : 'east') && Math.abs(d.mailbox.entry.z - top) < 0.01 && Math.hypot(d.mailbox.entry.x - pocket.x, d.mailbox.entry.y - pocket.y) < 0.2);
        if (district && e.mesh) baskets.set(district.id, { object: e.mesh, axis: new THREE.Vector3(t.x, 0, -t.y).normalize(), rest: e.mesh.quaternion.clone() });
      }
    }
  }

  // ── TOWERS: truss across the field, 66 in underside; three CLIMB PADS per tower ──
  const truss = {} as Record<Alliance, RAPIER.Collider>;
  for (const a of ['blue', 'red'] as const) {
    const x = trussX(a), z0 = TRUSS_CLEARANCE, z1 = 1.981;
    const e = b.boxMinMax([x - TRUSS_HALF_DEPTH, -0.5, z0], [x + TRUSS_HALF_DEPTH, W + 0.5, z1], { color: 0x2b2f36, metalness: 0.6, roughness: 0.4 });
    truss[a] = e.collider!;
    for (const y of [-0.45, W + 0.45]) b.boxMinMax([x - 0.15, y - 0.15, 0], [x + 0.15, y + 0.15, z1], { color: 0x2b2f36 });
    for (const y of PAD_Y) b.box([x, y, z0 - 0.006], [2 * TRUSS_HALF_DEPTH + 0.025, PAD_LENGTH, 0.012], { color: a === 'blue' ? COLORS.blue : COLORS.red, collide: false });
  }

  // ── Tape (CAD carpet primitives) ──
  for (const a of ['blue', 'red'] as const) {
    const col = a === 'blue' ? COLORS.blue : COLORS.red;
    outline(b, towerZone(a), col);
    outline(b, collectorZone(a), col);
    outline(b, homeZone(a), col);
  }
  for (const z of LAUNCH_ZONES.slice(1)) b.tape(z[0].x, z[0].y, z[1].x, z[1].y, 0.11, 0x9a1fac);
  b.tape(CX, 0, CX, W, 0.1, 0xeaeaea);

  // ── POPULATION COUNTER LEDs (procedural stand-ins until the CAD's own indicators load) ──
  const lights: THREE.MeshStandardMaterial[][] = DISTRICTS.map(d => {
    const mats: THREE.MeshStandardMaterial[] = [];
    const c = d.cityBlock.center, nrm = d.cityBlock.normal;
    for (let k = 0; k < 4; k++) {
      const mat = new THREE.MeshStandardMaterial({ color: 0x333333, emissive: 0x000000, emissiveIntensity: 1.6 });
      mats.push(mat);
      const off = d.region === 'downtown' ? { x: c.x, y: DOWNTOWN.back + 0.03, z: 1.1 + 0.08 * k } : { x: c.x + nrm.x * 0.02 + (k - 1.5) * 0.12 * (d.cityBlock.u.x), y: c.y + nrm.y * 0.02 + (k - 1.5) * 0.12 * d.cityBlock.u.y, z: c.z + BLOCK_HALF + 0.05 + nrm.z * 0.02 };
      b.box([off.x, off.y, off.z], [0.1, 0.03, 0.03], { material: mat, collide: false, castShadow: false });
    }
    return mats;
  });

  const pieces = new THREE.Group();
  pieces.name = 'hero-pieces';
  b.scene.add(pieces);
  const refs: HeroFieldRefs = { lights, baskets, truss, pieces, cad: Promise.resolve(null) };
  if (!HEADLESS) refs.cad = loadCad(b, refs);
  return refs;
}

/** UPTOWN/DOWNTOWN length split into solid segments and 0.54 m CITY BLOCK holes: [x0, x1, isHole]. */
function segments(halfLength: number): [number, number, boolean][] {
  const out: [number, number, boolean][] = [];
  let x = CX - halfLength;
  for (const dx of ROW_X) {
    const h0 = CX + dx - BLOCK_HALF, h1 = CX + dx + BLOCK_HALF;
    out.push([x, h0, false], [h0, h1, true]);
    x = h1;
  }
  out.push([x, CX + halfLength, false]);
  return out;
}

/** A prism running along field x, centered at `cx` with length `len`, from a (y, z) cross-section. */
function prism(b: FieldBuilder, cx: number, len: number, yz: [number, number][], o: Parameters<FieldBuilder['box']>[2]): void {
  const cy = yz.reduce((s, p) => s + p[0], 0) / yz.length, cz = yz.reduce((s, p) => s + p[1], 0) / yz.length;
  const pts: BVec3[] = [];
  for (const sx of [-len / 2, len / 2]) for (const [y, z] of yz) pts.push([sx, y - cy, z - cz]);
  b.convex([cx, cy, cz], pts, o);
}

function outline(b: FieldBuilder, poly: { x: number; y: number }[], color: number): void {
  for (let k = 0; k < poly.length; k++) {
    const p = poly[k], q = poly[(k + 1) % poly.length];
    const edge = (p.x <= 0.01 && q.x <= 0.01) || (p.x >= FIELD_LENGTH - 0.01 && q.x >= FIELD_LENGTH - 0.01) || (p.y <= 0.01 && q.y <= 0.01) || (p.y >= FIELD_WIDTH - 0.01 && q.y >= FIELD_WIDTH - 0.01);
    if (!edge) b.tape(p.x, p.y, q.x, q.y, 0.05, color);
  }
}

/** Load the prepared CAD field, hide the procedural visuals, and hand its LEDs and baskets to the rules. */
async function loadCad(b: FieldBuilder, refs: HeroFieldRefs): Promise<THREE.Object3D | null> {
  try {
    const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
    const gltf = await new GLTFLoader().loadAsync(`${import.meta.env.BASE_URL ?? '/'}assets/hero-heist/field.glb`);
    const root = gltf.scene;
    root.name = 'hero-heist-cad';
    root.traverse(o => {
      const m = o as THREE.Mesh;
      if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; }
    });
    // Prepared field is centered at the field center, Y-up, meters: the engine's world frame.
    b.scene.add(root);
    b.root.traverse(o => { if ((o as THREE.Mesh).isMesh) o.visible = false; });
    // CAD LEDs replace the stand-ins: each indicator gets its own material.
    refs.lights.forEach((mats, d) => {
      DISTRICTS[d].lights.forEach((index, k) => {
        const node = root.getObjectByName(`indicator-${index}`);
        if (!node) return;
        node.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh) m.material = mats[k]; });
      });
    });
    // Tilting FOOTHILL baskets: CAD groups mailbox-0..7, matched to the nearest district mailbox.
    for (let k = 0; k < 8; k++) {
      const node = root.getObjectByName(`mailbox-${k}`);
      if (!node) continue;
      const c = new THREE.Box3().setFromObject(node).getCenter(new THREE.Vector3());
      const f = { x: c.x + CX, y: FIELD_WIDTH / 2 - c.z, z: c.y };
      let best: number | null = null, bd = 0.5;
      for (const d of DISTRICTS) {
        if (d.mailbox.family !== 'top') continue;
        const dist = Math.hypot(d.mailbox.entry.x - f.x, d.mailbox.entry.y - f.y, d.mailbox.entry.z - 0.33 - f.z);
        if (dist < bd) { bd = dist; best = d.id; }
      }
      const old = best === null ? undefined : refs.baskets.get(best);
      if (best === null || !old || !node.parent) continue;
      // Hinge along the bottom of the basket against the wall: the basket tips back through the wall opening.
      const box = new THREE.Box3().setFromObject(node);
      const pivot = new THREE.Group();
      pivot.position.set(c.x, box.min.y, c.z);
      node.parent.add(pivot);
      pivot.attach(node);
      refs.baskets.set(best, { object: pivot, axis: old.axis, rest: pivot.quaternion.clone() });
    }
    return root;
  } catch (e) {
    console.warn('Hero Heist CAD field did not load; using the procedural field', e);
    return null;
  }
}
