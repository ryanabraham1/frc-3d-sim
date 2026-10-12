import type { RankedParticipant, RatingChange } from '../src/engine/net/ranked.ts';
import type { MatchRecord } from './rankedStore.ts';

/** Full gains for three wins, then a sharp taper for a one-sided streak. */
export const REPEAT_GAIN = [1, 1, 1, 0.5, 0.2, 0.1, 0] as const;
export const REPEAT_HISTORY_LIMIT = REPEAT_GAIN.length - 1;

/** Consecutive wins over each rival; a loss, draw or different rival breaks the streak. */
export function repeatGain(playerId: string, players: RankedParticipant[], history: MatchRecord[]): number {
  const me = players.find((p) => p.playerId === playerId)!;
  let longest = 0;
  for (const opponent of players.filter((p) => p.team !== me.team)) {
    let count = 0;
    for (const match of history) {
      if (match.status === 'void') continue;
      const priorMe = match.players.find((p) => p.playerId === playerId);
      if (!priorMe || priorMe.result !== 'win' || !match.players.some((p) => p.playerId === opponent.playerId && p.team !== priorMe.team)) break;
      count++;
    }
    longest = Math.max(longest, count);
  }
  return REPEAT_GAIN[Math.min(longest, REPEAT_HISTORY_LIMIT)];
}

/** Only gains are reduced; losing or abandoning a repeated match still carries the usual cost. */
export function reduceRepeatGain(change: RatingChange, multiplier: number): RatingChange {
  if (change.delta <= 0) return change;
  const delta = Math.floor(change.delta * multiplier);
  return { ...change, delta, after: change.before + delta };
}
