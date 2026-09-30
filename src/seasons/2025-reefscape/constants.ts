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
export const COLORS = { blue: 0x236bea, red: 0xe44353, carpet: 0x41444a, coral: 0xf4f0e4, algae: 0x54cbbb, reef: 0x363b42, branch: 0xa663c5, steel: 0xa5b2bd };
export const side = (a: Alliance, x: number, y: number) => a === 'blue' ? { x, y } : { x: FIELD_LENGTH - x, y: FIELD_WIDTH - y };
export const sideYaw = (a: Alliance, yaw: number) => yaw + (a === 'blue' ? 0 : Math.PI);
export const reefCenter = (a: Alliance) => side(a, REEF_X, REEF_Y);
// Approximate offsets read from Figures 5-2 / 5-4; the PDF does not give surveyed coordinates.
export const processor = (a: Alliance) => side(a, 6.0, 0);
export const stations = (a: Alliance) => [side(a, 1.05, 0.78), side(a, 1.05, FIELD_WIDTH - 0.78)];
export const netCenter = (a: Alliance) => side(a, FIELD_LENGTH / 2, FIELD_WIDTH - NET_LENGTH / 2 - 0.20);
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
