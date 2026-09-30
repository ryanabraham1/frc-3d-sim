import * as THREE from 'three';
import { ALLIANCES, type Alliance } from '@engine/coords';
import type { SeasonContext } from '@engine/core/season';
import type { ElementOptions, FieldBuilder, Vec3 } from '@engine/field/builder';
import { addAprilTags, type TagPose } from '@engine/field/apriltags';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { inch } from '@engine/units';
import * as C from './constants';

export interface CrescendoFieldRefs {
  /** SPEAKER light strings (on when AMPLIFIED) [M 5.6.1]. */
  speakerLights: Record<Alliance, THREE.Mesh[]>;
  /** SUBWOOFER light bar segments that recede second by second while AMPLIFIED. */
  subwooferBars: Record<Alliance, THREE.Mesh[]>;
  /** AMP lights: [bottom, top] ALLIANCE-colored + the amber Coopertition light [M 5.3]. */
  ampLights: Record<Alliance, { bottom: THREE.Mesh; top: THREE.Mesh; coop: THREE.Mesh }>;
  /** HIGH NOTES waiting on top of each AMP. */
  highNotes: Record<Alliance, THREE.Mesh[]>;
  /** HIGH NOTE resting on each MICROPHONE (SPOTLIT), per chain. */
  spotlights: Record<Alliance, THREE.Mesh[]>;
  /** NOTE in each TRAP, per chain. */
  trapNotes: Record<Alliance, THREE.Mesh[]>;
  /** Brief AMP-scoring animation ring per alliance. */
  ampNotes: Record<Alliance, THREE.Mesh>;
}

export function noteMesh(highNote = false): THREE.Mesh {
  const tube = (C.NOTE_OUTER_RADIUS - C.NOTE_INNER_RADIUS) / 2;
  const geo = new THREE.TorusGeometry(C.NOTE_INNER_RADIUS + tube, tube, 10, 32);
  geo.scale(1, 1, C.NOTE_THICKNESS / 2 / tube);
  const mat = new THREE.MeshStandardMaterial({ color: C.COLORS.note, roughness: 0.65 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  if (highNote) {
    // HIGH NOTE: 3 equidistant bands of white gaffers tape around the cross-section [M 5.7].
    const bandMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8 });
    for (let k = 0; k < 3; k++) {
      const t = (k * 2 * Math.PI) / 3;
      const band = new THREE.Mesh(new THREE.TorusGeometry(tube * 1.06, tube * 0.14, 6, 14), bandMat);
      band.position.set(Math.cos(t) * (C.NOTE_INNER_RADIUS + tube), Math.sin(t) * (C.NOTE_INNER_RADIUS + tube), 0);
      band.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(-Math.sin(t), Math.cos(t), 0));
      mesh.add(band);
    }
  }
  return mesh;
}

/** Axis-aligned box in blue-local coordinates, mirrored in x for red. */
function sideBox(b: FieldBuilder, a: Alliance, min: Vec3, max: Vec3, o: ElementOptions = {}) {
  const x0 = a === 'blue' ? min[0] : C.L - max[0];
  const x1 = a === 'blue' ? max[0] : C.L - min[0];
  return b.boxMinMax([x0, min[1], min[2]], [x1, max[1], max[2]], o);
}

/** Truss tube geometry collected per field and merged into one mesh (hundreds of tubes → one draw call). */
const trussParts: THREE.BufferGeometry[] = [];

function tube(b: FieldBuilder, p0: Vec3, p1: Vec3, r: number, segments: number) {
  const wa = b.frame.toWorld(p0[0], p0[1], p0[2]);
  const wb = b.frame.toWorld(p1[0], p1[1], p1[2]);
  const dir = new THREE.Vector3().subVectors(wb, wa);
  const len = dir.length();
  const g = new THREE.CylinderGeometry(r, r, len, segments, 1, true);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize()));
  g.translate((wa.x + wb.x) / 2, (wa.y + wb.y) / 2, (wa.z + wb.z) / 2);
  trussParts.push(g);
}

/** A lattice truss between two field points: 4 chords + zig-zag webbing; one hidden box collider. */
function truss(b: FieldBuilder, p0: Vec3, p1: Vec3, size: number, collide: ElementOptions['collide'] = 'all') {
  const dx = p1[0] - p0[0], dy = p1[1] - p0[1], dz = p1[2] - p0[2];
  const len = Math.hypot(dx, dy, dz);
  const yaw = Math.atan2(dy, dx);
  const horiz = Math.hypot(dx, dy);
  const vertical = horiz < 1e-6;
  const mid: Vec3 = [(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2, (p0[2] + p1[2]) / 2];
  if (collide) {
    b.box(mid, vertical ? [size, size, len] : [len, size, size], { visible: false, collide, yaw });
  }
  const r = inch(0.9);
  const h = size / 2 - r;
  // Local frame: u along the truss, v and w across it.
  const u = [dx / len, dy / len, dz / len];
  const v = vertical ? [Math.cos(yaw), Math.sin(yaw), 0] : [-Math.sin(yaw), Math.cos(yaw), 0];
  const w = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  const at = (t: number, sv: number, sw: number): Vec3 => [p0[0] + dx * t + (v[0] * sv + w[0] * sw) * h, p0[1] + dy * t + (v[1] * sv + w[1] * sw) * h, p0[2] + dz * t + (v[2] * sv + w[2] * sw) * h];
  const corners: [number, number][] = [[-1, -1], [-1, 1], [1, 1], [1, -1]];
  for (const [sv, sw] of corners) tube(b, at(0, sv, sw), at(1, sv, sw), r, 8);
  const n = Math.max(2, Math.round(len / size));
  for (let k = 0; k < n; k++) {
    const t0 = k / n, t1 = (k + 1) / n;
    for (let e = 0; e < 4; e++) {
      const [a1, b1] = corners[e];
      const [a2, b2] = corners[(e + 1) % 4];
      tube(b, at(k % 2 ? t0 : t1, a1, b1), at(k % 2 ? t1 : t0, a2, b2), r * 0.6, 5);
    }
  }
}

export function buildCrescendoField(ctx: SeasonContext): CrescendoFieldRefs {
  const b = ctx.builder;
  const { L, W } = C;
  const refs: CrescendoFieldRefs = {
    speakerLights: { blue: [], red: [] },
    subwooferBars: { blue: [], red: [] },
    ampLights: {} as CrescendoFieldRefs['ampLights'],
    highNotes: { blue: [], red: [] },
    spotlights: { blue: [], red: [] },
    trapNotes: { blue: [], red: [] },
    ampNotes: {} as CrescendoFieldRefs['ampNotes'],
  };
  const tags: TagPose[] = [];
  const toWorld = (x: number, y: number, z: number) => ctx.frame.toWorld(x, y, z);

  b.carpet(C.COLORS.carpet);
  b.tape(L / 2, 0, L / 2, W, C.TAPE, 0xffffff); // CENTER LINE [M 5.2]

  // Guardrails [M 5.1]: 20 in polycarbonate. The AMP housing replaces the rail along its width.
  const rail = (x0: number, x1: number, y: number) => {
    if (x1 - x0 < 0.02) return;
    b.box([(x0 + x1) / 2, y, C.GUARDRAIL_HEIGHT / 2], [x1 - x0, inch(1), C.GUARDRAIL_HEIGHT], { color: C.COLORS.poly, opacity: 0.25 });
    for (const z of [inch(0.75), C.GUARDRAIL_HEIGHT - inch(0.75)]) b.box([(x0 + x1) / 2, y, z], [x1 - x0, inch(1.6), inch(1.5)], { color: C.COLORS.steel, collide: false, metalness: 0.6 });
    for (let x = x0; x <= x1 + 1e-6; x += 1.2) b.box([x, y, C.GUARDRAIL_HEIGHT / 2], [inch(1.5), inch(1.6), C.GUARDRAIL_HEIGHT], { color: C.COLORS.steel, collide: false, metalness: 0.6 });
  };
  rail(C.SOURCE_WALL_END_X, L - C.SOURCE_WALL_END_X, -inch(0.5));
  rail(0, C.AMP_FROM_WALL, W + inch(0.5));
  rail(C.AMP_FROM_WALL + C.AMP_WIDTH, L - C.AMP_FROM_WALL - C.AMP_WIDTH, W + inch(0.5));
  rail(L - C.AMP_FROM_WALL, L, W + inch(0.5));

  // Ring markers on CENTER LINE SPIKE MARKS (black marker) [M 5.2].
  for (const p of C.centerSpikes()) b.box([p.x, p.y, 0.0016], [inch(1.5), inch(1.5), 0.002], { color: 0x111111, collide: false, castShadow: false });

  for (const a of ALLIANCES) {
    const color = C.COLORS[a];
    const blue = a === 'blue';
    const s = (x: number, y: number) => C.side(a, x, y);
    const face = C.sideYaw(a, 0); // direction from this wall into the field

    // ── Tape: WING line, STARTING ZONE, AMP ZONE, SPIKE MARKS, STAGE ZONE ──
    const wing = s(C.WING_DEPTH, 0);
    b.tape(wing.x, 0, wing.x, W, C.TAPE, color);
    const sz = C.startZone(a);
    b.tape(sz[1].x, sz[1].y, sz[2].x, sz[2].y, C.TAPE, 0x111111);
    const az = C.ampZone(a);
    b.tape(az[0].x, az[0].y, az[1].x, az[1].y, C.TAPE, color);
    b.tape(az[1].x, az[1].y, az[2].x, az[2].y, C.TAPE, color);
    for (const p of C.wingSpikes(a)) {
      b.tape(p.x - inch(3), p.y, p.x + inch(3), p.y, C.TAPE, 0x111111);
      b.tape(p.x, p.y - inch(3), p.x, p.y + inch(3), C.TAPE, 0x111111);
    }
    const zone = C.stageZone(a);
    for (let i = 0; i < zone.length; i++) {
      const p = zone[i], q = zone[(i + 1) % zone.length];
      b.tape(p.x, p.y, q.x, q.y, C.TAPE, color);
    }
    // SOURCE ZONE tape (this alliance's SOURCE sits at the opponent's end).
    const srcZone = C.sourceZone(a);
    b.tape(srcZone[2].x, srcZone[2].y, srcZone[3].x, srcZone[3].y, C.TAPE, color);
    // Human-side markings outside the FIELD: STARTING LINE (2 ft behind the wall) and ALLIANCE AREA edge.
    const sl0 = s(-C.STARTING_LINE, C.WALL_SOURCE_END_Y - inch(60)), sl1 = s(-C.STARTING_LINE, W);
    b.tape(sl0.x, sl0.y, sl1.x, sl1.y, C.TAPE, 0xffffff);
    const aa0 = s(-C.ALLIANCE_AREA_DEPTH, 0), aa1 = s(-C.ALLIANCE_AREA_DEPTH, W);
    b.tape(aa0.x, aa0.y, aa1.x, aa1.y, C.TAPE, color);

    // ── ALLIANCE WALL: 3 DRIVER STATIONS + the SPEAKER section [M 5.6] ──
    for (const [k, [y0, y1]] of C.DS_SPANS.entries()) {
      sideBox(b, a, [-inch(3), y0, 0], [0, y1, inch(36.75)], { color: 0x8d949c, metalness: 0.5, roughness: 0.5 });
      sideBox(b, a, [-inch(3), y0, inch(36.75)], [0, y1, C.DS_HEIGHT], { color: C.COLORS.poly, opacity: 0.22 });
      sideBox(b, a, [-inch(3), y0, C.DS_HEIGHT - inch(1.5)], [0, y1, C.DS_HEIGHT], { color: C.COLORS.steel, collide: false });
      sideBox(b, a, [-inch(15), y0 + inch(2), inch(34)], [-inch(3), y1 - inch(2), inch(35.5)], { color: 0x9aa1a8, collide: false });
      const lp = s(inch(0.3), (y0 + y1) / 2);
      b.label([lp.x, lp.y, inch(30)], `${a.toUpperCase()} ${k + 1}`, 0.16, face);
      // Team sign + LED stack on top.
      const sp = s(-inch(1.5), (y0 + y1) / 2);
      b.box([sp.x, sp.y, C.DS_HEIGHT + inch(6)], [inch(1), inch(30), inch(10)], { color: 0x15181c, collide: false });
    }
    // Wall below the SPEAKER opening (top edge = lowest edge of the opening, 6 ft 6 in).
    const ys0 = C.SPEAKER_Y - C.SPEAKER_SECTION_HALF, ys1 = C.SPEAKER_Y + C.SPEAKER_SECTION_HALF;
    sideBox(b, a, [-inch(3), ys0, 0], [0, ys1, C.SPEAKER_OPENING_BOTTOM], { color: 0x2c3036, metalness: 0.3 });
    sideBox(b, a, [-inch(3.2), ys0, C.SPEAKER_OPENING_BOTTOM - inch(1.5)], [0.002, ys1, C.SPEAKER_OPENING_BOTTOM], { color: C.COLORS.steel, collide: false });

    // ── SUBWOOFER [M 5.6.1]: 6-faced, 3 ft 1 in tall, 3 ft ⅛ in deep; 8⅜ in vertical panels ──
    const sub: Vec3[] = [];
    for (const sy of [-1, 1]) {
      sub.push([0, sy * C.SUBWOOFER_BACK_HALF_WIDTH, 0], [C.SUBWOOFER_DEPTH, sy * C.SUBWOOFER_FRONT_HALF_WIDTH, 0]);
      sub.push([0, sy * C.SUBWOOFER_BACK_HALF_WIDTH, C.SUBWOOFER_PANEL], [C.SUBWOOFER_DEPTH, sy * C.SUBWOOFER_FRONT_HALF_WIDTH, C.SUBWOOFER_PANEL]);
      sub.push([0, sy * C.SUBWOOFER_FRONT_HALF_WIDTH, C.SUBWOOFER_HEIGHT]);
    }
    const subC = s(0, C.SPEAKER_Y);
    b.convex([subC.x, subC.y, 0], sub, { color, yaw: face, roughness: 0.6 });
    // Center inclined panel (vinyl-coated polycarbonate) and black vertical skirt, visual only.
    const incl: Vec3[] = [
      [C.SUBWOOFER_DEPTH + inch(0.2), -C.SUBWOOFER_FRONT_HALF_WIDTH + inch(1), C.SUBWOOFER_PANEL + inch(0.2)],
      [C.SUBWOOFER_DEPTH + inch(0.2), C.SUBWOOFER_FRONT_HALF_WIDTH - inch(1), C.SUBWOOFER_PANEL + inch(0.2)],
      [inch(0.5), -C.SUBWOOFER_FRONT_HALF_WIDTH + inch(1), C.SUBWOOFER_HEIGHT + inch(0.2)],
      [inch(0.5), C.SUBWOOFER_FRONT_HALF_WIDTH - inch(1), C.SUBWOOFER_HEIGHT + inch(0.2)],
      [C.SUBWOOFER_DEPTH - inch(1), -C.SUBWOOFER_FRONT_HALF_WIDTH + inch(1), C.SUBWOOFER_PANEL],
      [C.SUBWOOFER_DEPTH - inch(1), C.SUBWOOFER_FRONT_HALF_WIDTH - inch(1), C.SUBWOOFER_PANEL],
    ];
    b.convex([subC.x, subC.y, 0], incl, { color: 0xd9dde2, yaw: face, collide: false, roughness: 0.4 });
    const skirt = s(C.SUBWOOFER_DEPTH + inch(0.3), C.SPEAKER_Y);
    b.box([skirt.x, skirt.y, C.SUBWOOFER_PANEL / 2], [inch(0.4), C.SUBWOOFER_FRONT_HALF_WIDTH * 2, C.SUBWOOFER_PANEL], { color: 0x16181b, collide: false });
    // Light bar that recedes as AMPLIFICATION runs out (10 segments, one per second).
    for (let k = 0; k < 10; k++) {
      const off = (k - 4.5) * inch(3.2);
      const p = s(C.SUBWOOFER_DEPTH + inch(0.6), C.SPEAKER_Y + off);
      refs.subwooferBars[a].push(b.box([p.x, p.y, inch(4.2)], [inch(0.4), inch(2.6), inch(2)], { color, emissive: color, emissiveIntensity: 0.05, collide: false }).mesh!);
    }

    // ── SPEAKER hood [M 5.6.1]: opening 41⅜ in wide, 78 in (wall top) → 82⅞ in (lip, 18 in out) at 14° ──
    const hw = C.SPEAKER_OPENING_WIDTH / 2, HW = C.SPEAKER_HOOD_HALF_WIDTH;
    const lipX = C.SPEAKER_OPENING_DEPTH;
    const top = C.SPEAKER_HOOD_TOP;
    const hood = { color: 0x31353c, metalness: 0.3, roughness: 0.5 } as const;
    for (const sy of [-1, 1]) {
      const yA = C.SPEAKER_Y + sy * hw, yB = C.SPEAKER_Y + sy * HW;
      // Solid cheeks beside the opening (in front of the wall) and the cavity side walls behind it.
      sideBox(b, a, [0, Math.min(yA, yB), C.SPEAKER_OPENING_BOTTOM], [lipX, Math.max(yA, yB), top], hood);
      const yc0 = C.SPEAKER_Y + sy * hw, yc1 = yc0 + sy * inch(1);
      sideBox(b, a, [-C.SPEAKER_CAVITY_DEPTH, Math.min(yc0, yc1), inch(58)], [0, Math.max(yc0, yc1), top], { ...hood, collide: 'pieces' });
    }
    // Hood front above the lip, roof, cavity back wall and sloped catch floor behind the ALLIANCE WALL.
    sideBox(b, a, [lipX - inch(1.5), C.SPEAKER_Y - HW, C.SPEAKER_OPENING_TOP], [lipX, C.SPEAKER_Y + HW, top], hood);
    sideBox(b, a, [-C.SPEAKER_CAVITY_DEPTH - inch(1), C.SPEAKER_Y - HW, top], [lipX, C.SPEAKER_Y + HW, top + inch(1.5)], hood);
    sideBox(b, a, [-C.SPEAKER_CAVITY_DEPTH - inch(1), C.SPEAKER_Y - HW, inch(58)], [-C.SPEAKER_CAVITY_DEPTH, C.SPEAKER_Y + HW, top], { ...hood, collide: 'pieces' });
    const floorC = s(-C.SPEAKER_CAVITY_DEPTH / 2, C.SPEAKER_Y);
    b.box([floorC.x, floorC.y, inch(68)], [C.SPEAKER_CAVITY_DEPTH + inch(2), hw * 2, inch(1)], { ...hood, collide: 'pieces', pitch: blue ? 0.45 : -0.45 });
    // Dark interior + ALLIANCE-colored light strings along the hood [M 5.6.1].
    sideBox(b, a, [-inch(0.5), C.SPEAKER_Y - hw, C.SPEAKER_OPENING_BOTTOM], [lipX - inch(1.6), C.SPEAKER_Y + hw, top - inch(0.2)], { color: 0x07080a, collide: false, opacity: 0.85 });
    for (const z of [top - inch(3), top - inch(7)]) {
      refs.speakerLights[a].push(sideBox(b, a, [lipX, C.SPEAKER_Y - HW + inch(1), z - inch(0.6)], [lipX + inch(0.4), C.SPEAKER_Y + HW - inch(1), z + inch(0.6)], { color, emissive: color, emissiveIntensity: 0.05, collide: false }).mesh!);
    }
    // Speaker structure above the wall (visual body behind the hood).
    sideBox(b, a, [-inch(30), C.SPEAKER_Y - HW - inch(6), top + inch(1.5)], [lipX, C.SPEAKER_Y + HW + inch(6), top + inch(14)], { color: 0x1a1c20, collide: false });
    const sl = s(lipX + inch(0.3), C.SPEAKER_Y);
    b.label([sl.x, sl.y, top + inch(8)], `${a.toUpperCase()} SPEAKER`, 0.16, face, blue ? '#9cc0ff' : '#ffb3b3');
    // SPEAKER AprilTags [M 5.8]: panels bottom at 4 ft 3⅞ in; one centered, one toward DRIVER STATION 2.
    const tz = inch(51.875) + inch(10.5) / 2;
    const t0 = s(0.002, C.SPEAKER_Y), t1 = s(0.002, C.SPEAKER_Y - inch(17) - inch(10.5) / 2);
    tags.push({ id: blue ? 7 : 4, x: t0.x, y: t0.y, z: tz, yaw: face }, { id: blue ? 8 : 3, x: t1.x, y: t1.y, z: tz, yaw: face });

    // ── AMP [M 5.3]: pocket 24 × 18 × 3⅞ in, bottom 26 in; housing outside the FIELD boundary ──
    const ax0 = C.AMP_FROM_WALL, ax1 = ax0 + C.AMP_WIDTH;
    const px0 = C.AMP_X - C.AMP_POCKET_WIDTH / 2, px1 = C.AMP_X + C.AMP_POCKET_WIDTH / 2;
    const pz0 = C.AMP_POCKET_BOTTOM, pz1 = pz0 + C.AMP_POCKET_HEIGHT;
    const yF = W, yP = W + C.AMP_POCKET_DEPTH, yB = W + C.AMP_HOUSING_DEPTH;
    const ampMat = { color: 0x9aa3ad, metalness: 0.5, roughness: 0.45 } as const;
    sideBox(b, a, [ax0, yP, 0], [ax1, yB, C.AMP_HEIGHT], ampMat);
    sideBox(b, a, [ax0, yF, 0], [px0, yP, C.AMP_HEIGHT], ampMat);
    sideBox(b, a, [px1, yF, 0], [ax1, yP, C.AMP_HEIGHT], ampMat);
    sideBox(b, a, [px0, yF, 0], [px1, yP, pz0], ampMat);
    sideBox(b, a, [px0, yF, pz1], [px1, yP, C.AMP_HEIGHT], ampMat);
    sideBox(b, a, [px0, yP - inch(0.2), pz0], [px1, yP, pz1], { color: 0x0b0c0e, collide: false });
    sideBox(b, a, [ax0, yF - inch(0.3), 0], [ax1, yF, inch(8)], { color, collide: false });
    const ampTop = C.AMP_HEIGHT;
    const lightAt = (dx: number, z: number, col: number) => {
      const p = s(C.AMP_X + dx, W + inch(4));
      return b.box([p.x, p.y, z], [inch(3), inch(3), inch(3)], { color: col, emissive: col, emissiveIntensity: 0.05, collide: false }).mesh!;
    };
    refs.ampLights[a] = { bottom: lightAt(-inch(12), ampTop + inch(2), color), top: lightAt(-inch(12), ampTop + inch(5.2), color), coop: lightAt(inch(12), ampTop + inch(2), 0xffb000) };
    for (let k = 0; k < C.HIGH_NOTES_PER_ALLIANCE; k++) {
      const m = noteMesh(true);
      const p = s(C.AMP_X, W + C.AMP_HOUSING_DEPTH / 2);
      m.position.copy(toWorld(p.x, p.y, ampTop + inch(1) + k * inch(2.05)));
      m.rotation.x = Math.PI / 2;
      b.root.add(m);
      refs.highNotes[a].push(m);
    }
    const an = noteMesh(false);
    an.visible = false;
    b.root.add(an);
    refs.ampNotes[a] = an;
    const al = s(C.AMP_X, W - 0.003);
    b.label([al.x, al.y, pz1 + inch(12)], 'AMP', 0.12, -Math.PI / 2);
    const at = s(C.AMP_X, W - 0.002);
    tags.push({ id: blue ? 6 : 5, x: at.x, y: at.y, z: inch(48.125) + inch(10.5) / 2, yaw: -Math.PI / 2 });
    // Wire panel on top of the guardrail between the AMP and the ALLIANCE WALL [M 5.3].
    sideBox(b, a, [0, W, C.GUARDRAIL_HEIGHT], [C.AMP_FROM_WALL, W + inch(1), C.GUARDRAIL_HEIGHT + inch(24)], { color: 0x9aa3ad, opacity: 0.35, collide: 'pieces' });

    // ── SOURCE [M 5.4] at this end (it belongs to the OPPONENT) ──
    const owner: Alliance = blue ? 'red' : 'blue';
    const ownerColor = C.COLORS[owner];
    const w0 = s(0, C.WALL_SOURCE_END_Y), w1 = s(C.SOURCE_WALL_END_X, 0);
    const srcYaw = Math.atan2(w1.y - w0.y, w1.x - w0.x);
    const nIn = C.sideYaw(a, Math.atan2(C.SOURCE_NORMAL.y, C.SOURCE_NORMAL.x));
    const wallOff = (d: number) => ({ x: Math.cos(nIn) * d, y: Math.sin(nIn) * d });
    const mid = { x: (w0.x + w1.x) / 2, y: (w0.y + w1.y) / 2 };
    const back = wallOff(-inch(1));
    const len = C.SOURCE_WALL_LENGTH;
    const sBelow = C.SOURCE_OPENING_BOTTOM, sAbove = sBelow + C.SOURCE_OPENING_HEIGHT;
    b.box([mid.x + back.x, mid.y + back.y, sBelow / 2], [len, inch(2), sBelow], { color: 0x5d646c, yaw: srcYaw, metalness: 0.4 });
    b.box([mid.x + back.x, mid.y + back.y, (sAbove + C.SOURCE_WALL_HEIGHT) / 2], [len, inch(2), C.SOURCE_WALL_HEIGHT - sAbove], { color: C.COLORS.poly, opacity: 0.35, yaw: srcYaw });
    b.box([mid.x + back.x, mid.y + back.y, (sBelow + sAbove) / 2], [len, inch(2), sAbove - sBelow], { visible: false, collide: 'robots', yaw: srcYaw });
    b.box([mid.x + back.x, mid.y + back.y, sBelow - inch(1)], [C.SOURCE_OPENING_WIDTH, inch(2.4), inch(2)], { color: ownerColor, collide: false, yaw: srcYaw });
    // 50° CHUTE sloping up away from the field.
    const chute = wallOff(-inch(14));
    b.box([mid.x + chute.x, mid.y + chute.y, sAbove + inch(10)], [C.SOURCE_OPENING_WIDTH, inch(30), inch(1)], { color: 0x8c96a0, yaw: srcYaw, roll: (blue ? 1 : -1) * (50 * Math.PI) / 180, collide: false, opacity: 0.8 });
    const lblP = wallOff(inch(0.5));
    b.label([mid.x + lblP.x, mid.y + lblP.y, C.SOURCE_WALL_HEIGHT - inch(10)], `${owner.toUpperCase()} SOURCE`, 0.14, nIn, owner === 'blue' ? '#9cc0ff' : '#ffb3b3');
    // SOURCE AprilTags: bottom 4 ft ⅛ in, 1 ft 7⅜ in either side of the SOURCE center [M 5.8].
    const tagOff = (inch(19.375) + inch(10.5) / 2) / len;
    const srcTag = (t: number) => {
      const p = { x: w0.x + (w1.x - w0.x) * t + Math.cos(nIn) * 0.004, y: w0.y + (w1.y - w0.y) * t + Math.sin(nIn) * 0.004 };
      return p;
    };
    const nearWall = srcTag(0.5 - tagOff), nearRail = srcTag(0.5 + tagOff);
    const tagZ = inch(48.125) + inch(10.5) / 2;
    // Figure 5-19: red SOURCE (blue end) ID 9 by the wall, 10 by the rail; blue SOURCE ID 2 by the wall, 1 by the rail.
    tags.push({ id: blue ? 9 : 2, x: nearWall.x, y: nearWall.y, z: tagZ, yaw: nIn }, { id: blue ? 10 : 1, x: nearRail.x, y: nearRail.y, z: tagZ, yaw: nIn });

    buildStage(b, ctx, a, refs, tags);
  }

  const merged = mergeGeometries(trussParts.splice(0));
  if (merged) {
    const mesh = new THREE.Mesh(merged, b.material({ color: C.COLORS.truss, metalness: 0.7, roughness: 0.35 }));
    mesh.castShadow = true;
    mesh.name = 'stage-trusses';
    b.root.add(mesh);
  }

  addAprilTags(b, {
    field: { length: L, width: W },
    tags: tags.map((t) => ({ ID: t.id, pose: { translation: { x: t.x, y: t.y, z: t.z }, rotation: { quaternion: { W: Math.cos(t.yaw / 2), X: 0, Y: 0, Z: Math.sin(t.yaw / 2) } } } })),
  }, inch(10.5));
  return refs;
}

/** STAGE [M 5.5]: 3 truss legs, perimeter/radial trusses, suspended hexagonal core, TRAPS, MICROPHONES, chains. */
function buildStage(b: FieldBuilder, ctx: SeasonContext, a: Alliance, refs: CrescendoFieldRefs, tags: TagPose[]): void {
  const color = C.COLORS[a];
  const legs = C.LEG_LOCAL.map(([x, y]) => C.stagePoint(a, x, y));
  const center = C.stageCenter(a);
  for (const [k, p] of legs.entries()) {
    const yaw = Math.atan2(p.y - center.y, p.x - center.x);
    truss(b, [p.x, p.y, 0], [p.x, p.y, C.STAGE_TRUSS_TOP], C.STAGE_LEG_SIZE);
    b.box([p.x, p.y, inch(0.25)], [C.STAGE_FOOT_SIZE, C.STAGE_FOOT_SIZE, inch(0.5)], { color: 0x6e757d, yaw, metalness: 0.6 });
    // Top junction block.
    b.box([p.x, p.y, (C.STAGE_TRUSS_BOTTOM + C.STAGE_TRUSS_TOP) / 2], [C.STAGE_LEG_SIZE + inch(2), C.STAGE_LEG_SIZE + inch(2), C.STAGE_TRUSS_TOP - C.STAGE_TRUSS_BOTTOM], { color: C.COLORS.truss, yaw, metalness: 0.6, collide: 'pieces' });
    // Radial truss from the leg to the core.
    const inner = { x: center.x + (p.x - center.x) * 0.3, y: center.y + (p.y - center.y) * 0.3 };
    const zMid = (C.STAGE_TRUSS_BOTTOM + C.STAGE_TRUSS_TOP) / 2;
    truss(b, [p.x, p.y, zMid], [inner.x, inner.y, zMid], C.STAGE_TRUSS_TOP - C.STAGE_TRUSS_BOTTOM, 'pieces');
    if (k === 0) {
      // PODIUM: ALLIANCE-colored HDPE panel on the leg facing the ALLIANCE WALL, just above the truss foot.
      const pod = C.podium(a);
      b.box([pod.x, pod.y, inch(1) + C.PODIUM_HEIGHT / 2], [inch(0.6), C.PODIUM_WIDTH, C.PODIUM_HEIGHT], { color, collide: 'robots' });
    }
  }
  // Perimeter trusses above each chain (the CRESCENDO signs hang on them).
  for (let c = 0; c < 3; c++) {
    const g = C.chainGeometry(a, c);
    const zMid = (C.STAGE_TRUSS_BOTTOM + C.STAGE_TRUSS_TOP) / 2;
    const inset = C.STAGE_LEG_SIZE / 2 / g.span;
    const q0 = { x: g.p0.x + (g.p1.x - g.p0.x) * inset, y: g.p0.y + (g.p1.y - g.p0.y) * inset };
    const q1 = { x: g.p1.x - (g.p1.x - g.p0.x) * inset, y: g.p1.y - (g.p1.y - g.p0.y) * inset };
    truss(b, [q0.x, q0.y, zMid], [q1.x, q1.y, zMid], C.STAGE_TRUSS_TOP - C.STAGE_TRUSS_BOTTOM, 'pieces');
    if (c === 1 || c === 2) {
      const sign = { x: g.mid.x + Math.cos(g.normal) * inch(7), y: g.mid.y + Math.sin(g.normal) * inch(7) };
      b.label([sign.x, sign.y, C.STAGE_TRUSS_BOTTOM - inch(8)], 'CRESCENDO', 0.2, g.normal, '#46e3a0', 'rgba(8,20,16,0.9)');
    }
    // Chain: ¼ in chain drooping from 4 ft anchors to 2 ft 4¼ in, hung on the chain line [M 5.5].
    const anchor = C.STAGE_LEG_SIZE / 2 + inch(1);
    const e0 = { x: g.p0.x + Math.cos(g.dir) * anchor, y: g.p0.y + Math.sin(g.dir) * anchor };
    const e1 = { x: g.p1.x - Math.cos(g.dir) * anchor, y: g.p1.y - Math.sin(g.dir) * anchor };
    const pts: THREE.Vector3[] = [];
    for (let k = 0; k <= 24; k++) {
      const t = k / 24;
      const z = C.CHAIN_LOW_POINT + (C.CHAIN_ANCHOR_HEIGHT - C.CHAIN_LOW_POINT) * (2 * t - 1) ** 2;
      pts.push(ctx.frame.toWorld(e0.x + (e1.x - e0.x) * t, e0.y + (e1.y - e0.y) * t, z));
    }
    const chain = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 48, inch(0.35), 6), b.material({ color: 0xd8dde3, metalness: 0.85, roughness: 0.3 }));
    chain.castShadow = true;
    chain.name = `${a}-chain-${c}`;
    b.root.add(chain);
  }
  // Core: 6-sided column hung so its underside clears 2 ft 3⅞ in.
  const core = C.coreLocal();
  const hull: Vec3[] = [];
  for (const z of [C.STAGE_CLEARANCE, C.STAGE_CORE_TOP]) for (const [x, y] of core) {
    const p = C.stagePoint(a, x, y);
    hull.push([p.x - center.x, p.y - center.y, z]);
  }
  b.convex([center.x, center.y, 0], hull, { color: C.COLORS.poly, opacity: 0.45 });
  for (let c = 0; c < 3; c++) {
    const n = C.sideYaw(a, C.CHAINS[c].normal);
    const f = C.stagePoint(a, C.CORE_APOTHEM * Math.cos(C.CHAINS[c].normal), C.CORE_APOTHEM * Math.sin(C.CHAINS[c].normal));
    const out = (d: number) => ({ x: f.x + Math.cos(n) * d, y: f.y + Math.sin(n) * d });
    // TRAP opening (flap) above the AprilTag; the TRAP is the frame behind it [M 5.5].
    const trap = out(inch(0.3));
    b.box([trap.x, trap.y, C.TRAP_OPENING_BOTTOM + inch(6)], [inch(0.4), C.TRAP_WIDTH, inch(12)], { color: 0x101317, yaw: n, collide: false, opacity: 0.9 });
    for (const dz of [0, inch(12)]) b.box([trap.x, trap.y, C.TRAP_OPENING_BOTTOM + dz], [inch(1.2), C.TRAP_WIDTH + inch(2), inch(1)], { color: C.COLORS.steel, yaw: n, collide: false });
    const tn = noteMesh(false);
    const tp = C.trapPoint(a, c);
    tn.position.copy(ctx.frame.toWorld(tp.x, tp.y, tp.z));
    tn.rotation.set(0, n, 0);
    tn.rotateY(Math.PI / 2);
    tn.visible = false;
    b.root.add(tn);
    refs.trapNotes[a].push(tn);
    // STAGE AprilTags 11–16 on each wide face [M 5.8]; blue 14 (center) / 15 (left) / 16 (right); red 13 / 12 / 11.
    const tag = out(inch(0.6));
    tags.push({ id: (a === 'blue' ? [14, 15, 16] : [13, 12, 11])[c], x: tag.x, y: tag.y, z: C.STAGE_TAG_BOTTOM + inch(10.5) / 2, yaw: n });
    // MICROPHONE: 1 ft pipe (1.66 in OD) above the TRAP; top at 7 ft 4¼ in.
    const mic = C.micPoint(a, c);
    b.cylinder([mic.x, mic.y, C.MIC_TOP - C.MIC_LENGTH], [mic.x, mic.y, C.MIC_TOP], C.MIC_RADIUS, { color: 0xc9ced4, metalness: 0.8, collide: false }, 12);
    const spot = noteMesh(true);
    spot.position.copy(ctx.frame.toWorld(mic.x, mic.y, C.MIC_TOP - C.MIC_LENGTH + C.NOTE_THICKNESS / 2 + inch(0.2)));
    spot.rotation.x = Math.PI / 2;
    spot.visible = false;
    b.root.add(spot);
    refs.spotlights[a].push(spot);
  }
}
