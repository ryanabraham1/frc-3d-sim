import type { Alliance } from '@engine/coords';
import { inch } from '@engine/units';

// Manual dimensions: ARENA V4 / Game Details V13. Undimensioned poses are marked below;
// see docs/REEFSCAPE.md for source pages and simulation approximations.
export const FIELD_LENGTH = inch(690.875);
export const FIELD_WIDTH = inch(317);
export const REEF_APOTHEM = inch(65.5) / 2;
export const REEF_X = inch(144) + REEF_APOTHEM;
export const REEF_Y = FIELD_WIDTH / 2;
export const REEF_ZONE_APOTHEM = inch(93.5) / 2;
export const START_LINE = REEF_X + REEF_APOTHEM + inch(88);
export const LEVEL_HEIGHTS = [0, inch(18), inch(31.875), inch(47.625), inch(72)];
export const CORAL_AUTO = [0, 3, 4, 6, 7];
export const CORAL_TELEOP = [0, 2, 3, 4, 5];
export const CORAL_COUNT = 126;
export const ALGAE_COUNT = 18;
export const ALGAE_RADIUS = inch(16.25) / 2;
export const CORAL_RADIUS = inch(4.5) / 2;
export const CORAL_INNER_RADIUS = inch(4) / 2; // §5.7.1: 4 in ID
export const CORAL_LENGTH = inch(11.875);
/** Collider bore of the hollow CORAL (slightly under the 4 in ID so the thin wall is robust in the physics). */
export const CORAL_COLLIDER_INNER = inch(3.7) / 2;
/** §5.3: pipes are 1¼ in Schedule 40 steel (1.66 in OD). */
export const BRANCH_RADIUS = inch(1.66) / 2;
/** Length of each BRANCH segment beyond its bend (visual/physics model of Figure 5-6). */
export const BRANCH_SEGMENT = 0.27;
export const BRANCH_ANGLE = (35 * Math.PI) / 180;
export const NET_HEIGHT = inch(76);
export const NET_WIDTH = inch(48);
export const NET_LENGTH = inch(144);
export const CAGE_OFFSETS = [inch(127.375), inch(84.375), inch(41.5)];
export const CAGE_BOTTOM = { shallow: inch(30.125), deep: inch(3.125) };
export type CageDepth = keyof typeof CAGE_BOTTOM;
// §5.4.1: 2 ft × 7⅜ in cage of four 1 in Sch 40 pipes (1.315 in OD), hung from the 62 in truss.
// A deep cage hangs on 19 chain links; both swing freely.
export const CAGE_SIZE = inch(7.375);
export const CAGE_HEIGHT = inch(24);
export const CAGE_PIPE_RADIUS = inch(1.315) / 2;
export const CAGE_PIVOT_HEIGHT = inch(62);
export const CAGE_MASS = 8; // [EST] ~13 lb of pipe plus plates.
export const CAGE_POINTS: Record<CageDepth, number> = { shallow: 6, deep: 12 };
// BARGE ZONE §5.2: 46 in deep × 146.5 in long, running from the guardrail toward the center support (Fig. 5-4).
export const BARGE_ZONE_DEPTH = inch(46);
export const BARGE_ZONE_LENGTH = inch(146.5);
// CORAL MARKS, measured from Fig. 6-2 (not dimensioned in the manual text).
export const CORAL_MARK_X = inch(48);
export const CORAL_MARK_DY = inch(72);
export const STATION_MOUTH_HEIGHT = inch(37.5);
export const STATION_MOUTH_WIDTH = inch(76);
/** §5.6.2: 7 in tall opening fed by a 55° sloped CHUTE. */
export const STATION_MOUTH_TALL = inch(7);
export const CHUTE_ANGLE = (55 * Math.PI) / 180;
export const CHUTE_LENGTH = 0.75; // [EST] length of the sloped CHUTE floor behind the opening
export const COLORS = { blue: 0x236bea, red: 0xe44353, carpet: 0x41444a, coral: 0xf4f0e4, algae: 0x54cbbb, reef: 0x363b42, branch: 0xa663c5, steel: 0xa5b2bd };
export const side = (a: Alliance, x: number, y: number) => a === 'blue' ? { x, y } : { x: FIELD_LENGTH - x, y: FIELD_WIDTH - y };
export const sideYaw = (a: Alliance, yaw: number) => yaw + (a === 'blue' ? 0 : Math.PI);
export const reefCenter = (a: Alliance) => side(a, REEF_X, REEF_Y);
// Approximate offsets read from Figures 5-2 / 5-4; the PDF does not give surveyed coordinates.
export const processor = (a: Alliance) => side(a, 6.0, 0);
// CORAL STATION walls clip each corner from (1.7, 0) to (0, 1.25) m (Figs. 5-2/5-4); the ~54° normal
// faces into the FIELD. Mouth points lie on the wall face.
const STATION_NORMAL = Math.atan2(1.7, 1.25);
export const STATION_WALL_LENGTH = Math.hypot(1.7, 1.25);
export const stations = (a: Alliance) => [
  { ...side(a, 0.85, 0.625), yaw: sideYaw(a, STATION_NORMAL) },
  { ...side(a, 0.85, FIELD_WIDTH - 0.625), yaw: sideYaw(a, -STATION_NORMAL) },
];
export const netCenter = (a: Alliance) => side(a, FIELD_LENGTH / 2, FIELD_WIDTH - NET_LENGTH / 2 - 0.20);
export const coralMarks = (a: Alliance) => [-1, 0, 1].map((k) => side(a, CORAL_MARK_X, REEF_Y + k * CORAL_MARK_DY));
export const cage = (a: Alliance, station: number) => side(a, FIELD_LENGTH / 2, FIELD_WIDTH / 2 + CAGE_OFFSETS[station - 1]);

export function branchPoint(a: Alliance, face: number, branch: number, level: number) {
  const angle = face * Math.PI / 3;
  const r = REEF_APOTHEM - inch(level === 4 ? 1.125 : 1.625);
  const tangent = (branch === 0 ? -1 : 1) * inch(13) / 2; // Pipe center spacing, manual §5.3 p24.
  const p = side(a, REEF_X + Math.cos(angle) * r - Math.sin(angle) * tangent, REEF_Y + Math.sin(angle) * r + Math.cos(angle) * tangent);
  return { ...p, z: LEVEL_HEIGHTS[level], yaw: sideYaw(a, angle) };
}

export function nearestFace(a: Alliance, p: { x: number; y: number }): number {
  const c = reefCenter(a);
  const angle = Math.atan2(p.y - c.y, p.x - c.x) - (a === 'red' ? Math.PI : 0);
  return ((Math.round(angle / (Math.PI / 3)) % 6) + 6) % 6;
}

/** Field-frame y range of an alliance's BARGE ZONE (blue: the +y half of the barge). */
export function bargeZoneY(a: Alliance): [number, number] {
  return a === 'blue' ? [FIELD_WIDTH - BARGE_ZONE_LENGTH, FIELD_WIDTH] : [0, BARGE_ZONE_LENGTH];
}

/** Conservative oriented-box/hexagon overlap test, including bumper projection on each face. */
export function inReefZone(a: Alliance, p: { x: number; y: number; yaw: number }, length: number, width: number): boolean {
  const c = reefCenter(a);
  for (let f = 0; f < 6; f++) {
    const t = f * Math.PI / 3;
    const extent = Math.abs(Math.cos(p.yaw - t)) * length / 2 + Math.abs(Math.sin(p.yaw - t)) * width / 2;
    if ((p.x - c.x) * Math.cos(t) + (p.y - c.y) * Math.sin(t) > REEF_ZONE_APOTHEM + extent) return false;
  }
  return true;
}

/** Unit vector for a field yaw/pitch (pitch + = up). */
export function dir3(yaw: number, pitch: number) {
  return { x: Math.cos(yaw) * Math.cos(pitch), y: Math.sin(yaw) * Math.cos(pitch), z: Math.sin(pitch) };
}

/**
 * A BRANCH as a segment: `tip` (highest, outermost point per §5.3) and `base` (where it meets its vertical pipe).
 * L2/L3 rise at 35° toward the outside; L4 is vertical.
 */
export function branchSegment(a: Alliance, face: number, branch: number, level: number) {
  const tip = branchPoint(a, face, branch, level);
  const out = tip.yaw; // outward normal of the face
  const base = level === 4
    ? { x: tip.x, y: tip.y, z: tip.z - BRANCH_SEGMENT }
    : { x: tip.x - Math.cos(out) * BRANCH_SEGMENT, y: tip.y - Math.sin(out) * BRANCH_SEGMENT, z: tip.z - Math.tan(BRANCH_ANGLE) * BRANCH_SEGMENT };
  return { tip, base };
}

/**
 * Where a CORAL must start to slide onto a BRANCH, and which way it travels. L2/L3: coaxial with the BRANCH,
 * beyond its tip, moving inward-down; L4: straight above the vertical pipe, moving down; L1: over the trough,
 * lying along the face (axis tangent), moving inward.
 */
export function coralApproach(a: Alliance, face: number, branch: number, level: number) {
  const angle = sideYaw(a, face * Math.PI / 3);
  if (level === 1) {
    const c = reefCenter(a), r = REEF_APOTHEM - 0.07, t = (branch === 0 ? -1 : 1) * inch(6.5);
    const pos = { x: c.x + Math.cos(angle) * r - Math.sin(angle) * t, y: c.y + Math.sin(angle) * r + Math.cos(angle) * t, z: LEVEL_HEIGHTS[1] + CORAL_RADIUS + 0.09 };
    return { pos, travel: dir3(angle + Math.PI, 0), axis: dir3(angle + Math.PI / 2, 0), faceYaw: angle };
  }
  const { tip } = branchSegment(a, face, branch, level);
  const travel = level === 4 ? { x: 0, y: 0, z: -1 } : dir3(angle + Math.PI, -BRANCH_ANGLE);
  // The end effector lets go with the CORAL nose just short of the BRANCH tip.
  const back = CORAL_LENGTH / 2 + 0.006;
  const pos = { x: tip.x - travel.x * back, y: tip.y - travel.y * back, z: tip.z - travel.z * back };
  return { pos, travel, axis: travel, faceYaw: angle };
}

/**
 * CORAL STATION CHUTE: point on the chute floor `up` meters (along the floor) above the opening's bottom edge,
 * `along` meters across it. The floor is a short 35° exit lip then the 55° slope: a straight 55° floor would leave
 * only 7·cos55° ≈ 4 in of clearance under the 7 in opening — less than a 4½ in CORAL — so the CHUTE must level
 * out at its exit [EST shape; §5.6.2 gives the 55° slope and the opening size].
 */
export const CHUTE_LIP = 0.1;
export const CHUTE_LIP_ANGLE = (35 * Math.PI) / 180;
export function chutePoint(station: { x: number; y: number; yaw: number }, along: number, up: number) {
  const nx = Math.cos(station.yaw), ny = Math.sin(station.yaw), tx = -ny, ty = nx;
  const lip = Math.min(up, CHUTE_LIP), slope = Math.max(0, up - CHUTE_LIP);
  const back = lip * Math.cos(CHUTE_LIP_ANGLE) + slope * Math.cos(CHUTE_ANGLE);
  const z = STATION_MOUTH_HEIGHT + lip * Math.sin(CHUTE_LIP_ANGLE) + slope * Math.sin(CHUTE_ANGLE);
  return { x: station.x - nx * back + tx * along, y: station.y - ny * back + ty * along, z };
}
