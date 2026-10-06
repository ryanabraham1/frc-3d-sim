/**
 * 2026 REBUILT presented by Haas — every number the sim uses, with its source.
 *   [M x.y]  = Game Manual (TU22) section
 *   [TAG]    = official WPILib AprilTag layout 2026-rebuilt-welded.json (allwpilib v2026.2.1)
 *   [EST]    = estimated (not given in the manual text / figures); refine from official drawings/CAD
 * All positions are FIELD FRAME (WPILib): meters, origin at blue alliance wall, +x toward red.
 * Blue-side elements are defined here; red elements are the rotational mirror (L - x, W - y).
 */
import { inch } from '@engine/units';

// ─── Field [M 5.2] / [TAG] ──────────────────────────────────────────────────
export const FIELD_LENGTH = 16.541; // [TAG] 651.2in
export const FIELD_WIDTH = 8.069; // [TAG] 317.7in
export const CENTER_X = FIELD_LENGTH / 2;
export const CENTER_Y = FIELD_WIDTH / 2;

// ─── Zones [M 5.3] ──────────────────────────────────────────────────────────
export const ALLIANCE_ZONE_DEPTH = inch(158.6); // from alliance wall; includes ROBOT STARTING LINE
export const NEUTRAL_ZONE_DEPTH = inch(283);
export const TAPE_WIDTH = inch(2);
export const OUTPOST_AREA_WIDTH = inch(71);

// ─── HUB [M 5.4] ────────────────────────────────────────────────────────────
export const HUB_SIZE = inch(47);
export const HUB_CENTER = { x: 4.6256, y: 4.0346 }; // [TAG] midpoint of hub tags 18-21,24-27
export const HUB_OPENING_HEX = inch(41.7); // across flats
export const HUB_RIM_HEIGHT = inch(72); // front edge of opening
export const HUB_CUP_FLOOR = inch(58); // [EST] internal floor where the sensor array sits
export const HUB_WALL = inch(2.5); // [EST]
export const HUB_NET_HEIGHT = inch(40); // [EST] net above the rim on the neutral-zone side
export const HUB_EXIT_COUNT = 4; // [M 5.4 Fig 5-8]
export const HUB_EXIT_HEIGHT = inch(8); // [EST]
export const HUB_PROCESS_TIME: [number, number] = [0.5, 1.4]; // [EST] seconds from sensor to exit

// ─── BUMP [M 5.5] ───────────────────────────────────────────────────────────
export const BUMP_WIDTH = inch(73); // along y
export const BUMP_DEPTH = inch(44.4); // along x
export const BUMP_HEIGHT = inch(6.513);
export const BUMP_RAMP_DEG = 15;

// ─── TRENCH [M 5.6] ─────────────────────────────────────────────────────────
export const TRENCH_WIDTH = inch(65.65); // guardrail → bump
export const TRENCH_DEPTH = inch(47);
export const TRENCH_HEIGHT = inch(40.25);
export const TRENCH_OPENING_WIDTH = inch(50.34);
export const TRENCH_CLEARANCE = inch(22.25);
/** Tallest a robot may swell to under the TRENCH and still roll: Rapier needs ~1 cm to spare or it contacts the arm. */
export const TRENCH_SAFE_HEIGHT = TRENCH_CLEARANCE - inch(0.5);
export const TRENCH_OPENING_CENTER_Y = 0.6445; // [TAG] tags 17/28 centered on the opening
export const TRENCH_ARM_THICKNESS = inch(6); // [EST]
/** Arm cross-section along the field length: a square tube over the opening (Figure 5-10; the 47in depth is the pedestal). */
export const TRENCH_ARM_DEPTH = inch(6); // [EST]

// ─── DEPOT [M 5.7] ──────────────────────────────────────────────────────────
export const DEPOT_WIDTH = inch(42); // along wall (y)
export const DEPOT_DEPTH = inch(27); // into field (x)
export const DEPOT_BARRIER_W = inch(3);
export const DEPOT_BARRIER_H = inch(1.125);
export const DEPOT_CENTER_Y = 5.95; // [EST] opposite side of the tower from the outpost

// ─── TOWER [M 5.8] ──────────────────────────────────────────────────────────
export const TOWER_WIDTH = inch(49.25);
export const TOWER_DEPTH = inch(45);
export const TOWER_HEIGHT = inch(78.25);
export const TOWER_CENTER_Y = 3.7457; // [TAG] centered tower-wall tag 31
export const TOWER_BASE_WIDTH = inch(39);
export const TOWER_BASE_DEPTH = inch(45.18);
export const TOWER_BASE_THICKNESS = inch(0.28);
export const UPRIGHT_HEIGHT = inch(72.1);
export const UPRIGHT_THICK = inch(1.5); // along y
export const UPRIGHT_DEEP = inch(3.5); // along x
export const UPRIGHT_GAP = inch(32.25); // inner distance
export const UPRIGHT_X = TOWER_DEPTH - UPRIGHT_DEEP / 2; // [EST] uprights at the field-facing edge
export const RUNG_OD = inch(1.66);
export const RUNG_OVERHANG = inch(5.875); // beyond outer face of each upright
export const RUNG_HEIGHTS = [inch(27), inch(45), inch(63)]; // LOW, MID, HIGH centers
// GE-26500 sheet 2: support tube top at 35.125 in, 1.75 in deep.
export const TOWER_SUPPORT_TOP = inch(35.125);
export const TOWER_SUPPORT_THICK = inch(1.75);
export const TOWER_SUPPORT_Z: [number, number] = [inch(28.4), inch(43.375)];

// ─── ALLIANCE WALL / DRIVER STATIONS [M 5.9] ────────────────────────────────
export const WALL_BASE_HEIGHT = inch(36.8);
export const WALL_HEIGHT = inch(36.8 + 42);
export const WALL_THICK = inch(3);
/** Driver station centers along the blue wall; DS1 is on the blue drivers' left (+y). [EST] */
export const DS_Y_BLUE = [7.14, 5.29, 2.46];

// ─── OUTPOST [M 5.9.2] ──────────────────────────────────────────────────────
export const OUTPOST_CENTER_Y = 0.666; // [TAG] centered outpost tag 29
export const CHUTE_OPENING_W = inch(31.8);
export const CHUTE_OPENING_H = inch(7);
export const CHUTE_OPENING_Z = inch(28.1); // bottom of opening
export const CHUTE_CAPACITY = 25;
export const CORRAL_OPENING_W = inch(32);
export const CORRAL_OPENING_H = inch(7);
export const CORRAL_OPENING_Z = inch(1.88);
export const CORRAL_WIDTH = inch(35.8);
export const CORRAL_DEPTH = inch(37.6);
export const CORRAL_WALL_H = inch(8.13);

// ─── GUARDRAIL [M 5.2] ──────────────────────────────────────────────────────
export const GUARDRAIL_HEIGHT = inch(20);

// ─── FUEL [M 5.10.1] / staging [M 6.3.4] ────────────────────────────────────
export const FUEL_DIAMETER = inch(5.91);
export const FUEL_MASS = 0.215; // 0.203-0.227 kg
export const FUEL_TOTAL = 504;
export const FUEL_PER_DEPOT = 24;
export const FUEL_PER_CHUTE = 24;
export const FUEL_MAX_PRELOAD = 8;
export const NEUTRAL_STAGING_W = inch(206); // along y
export const NEUTRAL_STAGING_D = inch(72); // along x
export const NEUTRAL_DIVIDER = inch(2);

// ─── ROBOT limits [M 8] ─────────────────────────────────────────────────────
export const MAX_ROBOT_HEIGHT = inch(30); // R104 / R107
export const MAX_ROBOT_PERIMETER = inch(110); // R104

// ─── Colors ─────────────────────────────────────────────────────────────────
export const COLORS = {
  red: 0xd32f2f,
  blue: 0x1e62d0,
  redDark: 0x8e1b1b,
  blueDark: 0x123e87,
  carpet: 0x5b6068,
  white: 0xf2f2f2,
  steel: 0x8a9099,
  darkSteel: 0x3a3f47,
  alu: 0xb9bec6,
  poly: 0xcfe3ff,
  fuel: 0xf5c518,
  net: 0x222222,
};
