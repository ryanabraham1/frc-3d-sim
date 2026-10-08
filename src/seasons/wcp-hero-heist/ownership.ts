import type { Alliance } from '@engine/coords';
import type { PieceKind } from './constants';
import { DISTRICT_COUNT } from './constants';

export interface Ownership { support: Alliance | null; strength: number }
export type OwnershipLevel = 'neutral' | 'partial' | 'full';
export type ScoringPhase = 'auto' | 'teleop';
export const levelOf = (state: Ownership): OwnershipLevel => state.strength === 4 ? 'full' : state.strength >= 2 ? 'partial' : 'neutral';
export const ownershipPoints = (state: Ownership): number => state.strength === 4 ? 25 : state.strength >= 2 ? 10 : 0;

function validate(state: Ownership): void {
  if (!Number.isInteger(state.strength) || state.strength < 0 || state.strength > 4
    || (state.strength === 0 ? state.support !== null : state.support !== 'red' && state.support !== 'blue')) {
    throw new RangeError('District support must be canonical, with strength 0..4');
  }
}

/**
 * Manual pp. 4-5, 16-17. Points use pre-event ownership; strength never overflows across colors.
 * Provisional D2: a panel opposing strength 1 neutralizes that support, with no excess transfer,
 * following the manual's clamp/no-overflow principle. This case is not explicit in the panel row.
 */
export function applyPiece(state: Ownership, color: Alliance, kind: PieceKind, phase: ScoringPhase): { state: Ownership; fame: number } {
  validate(state);
  const owned = levelOf(state) !== 'neutral';
  const own = state.support === color;
  const fame = kind === 'panel' ? 0 : owned ? own ? (phase === 'auto' ? 6 : 3) : 0 : phase === 'auto' ? 2 : 1;
  let support = state.support, strength = state.strength;
  if (kind === 'bubble') {
    if (!owned || !own) {
      if (support !== null && !own) strength--;
      else { support = color; strength = Math.min(4, strength + 1); }
    }
  } else if (support !== null && !own) strength = Math.max(0, strength - 4);
  else { support = color; strength = Math.min(4, strength + 2); }
  return { fame, state: { support: strength ? support : null, strength } };
}

export interface OwnershipSnapshot {
  districts: Ownership[];
  autoFull: Record<Alliance, number[]>;
  partialHistory: Record<Alliance, number[]>;
  fullHistory: Record<Alliance, number[]>;
}

/** Pure state machine. Host calls accept once per verified physical sensor crossing. */
export class DistrictOwnership {
  readonly districts: Ownership[] = Array.from({ length: DISTRICT_COUNT }, () => ({ support: null, strength: 0 }));
  readonly autoFull: Record<Alliance, Set<number>> = { red: new Set(), blue: new Set() };
  readonly partialHistory: Record<Alliance, Set<number>> = { red: new Set(), blue: new Set() };
  readonly fullHistory: Record<Alliance, Set<number>> = { red: new Set(), blue: new Set() };

  accept(id: number, color: Alliance, kind: PieceKind, phase: ScoringPhase): { fame: number; bonus: number } {
    if (!Number.isInteger(id) || !this.districts[id]) throw new RangeError(`Invalid district ${id}`);
    const event = applyPiece(this.districts[id], color, kind, phase);
    this.districts[id] = event.state;
    let bonus = 0;
    const { support, strength } = event.state;
    if (support && strength >= 2) this.partialHistory[support].add(id);
    if (support && strength === 4) {
      this.fullHistory[support].add(id);
      if (phase === 'auto' && !this.autoFull[support].has(id)) { this.autoFull[support].add(id); bonus = 10; }
    }
    return { fame: event.fame, bonus };
  }

  points(color: Alliance): number {
    return this.districts.reduce((sum, d) => sum + (d.support === color ? ownershipPoints(d) : 0), 0);
  }

  count(color: Alliance, level: OwnershipLevel): number {
    return this.districts.filter(d => d.support === color && levelOf(d) === level).length;
  }

  snapshot(): OwnershipSnapshot {
    const sets = (value: Record<Alliance, Set<number>>) => ({ red: [...value.red].sort((a,b) => a-b), blue: [...value.blue].sort((a,b) => a-b) });
    return { districts: this.districts.map(d => ({ ...d })), autoFull: sets(this.autoFull), partialHistory: sets(this.partialHistory), fullHistory: sets(this.fullHistory) };
  }

  restore(snapshot: OwnershipSnapshot): void {
    if (snapshot.districts.length !== DISTRICT_COUNT) throw new RangeError('Expected 20 districts');
    snapshot.districts.forEach(validate);
    for (const name of ['autoFull', 'partialHistory', 'fullHistory'] as const) {
      for (const color of ['red', 'blue'] as const) {
        if (!snapshot[name][color].every(id => Number.isInteger(id) && id >= 0 && id < DISTRICT_COUNT)) throw new RangeError('Invalid district history');
      }
    }
    this.districts.splice(0, DISTRICT_COUNT, ...snapshot.districts.map(d => ({ ...d })));
    for (const name of ['autoFull', 'partialHistory', 'fullHistory'] as const) for (const color of ['red', 'blue'] as const) {
      this[name][color].clear(); snapshot[name][color].forEach(id => this[name][color].add(id));
    }
  }
}
