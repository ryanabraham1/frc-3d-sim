import type { Alliance, FieldPoint } from '@engine/coords';
import { FIELD_LENGTH, FIELD_WIDTH, PANEL_RADIUS } from './constants';

/**
 * Field geometry measured from the supplied field CAD (`Hero_Heist_Field.glb`, see `cad-manifest.json`) in WPILib
 * field coordinates: fx = cadX + 8.2296, fy = cadY + 4.1148, z up. Measurements come from ray casts and slices of the
 * CAD wall meshes and are tagged [CAD]; the manual (p. 6-15) gives sizes but not positions. Mirror-symmetric field:
 * the red end is `x -> L - x` with y unchanged. BLUE plays from the x = 0 end.
 */
export const CX = FIELD_LENGTH / 2;
export const CY = FIELD_WIDTH / 2;
export const mirrorX = (a: Alliance, x: number): number => (a === 'blue' ? x : FIELD_LENGTH - x);

export type Region = 'uptown' | 'downtown' | 'west' | 'east';
export type MailboxFamily = 'diagonal' | 'horizontal' | 'top';
export interface Vec3 { x: number; y: number; z: number }

/** A CITY BLOCK opening: a square window. Pieces score after passing `depth` behind its plane, inside the square. */
export interface CityBlock {
  center: Vec3;
  /** Unit normal of the window, pointing OUT toward the field. */
  normal: Vec3;
  /** In-plane axes of the square (unit) and its half-size. */
  u: Vec3;
  v: Vec3;
  half: number;
  /** How far behind the window plane the exit sensor sits (the "imaginary sensor at the exit"), and its far limit. */
  depth: number;
  far: number;
}

/** A MAILBOX slot: where a STORY PANEL's leading edge enters, the insertion direction, and the slot's long axis. */
export interface Mailbox {
  family: MailboxFamily;
  /** Middle of the slot opening (leading edge of the panel enters here). */
  entry: Vec3;
  /** Unit insertion direction (into the DISTRICT). */
  dir: Vec3;
  /** Unit long axis of the slit (the panel's plane contains `dir` and `axis`). */
  axis: Vec3;
  /** Slot length along `axis` [CAD]. */
  width: number;
  /** Robot heading that squares its front to the slot (field yaw). */
  yaw: number;
  /** Front face of the DISTRICT wall in front of the slot: distance along the approach the bumper can reach. */
  face: FieldPoint;
}

export interface District {
  id: number;
  region: Region;
  label: string;
  cityBlock: CityBlock;
  mailbox: Mailbox;
  /** Indices of `indicator-N` LED nodes in the prepared field GLB, lit in this order as OWNERSHIP rises. */
  lights: number[];
}

const v = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
const S2 = Math.SQRT1_2;

/** District x offsets from the field center line for UPTOWN and DOWNTOWN [CAD: April tags, LED strips, wall cutouts]. */
export const ROW_X = [-3.048, -1.829, -0.61, 0.61, 1.829, 3.048];
/** UPTOWN wall: lower face, chamfer with the diagonal MAILBOX slit, upper face, 45° top with the CITY BLOCK window. */
export const UPTOWN = { face: 7.849, chamferTop: 0.95, upperFace: 8.045, upperFaceTop: 1.52, windowTop: 8.445, back: 8.535, backboard: 8.585, rampBack: 1.05, frameTop: 1.96, halfLength: 3.658 } as const;
/** DOWNTOWN wall: front face with the horizontal MAILBOX slit, flat top with the CITY BLOCK hole, LED backboard. */
export const DOWNTOWN = { face: 0.457, slitZ: 0.65, top: 1.07, holeFront: 0.215, holeBack: -0.265, floor: 0.82, backTop: 1.37, backboardTop: 2.27, back: -0.305, halfLength: 3.658 } as const;
/** CITY BLOCK window half-size: 20 in nominal opening plus its frame relief [CAD 0.54 m cutouts]. */
export const BLOCK_HALF = 0.27;
/** FOOTHILL wall (blue end): line through column 0, unit direction along the wall, unit outward normal [CAD]. */
export const FOOTHILL = { p0: { x: 0.384, y: 7.231 }, t: { x: 0.766, y: 0.643 }, n: { x: -0.643, y: 0.766 }, column: 1.067, funnelZ: [1.17, 2.62], basketTop: [0.78, 2.23], ends: [{ x: 0, y: 6.909 }, { x: 1.574, y: FIELD_WIDTH }] } as const;

const LIGHTS = [[32, 30, 67, 0], [40, 77, 3, 56], [49, 65, 63, 50], [62, 47, 36, 26], [5, 42, 29, 58], [41, 4, 48, 44], [11, 9, 19, 1], [39, 59, 34, 79], [78, 31, 18, 16], [55, 72, 71, 25], [57, 2, 61, 76], [51, 73, 35, 37], [70, 60, 6, 20], [45, 74, 21, 10], [14, 46, 7, 28], [53, 64, 33, 24], [27, 69, 75, 8], [66, 52, 17, 68], [54, 22, 15, 23], [12, 43, 38, 13]];

function buildDistricts(): District[] {
  const out: District[] = [];
  ROW_X.forEach((dx, k) => {
    const x = CX + dx;
    out.push({
      id: out.length, region: 'uptown', label: `UPTOWN ${k + 1}`,
      // 45° window rising away from the field from (fy 8.065, z 1.52) to (8.445, 1.92) [CAD].
      cityBlock: { center: v(x, 8.255, 1.72), normal: v(0, -S2, S2), u: v(1, 0, 0), v: v(0, S2, S2), half: BLOCK_HALF, depth: 0.03, far: 0.4 },
      // Diagonal slit cut into the 45° chamfer, running down and back into the wall [CAD slice x = district].
      mailbox: { family: 'diagonal', entry: v(x, 7.94, 0.87), dir: v(0, S2, -S2), axis: v(1, 0, 0), width: 0.65, yaw: Math.PI / 2, face: { x, y: UPTOWN.face } },
      lights: LIGHTS[out.length],
    });
  });
  ROW_X.forEach((dx, k) => {
    const x = CX + dx;
    out.push({
      id: out.length, region: 'downtown', label: `DOWNTOWN ${k + 1}`,
      // Horizontal hole in the flat top, z 1.07 [CAD].
      cityBlock: { center: v(x, (DOWNTOWN.holeFront + DOWNTOWN.holeBack) / 2, DOWNTOWN.top), normal: v(0, 0, 1), u: v(1, 0, 0), v: v(0, 1, 0), half: BLOCK_HALF, depth: 0.05, far: 0.3 },
      mailbox: { family: 'horizontal', entry: v(x, DOWNTOWN.face, DOWNTOWN.slitZ), dir: v(0, -1, 0), axis: v(1, 0, 0), width: 0.65, yaw: -Math.PI / 2, face: { x, y: DOWNTOWN.face } },
      lights: LIGHTS[out.length],
    });
  });
  for (const region of ['west', 'east'] as const) {
    const a: Alliance = region === 'west' ? 'blue' : 'red';
    const s = a === 'blue' ? 1 : -1;
    const t = { x: FOOTHILL.t.x * s, y: FOOTHILL.t.y }, n = { x: FOOTHILL.n.x * s, y: FOOTHILL.n.y };
    for (let c = 0; c < 2; c++) for (let level = 0; level < 2; level++) {
      const base = { x: mirrorX(a, FOOTHILL.p0.x + FOOTHILL.t.x * FOOTHILL.column * c), y: FOOTHILL.p0.y + FOOTHILL.t.y * FOOTHILL.column * c };
      const basketU = -0.07; // pocket sits in front of the wall [CAD basket bounds]
      out.push({
        id: out.length, region, label: `${region === 'west' ? 'WEST' : 'EAST'} FOOTHILL ${c + 1}${level ? ' HIGH' : ' LOW'}`,
        // Square funnel hole in the wall, facing the field [CAD wall scan].
        cityBlock: { center: v(base.x, base.y, FOOTHILL.funnelZ[level]), normal: v(-n.x, -n.y, 0), u: v(t.x, t.y, 0), v: v(0, 0, 1), half: BLOCK_HALF, depth: 0.04, far: 0.45 },
        // Top-fed pocket: the panel drops in vertically, parallel to the wall.
        mailbox: { family: 'top', entry: v(base.x + n.x * basketU, base.y + n.y * basketU, FOOTHILL.basketTop[level]), dir: v(0, 0, -1), axis: v(t.x, t.y, 0), width: 0.66, yaw: Math.atan2(n.y, n.x), face: { x: base.x + n.x * (basketU - 0.05), y: base.y + n.y * (basketU - 0.05) } },
        lights: LIGHTS[out.length],
      });
    }
  }
  return out;
}

/** 20 DISTRICTS: 0-5 UPTOWN, 6-11 DOWNTOWN (x ascending), 12-15 WEST (blue end) and 16-19 EAST FOOTHILLS. */
export const DISTRICTS: District[] = buildDistricts();

const dot = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z;
/** Has a piece centered at `p` passed the CITY BLOCK exit sensor? */
export function inCityBlock(b: CityBlock, p: Vec3): boolean {
  const d = { x: p.x - b.center.x, y: p.y - b.center.y, z: p.z - b.center.z };
  const s = dot(d, b.normal);
  return s < -b.depth && s > -b.far && Math.abs(dot(d, b.u)) < b.half && Math.abs(dot(d, b.v)) < b.half + 0.05;
}

/** Panel leading-edge insertion distance past `entry` along `dir` at which the powered rollers take it (~8 in) [M p. 11]. */
export const ROLLER_CAPTURE = 0.2032;
/** Where a held panel's center must be for its leading edge to sit `insert` m into the slot. */
export function panelCenterAt(m: Mailbox, insert: number): Vec3 {
  const k = insert - PANEL_RADIUS;
  return v(m.entry.x + m.dir.x * k, m.entry.y + m.dir.y * k, m.entry.z + m.dir.z * k);
}

// ───────────────────────── zones (taped, CAD carpet primitives) ─────────────────────────

const rect = (x0: number, y0: number, x1: number, y1: number): FieldPoint[] => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
const mirror = (a: Alliance, poly: FieldPoint[]): FieldPoint[] => (a === 'blue' ? poly : poly.map(p => ({ x: FIELD_LENGTH - p.x, y: p.y })).reverse());

/** TOWER ZONE between the squad tape (fx 4.553) and the outer strip (fx 3.607), above the COLLECTOR line. */
export const TOWER_ZONE_X: [number, number] = [3.607, 4.623];
export const COLLECTOR_Y = 1.372;
export const towerZone = (a: Alliance) => mirror(a, rect(TOWER_ZONE_X[0], 1.321, TOWER_ZONE_X[1], FIELD_WIDTH));
/** COLLECTOR ZONE: guardrail, SQUAD WALL, squad tape along the field and the TOWER ZONE's white strip. */
export const collectorZone = (a: Alliance) => mirror(a, rect(0, 0, 4.553, COLLECTOR_Y));
/** HOME ZONE: at the OPPONENT's end, between its FOOTHILL and the squad-colored diagonal tape. */
export const homeZone = (a: Alliance) => mirror(a === 'blue' ? 'red' : 'blue', [{ x: 2.43, y: FIELD_WIDTH }, { x: 0, y: 6.195 }, { x: 0, y: 6.909 }, { x: 1.574, y: FIELD_WIDTH }]);
/** LAUNCH ZONE: center between the inner TOWER ZONE lines (Downtown face to Uptown face) plus both ends above the purple diagonal. */
export const LAUNCH_ZONES: FieldPoint[][] = [
  rect(4.572, DOWNTOWN.face, FIELD_LENGTH - 4.572, FIELD_WIDTH),
  [{ x: 0, y: 4.818 }, { x: 4.572, y: 2.896 }, { x: 4.572, y: FIELD_WIDTH }, { x: 1.574, y: FIELD_WIDTH }, { x: 0, y: 6.909 }],
  mirror('red', [{ x: 0, y: 4.818 }, { x: 4.572, y: 2.896 }, { x: 4.572, y: FIELD_WIDTH }, { x: 1.574, y: FIELD_WIDTH }, { x: 0, y: 6.909 }]),
];
export const CENTER_LINE = CX;

// ───────────────────────── towers, stations, staging ─────────────────────────

/** Truss center line, 66 in underside, three CLIMB PADS (24 in) [M p. 14, CAD]. */
export const TRUSS_X = 4.115;
export const TRUSS_HALF_DEPTH = 0.1525;
export const PAD_Y = [CY - 1.524, CY, CY + 1.524];
export const PAD_LENGTH = 0.6096;
export const trussX = (a: Alliance) => mirrorX(a, TRUSS_X);

/** SPEECH BUBBLE chute: slot in the SQUAD WALL z 0.77-0.98, spanning fy 0.11-1.32, curved trough outside [CAD]. */
export const CHUTE = { y0: 0.115, y1: 1.315, z0: 0.77, z1: 0.98 } as const;
/** STORY PANEL slide: three horizontal exit slots in the box behind the side guardrail, z 0.63-0.67 [CAD]. */
export const panelSlotX = (a: Alliance, k: number) => mirrorX(a, [3.1796, 2.2796, 1.3796][k]);
export const PANEL_SLOT_Z = 0.65;
export const PROTECTIVE_BARRIER_X = 4.5626; // fx of the low barrier separating the COLLECTOR ZONE (sx ±3.667)

/** Staged pieces from the CAD (the prepared field GLB had these copies removed). Manual p. 9-10. */
export const STAGED_BUBBLES: Record<Alliance, [number, number][]> = {
  blue: [5.1816, 6.4008, 7.62].flatMap(x => [2.8955, 3.5051, 4.1147, 4.7243, 5.3339].map(y => [x, y] as [number, number])),
  red: [8.8392, 10.0584, 11.2776].flatMap(x => [2.8955, 3.5051, 4.1147, 4.7243, 5.3339].map(y => [x, y] as [number, number])),
};
export const STAGED_PANELS: Record<Alliance, [number, number][]> = {
  blue: [2.286, 3.2004, 4.1148, 5.0292, 5.9436].map(y => [0.3556, y]),
  red: [2.286, 3.2004, 4.1148, 5.0292, 5.9436].map(y => [16.1036, y]),
};
