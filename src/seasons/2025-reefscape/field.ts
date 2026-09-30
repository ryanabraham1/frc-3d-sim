import * as THREE from 'three';
import { ALLIANCES, type Alliance } from '@engine/coords';
import type { SeasonContext } from '@engine/core/season';
import type { Vec3 } from '@engine/field/builder';
import { addAprilTags, type TagPose } from '@engine/field/apriltags';
import { inch } from '@engine/units';
import * as C from './constants';

export interface ReefscapeFieldRefs {
  branches: Record<Alliance, THREE.Mesh[]>;
  cages: Record<Alliance, THREE.Group[]>;
  /** Per-cage depth, index = driver station - 1 (§6.3.5: each team chooses the cage nearest its station). */
  cageDepth: Record<Alliance, C.CageDepth[]>;
  lights: Record<Alliance, THREE.Mesh[]>;
  algae: Record<Alliance, THREE.Mesh[]>;
  scored: THREE.Group;
}

export function coralGeometry() {
  const r = C.CORAL_RADIUS, inner = inch(4) / 2, h = C.CORAL_LENGTH / 2;
  return new THREE.LatheGeometry([new THREE.Vector2(inner, -h), new THREE.Vector2(r, -h), new THREE.Vector2(r, h), new THREE.Vector2(inner, h), new THREE.Vector2(inner, -h)], 16);
}

export function buildReefscapeField(ctx: SeasonContext): ReefscapeFieldRefs {
  const b = ctx.builder;
  const L = C.FIELD_LENGTH, W = C.FIELD_WIDTH;
  const refs: ReefscapeFieldRefs = { branches: { blue: [], red: [] }, cages: { blue: [], red: [] }, cageDepth: { blue: [], red: [] }, lights: { blue: [], red: [] }, algae: { blue: [], red: [] }, scored: new THREE.Group() };
  const tags: TagPose[] = [];
  refs.scored.name = 'reefscape-scored-pieces';
  b.root.add(refs.scored);
  b.carpet(C.COLORS.carpet);
  b.tape(L / 2, 0, L / 2, W, 0.05, 0xffffff);

  // Guardrail openings at each processor; corners are clipped by coral-station walls.
  for (const y of [0, W]) {
    const px = y === 0 ? 6 : L - 6;
    for (const [lo, hi] of [[1.7, px - inch(14)], [px + inch(14), L - 1.7]]) {
      b.box([(lo + hi) / 2, y, 0.25], [hi - lo, 0.06, 0.5], { color: 0xadc9d9, opacity: 0.22 });
      for (const z of [0.03, 0.51]) b.box([(lo + hi) / 2, y, z], [hi - lo, 0.05, 0.05], { color: C.COLORS.steel });
      for (let x = lo; x < hi; x += 1.5) b.box([x, y, 0.25], [0.04, 0.08, 0.5], { color: C.COLORS.steel });
    }
  }

  for (const a of ALLIANCES) {
    const color = C.COLORS[a];
    const local = (x: number, y: number, z: number): Vec3 => { const p = C.side(a, x, y); return [p.x, p.y, z]; };
    b.box(local(0, W / 2, 1), [0.10, W - 2.5, 2], { color: 0xadc9d9, opacity: 0.25 });
    for (let s = 1; s <= 3; s++) {
      const y = [W / 2 + 2.2, W / 2, W / 2 - 2.2][s - 1];
      b.box(local(-0.22, y, 0.86), [0.45, 1.85, 0.10], { color: 0x252d36, collide: false });
      b.label(local(0.065, y, 1.35), `${a.toUpperCase()} ${s}`, 0.25, C.sideYaw(a, 0));
    }
    const line0 = C.side(a, C.START_LINE, 0), line1 = C.side(a, C.START_LINE, W);
    b.tape(line0.x, line0.y, line1.x, line1.y, 0.05, 0x141419);
    for (const p of C.coralMarks(a)) {
      b.tape(p.x - 0.05, p.y, p.x + 0.05, p.y, 0.02, 0x141419);
      b.tape(p.x, p.y - 0.05, p.x, p.y + 0.05, 0.02, 0x141419);
    }
    // Diagonal CORAL STATION walls; 76 in × 7 in opening with its bottom at 37.5 in (manual §5.6.2).
    for (const [k, mouth] of C.stations(a).entries()) {
      const out = (d: number, z: number): Vec3 => [mouth.x + Math.cos(mouth.yaw) * d, mouth.y + Math.sin(mouth.yaw) * d, z];
      const yaw = mouth.yaw + Math.PI / 2;
      b.box(out(-0.04, 1), [C.STATION_WALL_LENGTH, 0.08, 2], { color: 0x869cac, yaw, opacity: 0.42 });
      b.box(out(0.005, C.STATION_MOUTH_HEIGHT - 0.03), [C.STATION_MOUTH_WIDTH, 0.03, 0.06], { color, yaw, collide: false });
      b.box(out(0.005, C.STATION_MOUTH_HEIGHT + inch(7) + 0.03), [C.STATION_MOUTH_WIDTH, 0.03, 0.06], { color, yaw, collide: false });
      b.label(out(0.01, 1.78), 'CORAL STATION', 0.19, mouth.yaw);
      const [tx, ty] = out(0.005, 0);
      tags.push({ id: a === 'blue' ? 12 + k : 2 - k, x: tx, y: ty, z: inch(53.25) + inch(10.5) / 2, yaw: mouth.yaw });
    }

    const center = C.reefCenter(a);
    const verts: Vec3[] = [];
    const radius = C.REEF_APOTHEM / Math.cos(Math.PI / 6);
    const troughBottom = C.LEVEL_HEIGHTS[1] - 0.14;
    for (const z of [0, troughBottom - 0.02]) for (let k = 0; k < 6; k++) verts.push([radius * Math.cos(Math.PI / 6 + k * Math.PI / 3), radius * Math.sin(Math.PI / 6 + k * Math.PI / 3), z]);
    b.convex([center.x, center.y, 0], verts, { color: C.COLORS.reef });
    // Manual Fig. 5-7: a sloped trough, front edge at 18 in and a vertical
    // inner wall. Radial sections meet at hex corners instead of overlapping bars.
    const innerApothem = C.REEF_APOTHEM - 0.25;
    const deck: Vec3[] = [];
    for (const z of [troughBottom - 0.02, C.LEVEL_HEIGHTS[1] + 0.025]) for (let k = 0; k < 6; k++) {
      const r = (innerApothem - 0.02) / Math.cos(Math.PI / 6), t = Math.PI / 6 + k * Math.PI / 3;
      deck.push([r * Math.cos(t), r * Math.sin(t), z]);
    }
    b.convex([center.x, center.y, 0], deck, { color, roughness: 0.85 });
    for (let f = 0; f < 6; f++) {
      const angle = f * Math.PI / 3;
      const zoneR = C.REEF_ZONE_APOTHEM / Math.cos(Math.PI / 6);
      const p0 = C.side(a, C.REEF_X + zoneR * Math.cos(angle - Math.PI / 6), C.REEF_Y + zoneR * Math.sin(angle - Math.PI / 6));
      const p1 = C.side(a, C.REEF_X + zoneR * Math.cos(angle + Math.PI / 6), C.REEF_Y + zoneR * Math.sin(angle + Math.PI / 6));
      b.tape(p0.x, p0.y, p1.x, p1.y, 0.05, color);
      const faceMid = C.side(a, C.REEF_X + C.REEF_APOTHEM * Math.cos(angle), C.REEF_Y + C.REEF_APOTHEM * Math.sin(angle));
      const section = (profile: [number, number][], name: string, shade: number) => {
        const points: Vec3[] = profile.flatMap(([r, z]) => [-1, 1].map((sign): Vec3 => [r, sign * r * Math.tan(Math.PI / 6), z]));
        b.convex([center.x, center.y, 0], points, { color: shade, yaw: C.sideYaw(a, angle), name: `${a}-trough-${f}-${name}`, roughness: 0.75 });
      };
      section([[innerApothem, troughBottom - 0.02], [C.REEF_APOTHEM, troughBottom - 0.02], [C.REEF_APOTHEM, C.LEVEL_HEIGHTS[1]], [C.REEF_APOTHEM - 0.02, C.LEVEL_HEIGHTS[1]], [innerApothem, troughBottom]], 'slope', 0x8a939b);
      section([[innerApothem - 0.02, troughBottom - 0.02], [innerApothem, troughBottom - 0.02], [innerApothem, C.LEVEL_HEIGHTS[1] + 0.025], [innerApothem - 0.02, C.LEVEL_HEIGHTS[1] + 0.025]], 'inner-wall', C.COLORS.steel);
      const tagId = (a === 'blue' ? [21, 20, 19, 18, 17, 22] : [10, 11, 6, 7, 8, 9])[f];
      tags.push({ id: tagId, x: faceMid.x, y: faceMid.y, z: inch(6.875) + inch(10.5) / 2, yaw: C.sideYaw(a, angle) });
      for (let branch = 0; branch < 2; branch++) {
        const stem = C.branchPoint(a, f, branch, 4);
        const dx = Math.cos(stem.yaw), dy = Math.sin(stem.yaw);
        const base: Vec3 = [stem.x - dx * 0.27, stem.y - dy * 0.27, 0.42];
        b.cylinder(base, [base[0], base[1], 1.67], 0.021, { color: C.COLORS.branch });
        for (let level = 2; level <= 4; level++) {
          const p = C.branchPoint(a, f, branch, level);
          const from: Vec3 = level === 4 ? [p.x, p.y, p.z - 0.27] : [p.x - dx * 0.27, p.y - dy * 0.27, p.z - Math.tan(35 * Math.PI / 180) * 0.27];
          const mesh = b.cylinder(from, [p.x, p.y, p.z], 0.021, { color: C.COLORS.branch }).mesh!;
          refs.branches[a][(level - 2) * 12 + f * 2 + branch] = mesh;
          if (level === 4) b.cylinder([base[0], base[1], 1.45], from, 0.021, { color: C.COLORS.branch });
        }
      }
      const high = f % 2 === 0;
      const ap = C.side(a, C.REEF_X + (C.REEF_APOTHEM - 0.07) * Math.cos(angle), C.REEF_Y + (C.REEF_APOTHEM - 0.07) * Math.sin(angle));
      const algae = new THREE.Mesh(new THREE.SphereGeometry(C.ALGAE_RADIUS, 18, 12), b.material({ color: C.COLORS.algae }));
      algae.position.copy(ctx.frame.toWorld(ap.x, ap.y, C.LEVEL_HEIGHTS[high ? 3 : 2] + 0.08));
      algae.castShadow = true;
      b.root.add(algae);
      refs.algae[a].push(algae);
    }

    const p = C.processor(a);
    const openingWidth = inch(28), bottom = inch(7), top = bottom + inch(20);
    const yaw = C.sideYaw(a, Math.PI / 2);
    for (const dx of [-openingWidth / 2 - 0.07, openingWidth / 2 + 0.07]) b.box([p.x + dx, p.y, 0.6], [0.14, 0.16, 1.2], { color });
    b.box([p.x, p.y, top + 0.12], [openingWidth, 0.16, 0.24], { color });
    b.box([p.x, p.y, bottom / 2], [openingWidth, 0.10, bottom], { color: 0x252a2f });
    b.box([p.x, p.y + (a === 'blue' ? -0.10 : 0.10), (top + bottom) / 2], [openingWidth, 0.015, top - bottom], { color: 0x0b1117, collide: false });
    b.label([p.x, p.y + (a === 'blue' ? 0.13 : -0.13), 1.0], 'PROCESSOR', 0.14, yaw);
    tags.push({ id: a === 'blue' ? 16 : 3, x: p.x, y: p.y + (a === 'blue' ? 0.10 : -0.10), z: inch(45.875) + inch(10.5) / 2, yaw });
    // The opponent's PROCESSOR AREA (43⅜ in × 90 in, §5.2) is outside the guardrail, beside this processor
    // on the midfield side; its HUMAN PLAYER receives ALGAE scored here.
    const hpColor = C.COLORS[a === 'blue' ? 'red' : 'blue'];
    const areaX = (d: number) => C.side(a, 6.0 + inch(14) + d, 0).x;
    const [ax0, ax1] = [areaX(0), areaX(inch(43.375))].sort((u, v) => u - v);
    const [ay0, ay1] = a === 'blue' ? [-inch(90), -0.03] : [W + 0.03, W + inch(90)];
    b.box([(ax0 + ax1) / 2, (ay0 + ay1) / 2, -0.005], [ax1 - ax0, ay1 - ay0, 0.01], { color: 0x2a2d33, collide: false });
    b.tapeRect(ax0, ay0, ax1, ay1, 0.05, hpColor);

    const n = C.netCenter(a);
    const x0 = n.x - C.NET_WIDTH / 2, x1 = n.x + C.NET_WIDTH / 2;
    const y0 = n.y - C.NET_LENGTH / 2, y1 = n.y + C.NET_LENGTH / 2;
    // Netted cup, open above: physical floor arrests balls before capture; cross strings show the mesh.
    b.box([n.x, n.y, C.NET_HEIGHT - 0.03], [C.NET_WIDTH, C.NET_LENGTH, 0.02], { color, opacity: 0.10, collide: 'pieces' });
    for (let x = x0; x <= x1; x += 0.10) b.cylinder([x, y0, C.NET_HEIGHT], [x, y1, C.NET_HEIGHT], 0.004, { color: 0xd8e4e9, collide: false });
    for (let y = y0; y <= y1; y += 0.10) b.cylinder([x0, y, C.NET_HEIGHT], [x1, y, C.NET_HEIGHT], 0.004, { color: 0xd8e4e9, collide: false });
    for (const x of [x0, x1]) b.box([x, n.y, C.NET_HEIGHT + 0.24], [0.018, C.NET_LENGTH, 0.48], { color: 0xbdd3df, opacity: 0.2, collide: 'pieces' });
    for (const y of [y0, y1]) b.box([n.x, y, C.NET_HEIGHT + 0.24], [C.NET_WIDTH, 0.018, 0.48], { color: 0xbdd3df, opacity: 0.2, collide: 'pieces' });
    b.label([n.x - (a === 'blue' ? 0.63 : -0.63), n.y, C.NET_HEIGHT + 0.36], `${a.toUpperCase()} NET`, 0.17, C.sideYaw(a, Math.PI));
    const [zoneY0, zoneY1] = C.bargeZoneY(a);
    b.tapeRect(L / 2 - C.BARGE_ZONE_DEPTH / 2, zoneY0 + 0.025, L / 2 + C.BARGE_ZONE_DEPTH / 2, zoneY1 - 0.025, 0.05, color);
    for (let s = 1; s <= 3; s++) {
      const p = C.cage(a, s);
      const group = new THREE.Group();
      // Cages start the day deep (§6.3.5); a station's team may request shallow for its own cage.
      const depth: C.CageDepth = ctx.robots.find((r) => r.alliance === a && r.station === s)?.config.climber.maxLevel === 1 ? 'shallow' : 'deep';
      refs.cageDepth[a].push(depth);
      group.position.copy(ctx.frame.toWorld(p.x, p.y, C.CAGE_BOTTOM[depth]));
      const mat = b.material({ color, metalness: 0.6 });
      const size = inch(7.375), height = inch(24);
      for (const x of [-size / 2 + 0.017, size / 2 - 0.017]) for (const z of [-size / 2 + 0.017, size / 2 - 0.017]) {
        const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.017, 0.017, height, 10), mat);
        pipe.position.set(x, height / 2, z); group.add(pipe);
        b.cylinder([p.x + x, p.y - z, C.CAGE_BOTTOM[depth]], [p.x + x, p.y - z, C.CAGE_BOTTOM[depth] + height], 0.017, { visible: false });
      }
      for (const y of [0, height]) { const plate = new THREE.Mesh(new THREE.BoxGeometry(size, 0.025, size), mat); plate.position.y = y; group.add(plate); }
      b.root.add(group); refs.cages[a].push(group);
      b.cylinder([p.x, p.y, C.CAGE_BOTTOM[depth] + height], [p.x, p.y, inch(62)], 0.007, { color: C.COLORS.steel, collide: false });
      const light = b.box([L / 2 - 0.57, p.y, inch(62)], [0.07, 0.25, 0.08], { color, emissive: color, emissiveIntensity: 0.2, collide: false }).mesh!;
      refs.lights[a].push(light);
    }
  }
  // Barge truss: open under the beam, center upright and outboard legs.
  for (const y of [-0.22, W / 2, W + 0.22]) {
    for (const x of [L / 2 - 0.30, L / 2 + 0.30]) b.cylinder([x, y, 0], [x, y, inch(101)], 0.05, { color: C.COLORS.steel });
    for (let z = 0.1; z < 2.4; z += 0.35) {
      b.cylinder([L / 2 - 0.30, y, z], [L / 2 + 0.30, y, z + 0.35], 0.025, { color: C.COLORS.steel });
      b.cylinder([L / 2 + 0.30, y, z], [L / 2 - 0.30, y, z + 0.35], 0.025, { color: C.COLORS.steel });
    }
  }
  for (const x of [L / 2 - 0.4, L / 2 + 0.4]) b.box([x, W / 2, inch(62) + 0.08], [0.08, W + 0.6, 0.16], { color: C.COLORS.steel });
  for (const xSide of [-1, 1]) for (const ySide of [-1, 1]) tags.push({
    id: xSide === -1 ? (ySide === 1 ? 14 : 15) : (ySide === 1 ? 4 : 5),
    // Centered above each alliance's middle cage (§5.8).
    x: L / 2 + xSide * 0.55, y: W / 2 + ySide * C.CAGE_OFFSETS[1], z: inch(69) + inch(10.5) / 2, yaw: xSide === -1 ? Math.PI : 0,
  });
  addAprilTags(b, { field: { length: L, width: W }, tags: tags.map((t) => ({ ID: t.id, pose: { translation: { x: t.x, y: t.y, z: t.z }, rotation: { quaternion: { W: Math.cos(t.yaw / 2), X: 0, Y: 0, Z: Math.sin(t.yaw / 2) } } } })) });
  return refs;
}
