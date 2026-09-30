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
  const refs: ReefscapeFieldRefs = { branches: { blue: [], red: [] }, cages: { blue: [], red: [] }, lights: { blue: [], red: [] }, algae: { blue: [], red: [] }, scored: new THREE.Group() };
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
    for (const y of [W / 2 - 1.8, W / 2, W / 2 + 1.8]) {
      const p = C.side(a, 1.65, y);
      b.tape(p.x - 0.05, p.y, p.x + 0.05, p.y, 0.02, 0x141419);
      b.tape(p.x, p.y - 0.05, p.x, p.y + 0.05, 0.02, 0x141419);
    }
    // 54-degree diagonals, chute lip at 37.5 in (manual §5.6.2).
    for (const [k, sy] of [0, W].entries()) {
      const sign = k === 0 ? 1 : -1;
      const yaw = C.sideYaw(a, Math.atan2(sign * 1.25, -1.7));
      const mid = local(0.85, sy + sign * 0.625, 1);
      b.box(mid, [2.11, 0.08, 2], { color: 0x869cac, yaw, opacity: 0.42 });
      const mouth = C.stations(a)[k];
      b.box([mouth.x, mouth.y, inch(37.5)], [1.93, 0.22, 0.10], { color, yaw, collide: false });
      b.label([mouth.x, mouth.y, 1.63], 'CORAL STATION', 0.19, C.sideYaw(a, k ? -Math.PI / 4 : Math.PI / 4));
      tags.push({ id: a === 'blue' ? 12 + k : 2 - k, x: mouth.x, y: mouth.y, z: inch(53.25) + inch(10.5) / 2, yaw: C.sideYaw(a, k ? -Math.PI / 4 : Math.PI / 4) });
    }

    const center = C.reefCenter(a);
    const verts: Vec3[] = [];
    const radius = C.REEF_APOTHEM / Math.cos(Math.PI / 6);
    for (const z of [0, C.LEVEL_HEIGHTS[1] - 0.10]) for (let k = 0; k < 6; k++) verts.push([radius * Math.cos(Math.PI / 6 + k * Math.PI / 3), radius * Math.sin(Math.PI / 6 + k * Math.PI / 3), z]);
    b.convex([center.x, center.y, 0], verts, { color: C.COLORS.reef });
    for (let f = 0; f < 6; f++) {
      const angle = f * Math.PI / 3;
      const zoneR = C.REEF_ZONE_APOTHEM / Math.cos(Math.PI / 6);
      const p0 = C.side(a, C.REEF_X + zoneR * Math.cos(angle - Math.PI / 6), C.REEF_Y + zoneR * Math.sin(angle - Math.PI / 6));
      const p1 = C.side(a, C.REEF_X + zoneR * Math.cos(angle + Math.PI / 6), C.REEF_Y + zoneR * Math.sin(angle + Math.PI / 6));
      b.tape(p0.x, p0.y, p1.x, p1.y, 0.05, color);
      const faceMid = C.side(a, C.REEF_X + C.REEF_APOTHEM * Math.cos(angle), C.REEF_Y + C.REEF_APOTHEM * Math.sin(angle));
      b.box([faceMid.x, faceMid.y, C.LEVEL_HEIGHTS[1]], [0.12, radius, 0.09], { color: 0x8a939b, yaw: C.sideYaw(a, angle) });
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
    b.tapeRect(p.x - 0.55, a === 'blue' ? 0 : W - 2.29, p.x + 0.55, a === 'blue' ? 2.29 : W, 0.05, color);

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
    const zoneY0 = a === 'blue' ? W / 2 + 0.1 : 0.23;
    b.tapeRect(L / 2 - inch(46) / 2, zoneY0, L / 2 + inch(46) / 2, zoneY0 + inch(146.5), 0.05, color);
    for (let s = 1; s <= 3; s++) {
      const p = C.cage(a, s);
      const group = new THREE.Group();
      const depth = ctx.robots.find((r) => r.alliance === a && r.station === s)?.config.climber.maxLevel === 1 ? 'shallow' : 'deep';
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
    x: L / 2 + xSide * 0.55, y: W / 2 + ySide * 2.0, z: inch(69) + inch(10.5) / 2, yaw: xSide === -1 ? Math.PI : 0,
  });
  addAprilTags(b, { field: { length: L, width: W }, tags: tags.map((t) => ({ ID: t.id, pose: { translation: { x: t.x, y: t.y, z: t.z }, rotation: { quaternion: { W: Math.cos(t.yaw / 2), X: 0, Y: 0, Z: Math.sin(t.yaw / 2) } } } })) });
  return refs;
}
