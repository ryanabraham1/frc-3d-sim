import * as THREE from 'three';
import type { Alliance, FieldPoint } from '@engine/coords';
import { FieldBuilder, Vec3 } from '@engine/field/builder';
import { addAprilTags, AprilTagLayout } from '@engine/field/apriltags';
import { deg, inch } from '@engine/units';
import layoutJson from './apriltags-welded.json';
import * as C from './constants';

/** Map a BLUE-side field point to the given alliance (rotational symmetry). */
export function side(alliance: Alliance, x: number, y: number): FieldPoint {
  return alliance === 'blue' ? { x, y } : { x: C.FIELD_LENGTH - x, y: C.FIELD_WIDTH - y };
}
export const sideYaw = (alliance: Alliance, yaw: number): number => (alliance === 'blue' ? yaw : yaw + Math.PI);
/** +1 for blue (field +x points away from its wall), -1 for red. */
export const dir = (alliance: Alliance): number => (alliance === 'blue' ? 1 : -1);

export interface HubRefs {
  center: FieldPoint;
  lights: THREE.MeshStandardMaterial;
}

export interface RebuiltFieldRefs {
  hubs: Record<Alliance, HubRefs>;
  chuteDoors: Record<Alliance, THREE.Mesh>;
}

const V = (p: FieldPoint, z: number): Vec3 => [p.x, p.y, z];

export function buildRebuiltField(b: FieldBuilder): RebuiltFieldRefs {
  const L = C.FIELD_LENGTH;
  const W = C.FIELD_WIDTH;
  b.carpet(C.COLORS.carpet, 0.9);

  // ── Tape lines ────────────────────────────────────────────────────────────
  b.tape(C.CENTER_X, 0, C.CENTER_X, W, C.TAPE_WIDTH, C.COLORS.white); // CENTER LINE
  for (const a of ['blue', 'red'] as Alliance[]) {
    const col = C.COLORS[a];
    const sx = side(a, C.ALLIANCE_ZONE_DEPTH - C.TAPE_WIDTH / 2, 0).x;
    b.tape(sx, 0, sx, W, C.TAPE_WIDTH, col); // ROBOT STARTING LINE
    // OUTPOST AREA marking on the field side of the outpost
    const o0 = side(a, 0, 0);
    const o1 = side(a, inch(24), C.OUTPOST_AREA_WIDTH);
    b.tape(o0.x, o1.y, o1.x, o1.y, C.TAPE_WIDTH, col);
    // Depot outline
    const d0 = side(a, 0, C.DEPOT_CENTER_Y - C.DEPOT_WIDTH / 2);
    const d1 = side(a, C.DEPOT_DEPTH, C.DEPOT_CENTER_Y + C.DEPOT_WIDTH / 2);
    b.tapeRect(d0.x, d0.y, d1.x, d1.y, inch(1), col);
  }

  // ── Guardrails (y = 0 and y = W) ─────────────────────────────────────────
  for (const y of [0, W]) {
    const out = y === 0 ? -1 : 1;
    const yc = y + (out * inch(1.5)) / 2;
    b.box([L / 2, yc, C.GUARDRAIL_HEIGHT / 2], [L, inch(1.5), C.GUARDRAIL_HEIGHT], { color: C.COLORS.poly, opacity: 0.18, castShadow: false });
    b.box([L / 2, yc, C.GUARDRAIL_HEIGHT - inch(0.75)], [L, inch(1.8), inch(1.5)], { color: C.COLORS.alu, metalness: 0.7, roughness: 0.35, collide: false });
    b.box([L / 2, yc, inch(0.75)], [L, inch(1.8), inch(1.5)], { color: C.COLORS.alu, metalness: 0.7, roughness: 0.35, collide: false });
    // Invisible catch-net so FUEL rarely leaves the field
    b.box([L / 2, y + out * 0.05, 1.6], [L + 1, 0.1, 2.4], { visible: false, collide: 'pieces' });
  }

  const refs: RebuiltFieldRefs = {
    hubs: {} as Record<Alliance, HubRefs>,
    chuteDoors: {} as Record<Alliance, THREE.Mesh>,
  };

  for (const a of ['blue', 'red'] as Alliance[]) {
    buildAllianceWall(b, a, refs);
    refs.hubs[a] = buildHub(b, a);
    buildBumpsAndTrenches(b, a);
    buildDepot(b, a);
    buildTower(b, a);
  }

  addAprilTags(b, layoutJson as AprilTagLayout);
  return refs;
}

// ─────────────────────────────────────────────────────────────────────────────

function buildAllianceWall(b: FieldBuilder, a: Alliance, refs: RebuiltFieldRefs): void {
  const col = C.COLORS[a];
  const W = C.FIELD_WIDTH;
  const t = C.WALL_THICK;
  const wx = side(a, -t / 2, 0).x; // wall center x (behind the field boundary)
  const plate = { color: C.COLORS.darkSteel, metalness: 0.6, roughness: 0.45 };
  const poly = { color: C.COLORS.poly, opacity: 0.2, castShadow: false };
  const oStart = side(a, 0, 0).y; // outpost end of the wall
  const outpostSpan = C.OUTPOST_AREA_WIDTH;

  // Main wall segment (everything except the OUTPOST section).
  const segY0 = a === 'blue' ? outpostSpan : 0;
  const segY1 = a === 'blue' ? W : W - outpostSpan;
  const segC = (segY0 + segY1) / 2;
  const segW = segY1 - segY0;
  b.box([wx, segC, C.WALL_BASE_HEIGHT / 2], [t, segW, C.WALL_BASE_HEIGHT], plate);
  b.box([wx, segC, C.WALL_BASE_HEIGHT + (C.WALL_HEIGHT - C.WALL_BASE_HEIGHT) / 2], [t, segW, C.WALL_HEIGHT - C.WALL_BASE_HEIGHT], poly);
  b.box([wx, segC, C.WALL_HEIGHT], [t * 1.4, segW, inch(2)], { ...plate, collide: false });
  b.box([wx, W / 2, 2.6], [t, W + 1, 1.4], { visible: false, collide: 'pieces' });

  // Alliance-colored stripe + driver station team-sign placeholders.
  const stripeX = side(a, 0.003, 0).x;
  b.box([stripeX, segC, C.WALL_BASE_HEIGHT - inch(3)], [0.006, segW, inch(3)], { color: col, collide: false, castShadow: false });
  // Driver station numbers on the field-facing side of the wall base.
  for (let i = 0; i < 3; i++) {
    const p = side(a, 0.004, C.DS_Y_BLUE[i]);
    b.label([p.x, p.y, C.WALL_BASE_HEIGHT - inch(10)], `${a === 'blue' ? 'BLUE' : 'RED'} ${i + 1}`, inch(6), a === 'blue' ? 0 : Math.PI, a === 'blue' ? '#8fb8ff' : '#ff9a9a');
  }

  // OUTPOST section: wall with CHUTE opening (upper) and CORRAL opening (floor).
  const oc = side(a, 0, C.OUTPOST_CENTER_Y).y;
  const sgn = a === 'blue' ? 1 : -1; // +y direction along the outpost span from its guardrail end
  const secY0 = oStart;
  const secY1 = oStart + sgn * outpostSpan;
  const opLo = oc - C.CHUTE_OPENING_W / 2;
  const opHi = oc + C.CHUTE_OPENING_W / 2;
  const yMin = Math.min(secY0, secY1);
  const yMax = Math.max(secY0, secY1);
  const x0 = Math.min(side(a, 0, 0).x, side(a, -t, 0).x);
  const x1 = Math.max(side(a, 0, 0).x, side(a, -t, 0).x);
  const wallBox = (ya: number, yb: number, za: number, zb: number, o: object) =>
    zb > za && yb > ya && b.boxMinMax([x0, ya, za], [x1, yb, zb], o);
  wallBox(yMin, opLo, 0, C.WALL_HEIGHT, plate);
  wallBox(opHi, yMax, 0, C.WALL_HEIGHT, plate);
  wallBox(opLo, opHi, 0, C.CORRAL_OPENING_Z, plate);
  wallBox(opLo, opHi, C.CORRAL_OPENING_Z + C.CORRAL_OPENING_H, C.CHUTE_OPENING_Z, plate);
  wallBox(opLo, opHi, C.CHUTE_OPENING_Z + C.CHUTE_OPENING_H, C.WALL_HEIGHT, { ...plate });
  b.cylinder([side(a, -t / 2, 0).x, oc, 0], [side(a, -t / 2, 0).x, oc, C.CORRAL_OPENING_Z + C.CORRAL_OPENING_H], C.RUNG_OD / 2, { color: C.COLORS.steel });
  // Colored frames around openings
  for (const [z, h] of [
    [C.CHUTE_OPENING_Z, C.CHUTE_OPENING_H],
    [C.CORRAL_OPENING_Z, C.CORRAL_OPENING_H],
  ] as const) {
    const fx = side(a, 0.004, 0).x;
    b.box([fx, oc, z - inch(0.5)], [0.008, C.CHUTE_OPENING_W + inch(2), inch(1)], { color: col, collide: false });
    b.box([fx, oc, z + h + inch(0.5)], [0.008, C.CHUTE_OPENING_W + inch(2), inch(1)], { color: col, collide: false });
  }

  // CORRAL behind the wall (FUEL pushed through the floor opening lands here).
  const cd = C.CORRAL_DEPTH;
  const cw = C.CORRAL_WIDTH;
  const cBack = side(a, -t - cd, 0).x;
  const cFront = side(a, -t, 0).x;
  const cx = (cBack + cFront) / 2;
  const cpoly = { color: C.COLORS.poly, opacity: 0.25, castShadow: false };
  b.box([cBack, oc, C.CORRAL_WALL_H / 2], [inch(0.5), cw, C.CORRAL_WALL_H], cpoly);
  b.box([cx, oc - cw / 2, C.CORRAL_WALL_H / 2], [cd, inch(0.5), C.CORRAL_WALL_H], cpoly);
  b.box([cx, oc + cw / 2, C.CORRAL_WALL_H / 2], [cd, inch(0.5), C.CORRAL_WALL_H], cpoly);

  // CHUTE: 15° ramp behind the upper opening (visual + holds nothing physically; FUEL is a counter).
  const chuteLen = 1.3;
  const chuteMid = side(a, -t - (chuteLen / 2) * Math.cos(deg(15)), 0).x;
  b.box([chuteMid, oc, C.CHUTE_OPENING_Z + (chuteLen / 2) * Math.sin(deg(15))], [chuteLen, C.CHUTE_OPENING_W, inch(0.5)], {
    color: C.COLORS.alu,
    pitch: a === 'blue' ? -deg(15) : deg(15),
    collide: false,
  });
  // CHUTE DOOR (rotated by the human player; animated by rules)
  const door = b.box([side(a, -t - inch(1), 0).x, oc, C.CHUTE_OPENING_Z + C.CHUTE_OPENING_H / 2], [inch(0.75), C.CHUTE_OPENING_W, C.CHUTE_OPENING_H], {
    color: 0xffffff,
    collide: false,
  }).mesh!;
  refs.chuteDoors[a] = door;
  b.label([side(a, 0.01, 0).x, oc, C.WALL_BASE_HEIGHT + inch(10)], 'OUTPOST', inch(5), a === 'blue' ? 0 : Math.PI, a === 'blue' ? '#8fb8ff' : '#ff8f8f');
}

function buildHub(b: FieldBuilder, a: Alliance): HubRefs {
  const c = side(a, C.HUB_CENTER.x, C.HUB_CENTER.y);
  const hs = C.HUB_SIZE / 2;
  const col = C.COLORS[a];
  const body = { color: 0x2e3440, metalness: 0.3, roughness: 0.6 };
  // Solid lower body
  b.box([c.x, c.y, C.HUB_CUP_FLOOR / 2], [C.HUB_SIZE, C.HUB_SIZE, C.HUB_CUP_FLOOR], body);
  // Cup walls above the internal floor
  const cupH = C.HUB_RIM_HEIGHT - C.HUB_CUP_FLOOR;
  const zc = C.HUB_CUP_FLOOR + cupH / 2;
  const w = C.HUB_WALL;
  const wallMat = { color: col, metalness: 0.2, roughness: 0.6 };
  b.box([c.x - hs + w / 2, c.y, zc], [w, C.HUB_SIZE, cupH], wallMat);
  b.box([c.x + hs - w / 2, c.y, zc], [w, C.HUB_SIZE, cupH], wallMat);
  b.box([c.x, c.y - hs + w / 2, zc], [C.HUB_SIZE - 2 * w, w, cupH], wallMat);
  b.box([c.x, c.y + hs - w / 2, zc], [C.HUB_SIZE - 2 * w, w, cupH], wallMat);
  // Inner floor (sensor array) — slightly lighter
  b.box([c.x, c.y, C.HUB_CUP_FLOOR + 0.005], [C.HUB_SIZE - 2 * w, C.HUB_SIZE - 2 * w, 0.01], { color: 0x444c58, collide: false });

  // Hexagonal opening funnel (visual)
  const hex = new THREE.Mesh(
    new THREE.CylinderGeometry(C.HUB_OPENING_HEX / Math.sqrt(3), C.HUB_OPENING_HEX / Math.sqrt(3) + 0.03, inch(4), 6, 1, true),
    new THREE.MeshStandardMaterial({ color: 0xdddddd, metalness: 0.5, roughness: 0.4, side: THREE.DoubleSide }),
  );
  b.frame.toWorld(c.x, c.y, C.HUB_RIM_HEIGHT + inch(2), hex.position);
  hex.rotation.y = Math.PI / 6;
  b.root.add(hex);

  // Light bars along the top edges
  const lights = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: col, emissiveIntensity: 0.1 });
  const lb = inch(1.5);
  b.box([c.x - hs, c.y, C.HUB_RIM_HEIGHT + lb / 2], [lb, C.HUB_SIZE, lb], { material: lights, collide: false });
  b.box([c.x + hs, c.y, C.HUB_RIM_HEIGHT + lb / 2], [lb, C.HUB_SIZE, lb], { material: lights, collide: false });
  b.box([c.x, c.y - hs, C.HUB_RIM_HEIGHT + lb / 2], [C.HUB_SIZE, lb, lb], { material: lights, collide: false });
  b.box([c.x, c.y + hs, C.HUB_RIM_HEIGHT + lb / 2], [C.HUB_SIZE, lb, lb], { material: lights, collide: false });

  // Net on the neutral-zone side (stops FUEL launched from prohibited areas)
  const nx = c.x + dir(a) * (hs + inch(1));
  b.box([nx, c.y, C.HUB_RIM_HEIGHT + C.HUB_NET_HEIGHT / 2], [inch(1), C.HUB_SIZE + inch(6), C.HUB_NET_HEIGHT], {
    color: C.COLORS.net,
    opacity: 0.35,
    collide: 'pieces',
    castShadow: false,
  });
  for (const s of [-1, 1]) {
    b.cylinder([nx, c.y + s * (hs + inch(3)), C.HUB_RIM_HEIGHT], [nx, c.y + s * (hs + inch(3)), C.HUB_RIM_HEIGHT + C.HUB_NET_HEIGHT], inch(0.75), {
      color: C.COLORS.alu,
      collide: false,
    });
  }

  // Exit openings at the base (neutral-zone face)
  const ex = c.x + dir(a) * (hs + 0.003);
  for (let i = 0; i < C.HUB_EXIT_COUNT; i++) {
    const oy = c.y + (i - (C.HUB_EXIT_COUNT - 1) / 2) * (C.HUB_SIZE / C.HUB_EXIT_COUNT);
    b.box([ex, oy, inch(4)], [0.004, inch(8), inch(7)], { color: 0x0a0a0a, collide: false, castShadow: false });
  }
  // Alliance label on the alliance-facing side
  b.label([c.x - dir(a) * (hs + 0.004), c.y, inch(30)], 'HUB', inch(6), a === 'blue' ? Math.PI : 0, '#ffffff');
  return { center: c, lights };
}

function buildBumpsAndTrenches(b: FieldBuilder, a: Alliance): void {
  const hub = side(a, C.HUB_CENTER.x, C.HUB_CENTER.y);
  const hs = C.HUB_SIZE / 2;
  const col = C.COLORS[a];
  // BUMPs: triangular prisms (15° ramps) either side of the hub.
  const hd = C.BUMP_DEPTH / 2;
  const hw = C.BUMP_WIDTH / 2;
  const h = Math.min(C.BUMP_HEIGHT, hd * Math.tan(deg(C.BUMP_RAMP_DEG)) + inch(0.5));
  for (const s of [-1, 1]) {
    const yc = hub.y + s * (hs + hw);
    b.convex(
      [hub.x, yc, 0],
      [
        [-hd, -hw, 0],
        [hd, -hw, 0],
        [-hd, hw, 0],
        [hd, hw, 0],
        [0, -hw, h],
        [0, hw, h],
      ],
      { color: col, roughness: 0.85, friction: 0.7 },
    );
  }

  // TRENCHes along both guardrails.
  const td = C.TRENCH_DEPTH;
  const frame = { color: C.COLORS.darkSteel, metalness: 0.5, roughness: 0.5 };
  for (const g of [0, 1]) {
    // g=0: guardrail nearest to this alliance's y=0-side (blue y=0 / red y=W)
    const y0 = g === 0 ? 0 : C.FIELD_WIDTH;
    const s = g === 0 ? 1 : -1; // direction from guardrail toward field center
    const yRail = side(a, 0, y0).y;
    const sd = a === 'blue' ? s : -s;
    const openEnd = yRail + sd * (C.TRENCH_OPENING_CENTER_Y * 2);
    const bumpEdge = hub.y - sd * (hs + C.BUMP_WIDTH);
    const trenchEnd = yRail + sd * C.TRENCH_WIDTH;
    // Arm over the opening
    const armLo = Math.min(yRail, trenchEnd);
    const armHi = Math.max(yRail, trenchEnd);
    b.boxMinMax([hub.x - td / 2, armLo, C.TRENCH_CLEARANCE], [hub.x + td / 2, armHi, C.TRENCH_CLEARANCE + C.TRENCH_ARM_THICKNESS], {
      ...frame,
      color: g === 0 ? C.COLORS.darkSteel : 0x454b55,
    });
    // Alliance stripe on the arm faces
    for (const fs of [-1, 1]) {
      b.boxMinMax([hub.x + fs * (td / 2) - 0.003, armLo, C.TRENCH_CLEARANCE + inch(1)], [hub.x + fs * (td / 2) + 0.003, armHi, C.TRENCH_CLEARANCE + inch(3)], {
        color: col,
        collide: false,
        castShadow: false,
      });
    }
    // Post between opening and bump
    const pLo = Math.min(openEnd, bumpEdge);
    const pHi = Math.max(openEnd, bumpEdge);
    if (pHi - pLo > 0.01) b.boxMinMax([hub.x - td / 2, pLo, 0], [hub.x + td / 2, pHi, C.TRENCH_CLEARANCE], frame);
    // AprilTag bracket above the arm, and top rail to full height
    const tagY = yRail + sd * C.TRENCH_OPENING_CENTER_Y;
    b.box([hub.x, tagY, (C.TRENCH_CLEARANCE + C.TRENCH_ARM_THICKNESS + C.TRENCH_HEIGHT) / 2], [inch(2), inch(12), C.TRENCH_HEIGHT - C.TRENCH_CLEARANCE - C.TRENCH_ARM_THICKNESS], {
      ...frame,
      collide: false,
    });
  }
}

function buildDepot(b: FieldBuilder, a: Alliance): void {
  const bw = C.DEPOT_BARRIER_W;
  const bh = C.DEPOT_BARRIER_H;
  const steel = { color: C.COLORS.steel, metalness: 0.6, roughness: 0.4 };
  const y0 = C.DEPOT_CENTER_Y - C.DEPOT_WIDTH / 2;
  const y1 = C.DEPOT_CENTER_Y + C.DEPOT_WIDTH / 2;
  const segs: [number, number, number, number][] = [
    [C.DEPOT_DEPTH - bw, y0, C.DEPOT_DEPTH, y1], // front
    [0, y0, C.DEPOT_DEPTH - bw, y0 + bw], // side
    [0, y1 - bw, C.DEPOT_DEPTH - bw, y1], // side
  ];
  for (const [xa, ya, xb, yb] of segs) {
    const p = side(a, xa, ya);
    const q = side(a, xb, yb);
    b.boxMinMax([Math.min(p.x, q.x), Math.min(p.y, q.y), 0], [Math.max(p.x, q.x), Math.max(p.y, q.y), bh], steel);
  }
}

function buildTower(b: FieldBuilder, a: Alliance): void {
  const col = C.COLORS[a];
  const ty = C.TOWER_CENTER_Y;
  const coated = { color: col, metalness: 0.3, roughness: 0.5 };
  // Base plate
  const p0 = side(a, 0, ty - C.TOWER_BASE_WIDTH / 2);
  const p1 = side(a, C.TOWER_BASE_DEPTH, ty + C.TOWER_BASE_WIDTH / 2);
  b.boxMinMax([Math.min(p0.x, p1.x), Math.min(p0.y, p1.y), 0], [Math.max(p0.x, p1.x), Math.max(p0.y, p1.y), C.TOWER_BASE_THICKNESS], {
    color: C.COLORS.darkSteel,
    metalness: 0.4,
  });
  // Uprights
  const uOff = C.UPRIGHT_GAP / 2 + C.UPRIGHT_THICK / 2;
  for (const s of [-1, 1]) {
    const u = side(a, C.UPRIGHT_X, ty + s * uOff);
    b.box([u.x, u.y, C.UPRIGHT_HEIGHT / 2], [C.UPRIGHT_DEEP, C.UPRIGHT_THICK, C.UPRIGHT_HEIGHT], coated);
    // Supports back to the tower wall
    const wallP = side(a, 0.02, ty + s * uOff);
    b.cylinder(V(u, C.TOWER_SUPPORT_Z[1]), V(wallP, C.TOWER_SUPPORT_Z[0]), inch(0.9), { color: C.COLORS.steel });
    b.cylinder(V(u, C.TOWER_SUPPORT_Z[0]), V(wallP, C.TOWER_SUPPORT_Z[0]), inch(0.9), { color: C.COLORS.steel });
  }
  // Rungs
  const half = uOff + C.UPRIGHT_THICK / 2 + C.RUNG_OVERHANG;
  for (const z of C.RUNG_HEIGHTS) {
    const r0 = side(a, C.UPRIGHT_X, ty - half);
    const r1 = side(a, C.UPRIGHT_X, ty + half);
    b.cylinder(V(r0, z), V(r1, z), C.RUNG_OD / 2, coated);
  }
  const lbl = side(a, 0.01, ty);
  b.label([lbl.x, lbl.y, C.TOWER_HEIGHT - inch(4)], 'TOWER', inch(5), a === 'blue' ? 0 : Math.PI, '#ffffff');
}

/** Climb slot poses on an alliance's tower (center-front, then the two rung ends). */
export function towerSlots(a: Alliance, robotLength: number, robotWidth: number): { x: number; y: number; yaw: number }[] {
  const ty = C.TOWER_CENTER_Y;
  const uOff = C.UPRIGHT_GAP / 2 + C.UPRIGHT_THICK / 2;
  const rungHalf = uOff + C.UPRIGHT_THICK / 2 + C.RUNG_OVERHANG;
  const front = { x: C.UPRIGHT_X + C.UPRIGHT_DEEP / 2 + robotLength / 2 + 0.02, y: ty, yaw: Math.PI };
  // Side slots: robot faces along y, so its LENGTH lies along y and its WIDTH along x.
  const sx = Math.max(C.UPRIGHT_X, robotWidth / 2 + 0.05);
  const sideA = { x: sx, y: ty - (rungHalf + robotLength / 2 - 0.12), yaw: Math.PI / 2 };
  const sideB = { x: sx, y: ty + (rungHalf + robotLength / 2 - 0.12), yaw: -Math.PI / 2 };
  return [front, sideA, sideB].map((s) => {
    const p = side(a, s.x, s.y);
    return { x: p.x, y: p.y, yaw: sideYaw(a, s.yaw) };
  });
}
