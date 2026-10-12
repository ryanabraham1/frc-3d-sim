import { describe, expect, it } from 'vitest';
import { repeatGain, reduceRepeatGain } from '../server/repeatedOpponents';
import { MemoryStore, type MatchRecord } from '../server/rankedStore';
import { RANKED_SEASON_ID, type RankedParticipant } from '../src/engine/net/ranked';

const players: RankedParticipant[] = [
  { playerId: 'a', team: 'red', rating: 1000, games: 20 },
  { playerId: 'b', team: 'blue', rating: 1000, games: 20 },
];
const match = (roster = players, status: MatchRecord['status'] = 'final'): MatchRecord => ({
  mode: '1v1', season: RANKED_SEASON_ID, outcome: 'red', redScore: 1, blueScore: 0, status,
  players: roster.map((p) => ({ ...p, name: p.playerId, before: p.rating, after: p.rating, result: p.playerId === 'a' ? 'win' : 'loss' })),
});

describe('repeated opponents', () => {
  it('allows three full wins then dramatically reduces gains to zero', () => {
    for (const [count, multiplier] of [1, 1, 1, 0.5, 0.2, 0.1, 0, 0].entries()) {
      expect(repeatGain('a', players, Array.from({ length: count }, () => match()))).toBe(multiplier);
      expect(reduceRepeatGain({ playerId: 'a', before: 1000, after: 1014, delta: 14, result: 'win' }, multiplier).delta).toBe(Math.floor(14 * multiplier));
    }
  });

  it('keeps losses, abandons and no-change results intact', () => {
    for (const result of ['loss', 'abandon', 'none'] as const) {
      const change = { playerId: 'a', before: 1000, after: 980, delta: -20, result };
      expect(reduceRepeatGain(change, 0)).toEqual(change);
    }
    expect(reduceRepeatGain({ playerId: 'a', before: 1000, after: 1014, delta: 14, result: 'draw' }, 0.2).after).toBe(1002);
  });

  it('breaks the streak on a different opponent, but ignores void matches and unrelated games', async () => {
    const s = new MemoryStore();
    await s.saveMatch(match(), []);
    await s.saveMatch(match(), []);
    await s.saveMatch(match(), []);
    await s.saveMatch(match(), []);
    await s.saveMatch(match(players, 'void'), []);
    await s.saveMatch(match(players.map((p) => ({ ...p, playerId: `${p.playerId}other` }))), []);
    await s.saveMatch({ ...match(), season: 'old-season' }, []);
    expect(repeatGain('a', players, await s.recentMatches('a', 6))).toBe(0.2);
    await s.saveMatch(match([players[0], { ...players[1], playerId: 'c' }]), []);
    expect(repeatGain('a', players, await s.recentMatches('a', 6))).toBe(1);
  });

  it('tracks each rival across colour changes, team changes and modes', () => {
    const swapped = players.map((p) => ({ ...p, team: p.team === 'red' ? 'blue' as const : 'red' as const }));
    const teamPlayers = [...players, { ...players[0], playerId: 'c' }, { ...players[1], playerId: 'd' }];
    expect(repeatGain('a', teamPlayers, [{ ...match(swapped), mode: '2v2' }, match(players, 'abandoned'), match()])).toBe(0.5);
    // A teammate is not an opponent; that encounter breaks the rival streak.
    expect(repeatGain('a', players, [match(players.map((p) => ({ ...p, team: 'red' }))), match()])).toBe(1);
  });

  it('keeps trading wins unrestricted and resets on a loss or draw', () => {
    for (const result of ['loss', 'draw'] as const) {
      const interruption = match();
      interruption.players[0].result = result;
      expect(repeatGain('a', players, [interruption, ...Array.from({ length: 6 }, () => match())])).toBe(1);
      expect(repeatGain('a', players, [match(), interruption, match()])).toBe(1);
    }
  });
});
