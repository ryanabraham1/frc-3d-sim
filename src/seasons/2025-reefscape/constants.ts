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
export const CORAL_LENGTH = inch(11.875);
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
