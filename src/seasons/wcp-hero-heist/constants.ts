import type { Alliance } from '@engine/coords';
import { inch, lb } from '@engine/units';

export const GAME_ID = 'wcp-hero-heist';
export const GAME_LABEL = 'WCP CADathon: Hero Heist';
/** Supplied manual pp. 2-3, 6. All dimensions in meters and times in seconds. */
export const FIELD_LENGTH = 54 * 0.3048;
export const FIELD_WIDTH = 27 * 0.3048;
export const AUTO_SECONDS = 15;
export const TELEOP_SECONDS = 120;
export const ENDGAME_SECONDS = 20;
export const SETTLE_SECONDS = 5;
export const DISTRICT_COUNT = 20;
export const FOUL_VALUES = { minor: 25, major: 50 };
export const TOWER_POINTS = [0, 20, 35, 50] as const;
export const PARK_POINTS = 5;
export const CLIMB_CLEARANCE = [0, inch(4), inch(35), inch(45)] as const;
export const TOWER_HEIGHT_LIMIT = inch(78);
export const TRUSS_CLEARANCE = inch(66);
export const MAX_EXTENSION = inch(18);
export const BUBBLE_RADIUS = inch(3.5);
export const BUBBLE_MASS = lb(5 / 16);
export const PANEL_RADIUS = inch(12);
export const PANEL_THICKNESS = inch(0.5);
export const PANEL_MASS = lb(2.75);
export const MAILBOX_CAPTURE_DEPTH = inch(8);
export const COLORS = { red: 0xe83d4f, blue: 0x337fe8, carpet: 0x555762 };

export type HeroClass = 'commander' | 'mystic' | 'gadgeteer';
export const CLASS_LIMITS = {
  commander: { perimeter: inch(120), mass: lb(125), startHeight: inch(60), height: inch(120), panels: 3, bubbles: 0 },
  mystic: { perimeter: inch(104), mass: lb(100), startHeight: inch(42), height: inch(42), panels: 0, bubbles: 6 },
  gadgeteer: { perimeter: inch(120), mass: lb(100), startHeight: inch(30), height: inch(60), panels: 2, bubbles: 4 },
} as const;

export type PieceKind = 'bubble' | 'panel';
export interface PieceIdentity { kind: PieceKind; color: Alliance }
/** Stable immutable ranges; these are the same IDs through every recycle. Manual pp. 9-10. */
export const PIECE_COUNT = 84;
export function pieceIdentity(index: number): PieceIdentity {
  if (!Number.isInteger(index) || index < 0 || index >= PIECE_COUNT) throw new RangeError(`Invalid Hero Heist piece ${index}`);
  return index < 30 ? { kind: 'bubble', color: 'red' }
    : index < 60 ? { kind: 'bubble', color: 'blue' }
    : index < 72 ? { kind: 'panel', color: 'red' }
    : { kind: 'panel', color: 'blue' };
}

export function legalPossession(hero: HeroClass, panels: number, bubbles: number): boolean {
  if (![panels, bubbles].every(n => Number.isInteger(n) && n >= 0)) return false;
  if (hero === 'commander') return bubbles === 0 && panels <= 3;
  if (hero === 'mystic') return panels === 0 && bubbles <= 6;
  return panels <= (bubbles ? 1 : 2) && bubbles <= (panels ? 3 : 4);
}

export function legalPreload(hero: HeroClass, panels: number, bubbles: number): boolean {
  return legalPossession(hero, panels, bubbles) && panels <= 1 && bubbles <= 3;
}
