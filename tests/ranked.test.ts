import { describe, expect, it } from 'vitest';
import { Matchmaker } from '../server/matchmaker';
import { MemoryStore, applyChange, freshRating } from '../server/rankedStore';
import {
  balanceTeams,
  createDraft,
  currentStep,
  draftAct,
  draftAuto,
  draftDone,
  draftOptions,
  draftPicks,
  draftSteps,
  expectedScore,
  kFactor,
  matchWindow,
  rateMatch,
  tierOf,
  type RankedParticipant,
} from '../src/engine/net/ranked';

const P = (playerId: string, team: 'red' | 'blue', rating = 1000, games = 20): RankedParticipant => ({ playerId, team, rating, games });

describe('elo', () => {
  it('is symmetric and zero-sum for equal, established teams', () => {
    const r = rateMatch([P('a', 'red'), P('b', 'blue')], 'red');
    expect(r.find((x) => x.playerId === 'a')!.delta).toBe(14);
    expect(r.find((x) => x.playerId === 'b')!.delta).toBe(-14);
    expect(expectedScore(1000, 1000)).toBeCloseTo(0.5);
  });

  it('rewards upsets more than expected wins', () => {
    const upset = rateMatch([P('a', 'red', 900), P('b', 'blue', 1300)], 'red')[0].delta;
    const expected = rateMatch([P('a', 'red', 1300), P('b', 'blue', 900)], 'red')[0].delta;
    expect(upset).toBeGreaterThan(expected);
    expect(expected).toBeGreaterThanOrEqual(0);
  });

  it('uses the team average in team modes and moves new players faster', () => {
    const r = rateMatch([P('a', 'red', 1400, 50), P('n', 'red', 800, 0), P('b', 'blue', 1100, 50), P('c', 'blue', 1100, 50)], 'blue');
    // Red avg 1100 vs blue 1100: even match, so the loss is K/2 for each (rounded).
    expect(r.find((x) => x.playerId === 'a')!.delta).toBe(-10);
    expect(r.find((x) => x.playerId === 'n')!.delta).toBe(-20);
    expect(kFactor(0)).toBeGreaterThan(kFactor(50));
  });

  it('scores a tie as half a point', () => {
    const r = rateMatch([P('a', 'red', 1200), P('b', 'blue', 1000)], 'tie');
    expect(r[0].delta).toBeLessThan(0);
    expect(r[1].delta).toBeGreaterThan(0);
    expect(r[0].result).toBe('draw');
  });

  it('abandoning is a loss for the leaver whoever was ahead; stayers on that side are untouched', () => {
    const r = rateMatch([P('a', 'red'), P('a2', 'red'), P('b', 'blue'), P('b2', 'blue')], 'red', new Set(['a']));
    const by = Object.fromEntries(r.map((x) => [x.playerId, x]));
    expect(by.a.result).toBe('abandon');
    expect(by.a.delta).toBeLessThan(0);
    expect(by.a2.result).toBe('none');
    expect(by.a2.delta).toBe(0);
    expect(by.b.result).toBe('win');
    expect(by.b.delta).toBeGreaterThan(0);
  });

  it('never drops a rating below the floor', () => {
    expect(rateMatch([P('a', 'red', 100, 0), P('b', 'blue', 1500, 0)], 'blue')[0].after).toBe(100);
  });

  it('shows no tier until placement is done', () => {
    expect(tierOf(1500, 2)).toBeNull();
    expect(tierOf(1500, 5)!.id).toBe('diamond');
    expect(tierOf(850, 9)!.id).toBe('bronze');
    expect(tierOf(1750, 9)!.id).toBe('master');
  });

  it('applies changes to a stored record', () => {
    let row = freshRating();
    row = applyChange(row, { playerId: 'a', before: 1000, after: 1016, delta: 16, result: 'win' });
    row = applyChange(row, { playerId: 'a', before: 1016, after: 1004, delta: -12, result: 'loss' });
    row = applyChange(row, { playerId: 'a', before: 1004, after: 1004, delta: 0, result: 'none' });
    expect(row).toMatchObject({ rating: 1004, games: 2, wins: 1, losses: 1, peak: 1016 });
  });
});

describe('team balance', () => {
  it('splits 6 players into the closest teams', () => {
    const ps = [1500, 1400, 1000, 900, 800, 700].map((rating, i) => ({ rating, i }));
    const [a, b] = balanceTeams(ps);
    expect(a).toHaveLength(3);
    expect(b).toHaveLength(3);
    const avg = (x: typeof a) => x.reduce((s, p) => s + p.rating, 0) / x.length;
    expect(Math.abs(avg(a) - avg(b))).toBeLessThanOrEqual(34); // best possible split of these ratings
  });
  it('handles 1v1', () => {
    const [a, b] = balanceTeams([{ rating: 1 }, { rating: 2 }]);
    expect([a.length, b.length]).toEqual([1, 1]);
  });
});

describe('matchmaker', () => {
  const q = () => new Matchmaker<string>();
  it('pairs close ratings at once and leaves distant ones until their windows open', () => {
    const m = q();
    m.add('1v1', { id: 'a', rating: 1000, since: 0, data: 'a' });
    m.add('1v1', { id: 'b', rating: 1500, since: 0, data: 'b' });
    expect(m.tick(0)).toHaveLength(0);
    expect(m.tick(10_000)).toHaveLength(0); // window 250
    const out = m.tick(40_000); // window 700
    expect(out).toHaveLength(1);
    expect(out[0].players.map((p) => p.id).sort()).toEqual(['a', 'b']);
    expect(m.size('1v1')).toBe(0);
  });
  it('needs 2 x team size and forms several matches from a big queue', () => {
    const m = q();
    for (let i = 0; i < 9; i++) m.add('2v2', { id: `p${i}`, rating: 1000 + i, since: 0, data: '' });
    const out = m.tick(0);
    expect(out).toHaveLength(2);
    expect(out.every((x) => x.players.length === 4)).toBe(true);
    expect(m.size('2v2')).toBe(1);
  });
  it('removes players and keeps modes separate', () => {
    const m = q();
    m.add('1v1', { id: 'a', rating: 1000, since: 0, data: '' });
    m.add('3v3', { id: 'a', rating: 1000, since: 0, data: '' }); // re-adding moves them
    expect(m.size('1v1')).toBe(0);
    expect(m.has('a')).toBe(true);
    expect(m.remove('a')).toBe(true);
    expect(m.has('a')).toBe(false);
    expect(matchWindow(0)).toBeLessThan(matchWindow(60_000));
  });
});

describe('draft', () => {
  const pool = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
  it('orders bans alternately and snakes the picks', () => {
    expect(draftSteps('3v3').map((s) => `${s.kind[0]}:${s.slot}`)).toEqual([
      'b:red1', 'b:blue1', 'b:red2', 'b:blue2',
      'p:red1', 'p:blue1', 'p:blue2', 'p:red2', 'p:red3', 'p:blue3',
    ]);
    expect(draftSteps('1v1').map((s) => s.slot)).toEqual(['red1', 'blue1', 'red1', 'blue1', 'red1', 'blue1']);
  });

  it('enforces turns, bans removing robots for everyone, and unique picks per alliance', () => {
    const d = createDraft('2v2', pool);
    expect(draftAct(d, 'blue1', 'a')).toBe('Not your turn');
    expect(draftAct(d, 'red1', 'zzz')).toMatch(/cannot be banned/);
    expect(draftAct(d, 'red1', 'a')).toBeNull();
    expect(draftAct(d, 'blue1', 'a')).toMatch(/cannot be banned/); // already banned
    expect(draftAct(d, 'blue1', 'b')).toBeNull();
    expect(draftAct(d, 'red2', 'c')).toBeNull();
    expect(draftAct(d, 'blue2', 'd')).toBeNull();
    // Picks: R1 B1 | B2 R2
    expect(currentStep(d)).toEqual({ kind: 'pick', slot: 'red1' });
    expect(draftOptions(d, 'red1')).not.toContain('a');
    expect(draftAct(d, 'red1', 'e')).toBeNull();
    expect(draftAct(d, 'blue1', 'e')).toBeNull(); // the other alliance may take the same robot
    expect(draftAct(d, 'blue2', 'e')).toMatch(/not available/); // but not twice on one alliance
    expect(draftAct(d, 'blue2', 'f')).toBeNull();
    expect(draftAct(d, 'red2', 'e')).toMatch(/not available/);
    expect(draftAct(d, 'red2', 'g')).toBeNull();
    expect(draftDone(d)).toBe(true);
    expect([...draftPicks(d)]).toEqual([['red1', 'e'], ['blue1', 'e'], ['blue2', 'f'], ['red2', 'g']]);
    expect(draftAct(d, 'red1', 'h')).toBe('The draft is over');
  });

  it('auto-plays timed-out turns to a legal finish', () => {
    for (const mode of ['1v1', '2v2', '3v3'] as const) {
      const d = createDraft(mode, pool);
      let guard = 0;
      while (!draftDone(d) && guard++ < 50) draftAuto(d);
      expect(draftDone(d)).toBe(true);
      expect(d.bans).toHaveLength(4);
      expect(d.picks).toHaveLength(mode === '1v1' ? 2 : mode === '2v2' ? 4 : 6);
      expect(new Set(d.bans.map((b) => b.id)).size).toBe(4);
    }
  });

  it('refuses a pool too small to draft from', () => {
    expect(() => createDraft('3v3', ['a', 'b', 'c', 'd', 'e'])).toThrow();
  });
});

describe('memory store', () => {
  it('ranks the leaderboard by rating and hides players still in placement', async () => {
    const s = new MemoryStore();
    for (const id of ['a', 'b', 'c']) await s.touchPlayer(id, id.toUpperCase());
    const match = (a: string, b: string, n: number) => {
      for (let i = 0; i < n; i++)
        void s.saveMatch(
          { mode: '1v1', season: 'x', outcome: 'red', redScore: 1, blueScore: 0, status: 'final', players: [] },
          [
            { playerId: a, before: 1000, after: 1000 + 10 * (i + 1), delta: 10, result: 'win' },
            { playerId: b, before: 1000, after: 1000 - 10 * (i + 1), delta: -10, result: 'loss' },
          ],
        );
    };
    match('a', 'b', 5);
    match('c', 'b', 2);
    const rows = await s.leaderboard('1v1', 10, 5);
    expect(rows.map((r) => r.name)).toEqual(['A', 'B'].filter((n) => rows.some((r) => r.name === n)));
    expect(rows[0].name).toBe('A');
    expect((await s.getRating('b', '1v1')).losses).toBe(7);
  });
});
