import type { Alliance } from '@engine/coords';
import { inch } from '@engine/units';

/*
 * 2024 CRESCENDO presented by Haas — every number here comes from the supplied `2024GameManual.pdf`
 * (kickoff release V0, 149 pages). Provenance tags:
 *   [M x.y]  stated in the manual text, section x.y
 *   [FIG n]  measured off manual figure n (top-view figures are ~1.2 px/in; ±2 in typical)
 *   [EST]    not given by the manual; a plausible value chosen for the simulation
 * Coordinates are WPILib field coordinates (meters): blue ALLIANCE WALL at x = 0, +y is the blue
 * drivers' left (the AMP side). The field is MIRROR-symmetric: red = (L − x, y). [FIG 5-4, 6-2]
 */

export const FIELD_LENGTH = inch(54 * 12 + 3.25); // [M 5.1] 54 ft 3¼ in
export const FIELD_WIDTH = inch(26 * 12 + 11.25); // [M 5.1] 26 ft 11¼ in
export const L = FIELD_LENGTH;
export const W = FIELD_WIDTH;

export const COLORS = {
  blue: 0x1f5fd6,
  red: 0xd9303a,
  carpet: 0x3b3d42,
  note: 0xf0741d,
  steel: 0xb4bcc6,
  truss: 0xd7dbe0,
  poly: 0xbfd6e6,
  dark: 0x24282e,
} as const;

// ── GAME PIECES [M 5.7] ──────────────────────────────────────────────────────────────
export const NOTE_OUTER_RADIUS = inch(14) / 2; // 1 ft 2 in OD
export const NOTE_INNER_RADIUS = inch(10) / 2; // 10 in ID
export const NOTE_THICKNESS = inch(2);
export const NOTE_MASS = 0.2353; // 8.3 oz
/** Staged NOTES [M 6.3.4]: 90 in SOURCE AREAS + 6 WING + 5 CENTER LINE + 6 preload/extra = 107. */
export const NOTE_COUNT = 107;
export const FIELD_NOTES = 11;
export const SOURCE_NOTES_PER_ALLIANCE = 45;
export const PRELOADS_PER_ALLIANCE = 3;
/** 3 HIGH NOTES staged on top of each AMP [M 6.3.4]. */
export const HIGH_NOTES_PER_ALLIANCE = 3;
export const HIGH_NOTE_START = NOTE_COUNT;
export const PIECE_COUNT = NOTE_COUNT + 2 * HIGH_NOTES_PER_ALLIANCE;
export const isHighNote = (i: number) => i >= HIGH_NOTE_START;

// ── ZONES & MARKINGS [M 5.2] ─────────────────────────────────────────────────────────
export const TAPE = inch(2);
/** ROBOT STARTING ZONE: 6 ft 4⅛ in deep from the ALLIANCE WALL (x), 23 ft 8⅛ in long (y). */
export const START_ZONE_DEPTH = inch(76.125);
export const START_ZONE_LENGTH = inch(284.125);
/** AMP ZONE: 10 ft 10 in along the guardrail × 1 ft 5¾ in deep. */
export const AMP_ZONE_LENGTH = inch(130);
export const AMP_ZONE_DEPTH = inch(17.75);
/** SOURCE ZONE: parallelogram 1 ft 6¾ in deep from the SOURCE wall. */
export const SOURCE_ZONE_DEPTH = inch(18.75);
/** WING line (ALLIANCE-colored, spans the field) [FIG 5-4/6-2: ≈229½ in from the wall]. */
export const WING_DEPTH = inch(229.5);
/** STARTING LINE is 2 ft behind the ALLIANCE WALL (human side) [M 5.2]. */
export const STARTING_LINE = inch(24);
/** ALLIANCE AREA 9 ft 10¼ in deep behind the wall [M 5.2]. */
export const ALLIANCE_AREA_DEPTH = inch(118.25);

// ── ALLIANCE WALL & SPEAKER [M 5.6] ──────────────────────────────────────────────────
/** SPEAKER center (y) — in line with the middle WING SPIKE MARK [FIG 5-4/6-2]. */
export const SPEAKER_Y = W / 2 + inch(57);
export const SPEAKER_OPENING_BOTTOM = inch(78); // lowest edge = top of the ALLIANCE WALL
export const SPEAKER_OPENING_TOP = inch(82.875); // highest edge (the hood lip)
export const SPEAKER_OPENING_WIDTH = inch(41.375);
export const SPEAKER_OPENING_DEPTH = inch(18); // "extends … (~46 cm) into the FIELD"
/** The opening plane rises 14° [M 5.6.1]; wall top → lip. */
export const SPEAKER_OPENING_ANGLE = (14 * Math.PI) / 180;
/** Hood/roof and cavity sizes [EST]. */
export const SPEAKER_HOOD_TOP = inch(98);
export const SPEAKER_HOOD_HALF_WIDTH = inch(31);
export const SPEAKER_CAVITY_DEPTH = inch(26);
export const SUBWOOFER_HEIGHT = inch(37); // 3 ft 1 in
export const SUBWOOFER_PANEL = inch(8.375); // vertical panels
export const SUBWOOFER_DEPTH = inch(36.125); // 3 ft ⅛ in from the wall
export const SUBWOOFER_BACK_HALF_WIDTH = inch(40.5); // [FIG 5-4]
export const SUBWOOFER_FRONT_HALF_WIDTH = inch(18.75); // [FIG 5-4]
/** DRIVER STATION: 3 ft ¾ in base + 3 ft 6 in plastic [M 5.6.2]. */
export const DS_HEIGHT = inch(36.75 + 42);
/** Wall end at the SOURCE (y) and DRIVER STATION spans (y), measured from [FIG 5-4]. DS 1 on the AMP side [EST]. */
export const WALL_SOURCE_END_Y = inch(41.3);
export const SPEAKER_SECTION_HALF = inch(30);
export const DS_SPANS: [number, number][] = [
  [SPEAKER_Y + SPEAKER_SECTION_HALF, W],
  [inch(115), SPEAKER_Y - SPEAKER_SECTION_HALF],
  [WALL_SOURCE_END_Y, inch(115)],
];

// ── AMP [M 5.3] ─────────────────────────────────────────────────────────────────────
export const AMP_FROM_WALL = inch(49.5); // 4 ft 1½ in from the closest ALLIANCE WALL (near edge)
export const AMP_WIDTH = inch(42); // housing width along the guardrail [FIG 5-4]
export const AMP_X = AMP_FROM_WALL + AMP_WIDTH / 2;
export const AMP_POCKET_WIDTH = inch(24);
export const AMP_POCKET_HEIGHT = inch(18);
export const AMP_POCKET_DEPTH = inch(3.875);
export const AMP_POCKET_BOTTOM = inch(26);
export const AMP_HEIGHT = inch(62); // [EST] above the tag panel (48⅛ in + 10½ in)
export const AMP_HOUSING_DEPTH = inch(14); // [EST] outside the field boundary

// ── SOURCE [M 5.4] ──────────────────────────────────────────────────────────────────
/** SOURCE wall runs from the wall end (0, 41.3 in) to the guardrail (68 in, 0) at the corner [FIG 5-4]. */
export const SOURCE_WALL_END_X = inch(68);
export const SOURCE_OPENING_WIDTH = inch(75.25);
export const SOURCE_OPENING_BOTTOM = inch(36.75);
export const SOURCE_OPENING_HEIGHT = inch(6);
export const SOURCE_WALL_HEIGHT = inch(80); // [EST]

// ── GUARDRAIL [M 5.1] ───────────────────────────────────────────────────────────────
export const GUARDRAIL_HEIGHT = inch(20);

// ── STAGE [M 5.5] ───────────────────────────────────────────────────────────────────
/** Truss feet nearest the wall start 10 ft 1 in from it; legs form an equilateral triangle [FIG 5-4/6-2]. */
export const STAGE_NEAR_EDGE = inch(121);
export const STAGE_LEG_RADIUS = inch(58.7); // center → leg center [FIG 6-2]
export const STAGE_LEG_SIZE = inch(12); // square truss [FIG 5-8]
export const STAGE_FOOT_SIZE = inch(22); // [FIG 6-2]
export const STAGE_X = STAGE_NEAR_EDGE + STAGE_FOOT_SIZE / 2 + STAGE_LEG_RADIUS;
export const STAGE_Y = W / 2;
export const STAGE_TRUSS_BOTTOM = inch(64); // [EST]
export const STAGE_TRUSS_TOP = inch(76); // [EST]
/** Clearance under the core: 2 ft 3⅞ in at the gusset plates (2 ft 4¼ in elsewhere). */
export const STAGE_CLEARANCE = inch(27.875);
export const STAGE_CORE_TOP = inch(88.25 - 12); // MICROPHONE (12 in tall) mounts on top of the core
export const CHAIN_ANCHOR_HEIGHT = inch(48);
export const CHAIN_LOW_POINT = inch(28.25);
export const CHAIN_TO_CORE = inch(16.625);
/** Chain line = line between leg centers: apothem R/2. Core wide faces sit 16⅝ in inside it. */
export const CHAIN_APOTHEM = STAGE_LEG_RADIUS / 2;
export const CORE_APOTHEM = CHAIN_APOTHEM - CHAIN_TO_CORE;
export const CORE_WIDE_FACE = inch(24); // [EST]
export const TRAP_OPENING_BOTTOM = inch(56.5);
export const TRAP_WIDTH = inch(18); // [EST]
export const STAGE_TAG_BOTTOM = inch(47.5);
export const MIC_TOP = inch(88.25);
export const MIC_LENGTH = inch(12);
export const MIC_RADIUS = inch(1.66) / 2;
export const PODIUM_HEIGHT = inch(17.75);
export const PODIUM_WIDTH = inch(10);
/** STAGE ZONE hexagon in stage-local coordinates (+x points away from the ALLIANCE WALL) [FIG 5-5/6-2]. */
export const STAGE_ZONE_LOCAL: [number, number][] = [
  [-66.7, 7], [26.3, 58], [37.8, 52.6], [37.8, -52.6], [26.3, -58], [-66.7, -7],
].map(([x, y]) => [inch(x), inch(y)]);

/** Chains in stage-local frame: outward normal angle. Names per [FIG 5-9] from the blue drivers' view. */
export const CHAINS = [
  { key: 'center', normal: 0 },
  { key: 'left', normal: (2 * Math.PI) / 3 },
  { key: 'right', normal: (-2 * Math.PI) / 3 },
] as const;
export type ChainIndex = 0 | 1 | 2;
export const chainLabel = (a: Alliance, c: number) => {
  const k = CHAINS[c].key;
  if (k === 'center') return 'CENTER STAGE';
  // Red stage is mirrored, so its left/right swap with respect to +y [FIG 5-9].
  const left = (k === 'left') === (a === 'blue');
  return left ? 'STAGE LEFT' : 'STAGE RIGHT';
};

// ── SPIKE MARKS [M 6.3.4, FIG 6-2] ──────────────────────────────────────────────────
export const WING_SPIKE_X = inch(114); // 9 ft 6 in from the ALLIANCE WALL
export const WING_SPIKE_SPACING = inch(57); // 4 ft 9 in
export const CENTER_SPIKE_SPACING = inch(66); // 5 ft 6 in

// ── MATCH [M 6.4, 6.5] ──────────────────────────────────────────────────────────────
export const AUTO_SECONDS = 15;
export const TELEOP_SECONDS = 135;
export const ENDGAME_SECONDS = 20; // "last 20 seconds" (G422, G424, G430)
export const COOP_WINDOW = 45; // first 45 s of TELEOP [M 6.5.5]
export const AMPLIFY_SECONDS = 10;
export const AMPLIFY_GRACE = 3;
export const SPEAKER_GRACE = 3; // assessment continues 3 s after 0:00 [M 6.5 A/B]
export const STAGE_ASSESS_DELAY = 5; // [M 6.5 C]

/** Table 6-2 point values. */
export const POINTS = {
  leave: 2,
  ampAuto: 2,
  ampTeleop: 1,
  speakerAuto: 5,
  speakerTeleop: 2,
  speakerAmplified: 5,
  park: 1,
  onstage: 3,
  onstageSpotlit: 4,
  harmony: 2,
  trap: 5,
} as const;
export const MELODY_NOTES = 18;
export const MELODY_NOTES_COOP = 15;
export const ENSEMBLE_STAGE_POINTS = 10;
export const ENSEMBLE_ONSTAGE = 2;
/** Table 6-3: FOUL = 2, TECH FOUL = 5 (credited to the opponent). */
export const FOULS = { minor: 2, major: 5 } as const;

/** Robot limits [M 8.1]: R104 ≤ 120 in FRAME PERIMETER, ≤ 4 ft tall; R105 12 in extension. */
export const MAX_ROBOT_HEIGHT = inch(48);
export const MAX_PERIMETER = inch(120);

// ── helpers ─────────────────────────────────────────────────────────────────────────
/** Mirror a blue-side point to the given alliance (the field is mirror-symmetric across the CENTER LINE). */
export const side = (a: Alliance, x: number, y: number) => (a === 'blue' ? { x, y } : { x: L - x, y });
/** Mirror a blue-side heading. */
export const sideYaw = (a: Alliance, yaw: number) => (a === 'blue' ? yaw : Math.PI - yaw);
/** Distance from an alliance's own wall along +x toward the field. */
export const fromWall = (a: Alliance, x: number) => (a === 'blue' ? x : L - x);

export const speakerCenter = (a: Alliance) => side(a, 0, SPEAKER_Y);
/** Where to point a chassis-aimed shooter: the middle of the 18 in-deep SPEAKER opening. */
export const speakerAim = (a: Alliance) => side(a, SPEAKER_OPENING_DEPTH / 2, SPEAKER_Y);
export const ampCenter = (a: Alliance) => side(a, AMP_X, W);
export const stageCenter = (a: Alliance) => side(a, STAGE_X, STAGE_Y);

/** Stage-local (blue orientation) → field, for an alliance. */
export function stagePoint(a: Alliance, lx: number, ly: number) {
  return side(a, STAGE_X + lx, STAGE_Y + ly);
}

/** Leg centers (blue-local): near leg toward the wall, two far legs toward the CENTER LINE. */
export const LEG_LOCAL: [number, number][] = [Math.PI, Math.PI / 3, -Math.PI / 3].map((t) => [STAGE_LEG_RADIUS * Math.cos(t), STAGE_LEG_RADIUS * Math.sin(t)]);
/** Legs each chain spans between (indices into LEG_LOCAL). */
export const CHAIN_LEGS: [number, number][] = [[1, 2], [0, 1], [2, 0]];

/** A chain's endpoints / midpoint / outward normal in field coordinates. */
export function chainGeometry(a: Alliance, c: number) {
  const [i, j] = CHAIN_LEGS[c];
  const p0 = stagePoint(a, LEG_LOCAL[i][0], LEG_LOCAL[i][1]);
  const p1 = stagePoint(a, LEG_LOCAL[j][0], LEG_LOCAL[j][1]);
  const n = sideYaw(a, CHAINS[c].normal);
  const mid = { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 };
  const dir = Math.atan2(p1.y - p0.y, p1.x - p0.x);
  return { p0, p1, mid, normal: n, dir, span: Math.hypot(p1.x - p0.x, p1.y - p0.y) };
}

/** Core (hexagon) vertices, blue-local: wide faces (toward the chains) and narrow faces (toward the legs). */
export function coreLocal(): [number, number][] {
  const out: [number, number][] = [];
  for (const c of CHAINS) {
    const nx = Math.cos(c.normal), ny = Math.sin(c.normal);
    const tx = -ny, ty = nx;
    const h = CORE_WIDE_FACE / 2;
    out.push([CORE_APOTHEM * nx - h * tx, CORE_APOTHEM * ny - h * ty], [CORE_APOTHEM * nx + h * tx, CORE_APOTHEM * ny + h * ty]);
  }
  return out;
}

/** MICROPHONE top point for a chain's TRAP face. */
export function micPoint(a: Alliance, c: number) {
  const n = CHAINS[c].normal;
  const r = CORE_APOTHEM - inch(3);
  return { ...stagePoint(a, r * Math.cos(n), r * Math.sin(n)), z: MIC_TOP };
}

/** TRAP (behind a wide face) center, field coordinates. */
export function trapPoint(a: Alliance, c: number) {
  const n = CHAINS[c].normal;
  const r = CORE_APOTHEM - inch(4);
  return { ...stagePoint(a, r * Math.cos(n), r * Math.sin(n)), z: TRAP_OPENING_BOTTOM + inch(4) };
}

/** STAGE ZONE polygon in field coordinates. */
export function stageZone(a: Alliance): { x: number; y: number }[] {
  return STAGE_ZONE_LOCAL.map(([x, y]) => stagePoint(a, x, y));
}

/** PODIUM face center (on the near leg, facing the wall). */
export function podium(a: Alliance) {
  const [lx, ly] = LEG_LOCAL[0];
  return stagePoint(a, lx - STAGE_LEG_SIZE / 2 - inch(0.5), ly);
}

// SOURCE geometry (blue-end corner; a SOURCE belongs to the alliance whose robots use it, i.e. the one at
// the OPPONENT's end — the red SOURCE is at the blue end [FIG 5-4]).
const srcDir = { x: SOURCE_WALL_END_X, y: -WALL_SOURCE_END_Y };
const srcLen = Math.hypot(srcDir.x, srcDir.y);
export const SOURCE_WALL_LENGTH = srcLen;
/** Unit vector along the SOURCE wall (from the wall end toward the guardrail), blue end. */
export const SOURCE_TANGENT = { x: srcDir.x / srcLen, y: srcDir.y / srcLen };
/** Inward (field-facing) normal of the SOURCE wall, blue end. */
export const SOURCE_NORMAL = { x: -srcDir.y / srcLen, y: srcDir.x / srcLen };

/** The end of the field where an alliance's SOURCE is (the opponent's end). */
export const sourceEnd = (a: Alliance): Alliance => (a === 'blue' ? 'red' : 'blue');

/** Point on a SOURCE wall: `t` along the wall (0 = wall end, 1 = guardrail end), `n` meters into the field. */
export function sourcePoint(a: Alliance, t: number, n = 0) {
  const x = SOURCE_TANGENT.x * srcLen * t + SOURCE_NORMAL.x * n;
  const y = WALL_SOURCE_END_Y + SOURCE_TANGENT.y * srcLen * t + SOURCE_NORMAL.y * n;
  return side(sourceEnd(a), x, y);
}

/** SOURCE ZONE polygon: the parallelogram between the SOURCE wall, the (opponent's) ALLIANCE WALL line and the tape. */
export function sourceZone(a: Alliance): { x: number; y: number }[] {
  const d = SOURCE_ZONE_DEPTH;
  // Tape line: SOURCE wall shifted inward by d. Its ends lie on x = 0 and x = SOURCE_WALL_END_X (parallel sides).
  const tapeAt = (x: number) => {
    const p0 = { x: SOURCE_NORMAL.x * d, y: WALL_SOURCE_END_Y + SOURCE_NORMAL.y * d };
    const k = (x - p0.x) / SOURCE_TANGENT.x;
    return { x, y: p0.y + SOURCE_TANGENT.y * k };
  };
  const blue = [{ x: 0, y: WALL_SOURCE_END_Y }, { x: SOURCE_WALL_END_X, y: 0 }, tapeAt(SOURCE_WALL_END_X), tapeAt(0)];
  return blue.map((p) => side(sourceEnd(a), p.x, p.y));
}

export function ampZone(a: Alliance): { x: number; y: number }[] {
  return [side(a, 0, W - AMP_ZONE_DEPTH), side(a, AMP_ZONE_LENGTH, W - AMP_ZONE_DEPTH), side(a, AMP_ZONE_LENGTH, W), side(a, 0, W)];
}

/** ROBOT STARTING ZONE (excludes the AMP ZONE and the opponent's SOURCE ZONE). */
export function startZone(a: Alliance): { x: number; y: number }[] {
  const y1 = W - AMP_ZONE_DEPTH;
  const y0 = y1 - START_ZONE_LENGTH;
  return [side(a, 0, y0), side(a, START_ZONE_DEPTH, y0), side(a, START_ZONE_DEPTH, y1), side(a, 0, y1)];
}

export function wingZone(a: Alliance): { x: number; y: number }[] {
  return [side(a, 0, 0), side(a, WING_DEPTH, 0), side(a, WING_DEPTH, W), side(a, 0, W)];
}

/** Wing spike note positions (blue: lowest on the field center line, then toward the AMP). */
export const wingSpikes = (a: Alliance) => [0, 1, 2].map((k) => side(a, WING_SPIKE_X, W / 2 + k * WING_SPIKE_SPACING));
export const centerSpikes = () => [-2, -1, 0, 1, 2].map((k) => ({ x: L / 2, y: W / 2 + k * CENTER_SPIKE_SPACING }));
