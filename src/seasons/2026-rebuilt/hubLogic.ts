/**
 * PURE hub-status logic for REBUILT [M 6.4.1, Table 6-3, Table 5-3]. No engine/physics imports so it
 * can be unit tested and run server-side.
 */
import type { Alliance } from '@engine/coords';

export const GRACE_SECONDS = 3; // [M 6.5] fuel counts up to 3 s after deactivation / period end
export const WARNING_SECONDS = 3; // [Table 5-3] pulse before deactivation

export type RebuiltPeriodId = 'auto' | 'auto-pause' | 'transition' | 'shift1' | 'shift2' | 'shift3' | 'shift4' | 'endgame' | 'post';

/**
 * Is `alliance`'s hub active during `periodId`?
 * `firstInactive` = the alliance whose hub is inactive in SHIFT 1 (the one that scored MORE fuel in AUTO,
 * or the FMS random pick on a tie). Null before it is decided.
 */
export function hubActive(periodId: string, alliance: Alliance, firstInactive: Alliance | null): boolean {
  switch (periodId) {
    case 'auto':
    case 'transition':
    case 'endgame':
      return true;
    case 'shift1':
    case 'shift3':
      return firstInactive === null ? true : alliance !== firstInactive;
    case 'shift2':
    case 'shift4':
      return firstInactive === null ? true : alliance === firstInactive;
    default:
      return false;
  }
}

/** The alliance that scored MORE fuel in AUTO is inactive first. Tie → random (coin in [0,1)). */
export function decideFirstInactive(redAutoFuel: number, blueAutoFuel: number, coin: number): Alliance {
  if (redAutoFuel > blueAutoFuel) return 'red';
  if (blueAutoFuel > redAutoFuel) return 'blue';
  return coin < 0.5 ? 'red' : 'blue';
}

/** Tracks when each hub was last active so fuel arriving within the grace window still counts. */
export class HubGrace {
  lastActive: Record<Alliance, number> = { red: -Infinity, blue: -Infinity };

  update(t: number, periodId: string, firstInactive: Alliance | null): void {
    for (const a of ['red', 'blue'] as Alliance[]) if (hubActive(periodId, a, firstInactive)) this.lastActive[a] = t;
  }

  counts(alliance: Alliance, t: number, periodId: string, firstInactive: Alliance | null): boolean {
    return hubActive(periodId, alliance, firstInactive) || t - this.lastActive[alliance] <= GRACE_SECONDS + 1e-9;
  }

  reset(): void {
    this.lastActive = { red: -Infinity, blue: -Infinity };
  }
}

/** Fuel scored during AUTO (or its 3 s assessment window) counts as AUTO fuel. */
export function isAutoScoringPeriod(periodId: string): boolean {
  return periodId === 'auto' || periodId === 'auto-pause';
}

export type HubLight = 'off' | 'active' | 'warning' | 'chase' | 'post';

/** Hub light state per Table 5-3. */
export function hubLight(
  periodId: string | null,
  periodRemaining: number,
  alliance: Alliance,
  firstInactive: Alliance | null,
  nextPeriodId: string | null,
): HubLight {
  if (periodId === null) return 'off';
  if (periodId === 'post') return 'post';
  const active = hubActive(periodId, alliance, firstInactive);
  if (!active) return 'off';
  const willDeactivate = nextPeriodId === null || nextPeriodId === 'post' || !hubActive(nextPeriodId, alliance, firstInactive);
  if (willDeactivate && periodRemaining <= WARNING_SECONDS) return 'warning';
  if (periodId === 'transition' && alliance === firstInactive) return 'chase';
  return 'active';
}

/** Next time (seconds from now) this alliance's hub becomes active, given the timeline. */
export function secondsUntilActive(
  periods: { id: string; duration: number }[],
  index: number,
  periodRemaining: number,
  alliance: Alliance,
  firstInactive: Alliance | null,
): number {
  if (index < periods.length && hubActive(periods[index].id, alliance, firstInactive)) return 0;
  let t = periodRemaining;
  for (let i = index + 1; i < periods.length; i++) {
    if (hubActive(periods[i].id, alliance, firstInactive)) return t;
    t += periods[i].duration;
  }
  return Infinity;
}

/** Seconds of activity remaining in the current active stretch (0 if inactive now). */
export function secondsActiveRemaining(
  periods: { id: string; duration: number }[],
  index: number,
  periodRemaining: number,
  alliance: Alliance,
  firstInactive: Alliance | null,
): number {
  if (index >= periods.length || !hubActive(periods[index].id, alliance, firstInactive)) return 0;
  let t = periodRemaining;
  for (let i = index + 1; i < periods.length; i++) {
    if (!hubActive(periods[i].id, alliance, firstInactive)) break;
    t += periods[i].duration;
  }
  return t;
}
