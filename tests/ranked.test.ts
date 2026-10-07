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
  teamShares,
  rankFor,
  visibleRank,
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
    const r = rateMatch([P('a', 'red', 1100, 50), P('n', 'red', 1100, 0), P('b', 'blue', 1100, 50), P('c', 'blue', 1100, 50)], 'blue');
    // Red avg 1100 vs blue 1100: even match, so the loss is K/2 for each (rounded).
    expect(r.find((x) => x.playerId === 'a')!.delta).toBe(-10);
    expect(r.find((x) => x.playerId === 'n')!.delta).toBe(-20);
    expect(kFactor(0)).toBeGreaterThan(kFactor(50));
  });

  it('blames the stronger player less when a mismatched team loses', () => {
    // A 1400 teamed with a 700 against two 1000s: the team is rated 1050 vs 1000, so a loss costs the team ~16 points each.
    const lose = rateMatch([P('good', 'red', 1400), P('bad', 'red', 700), P('a', 'blue', 1000), P('b', 'blue', 1000)], 'blue');
    const by = Object.fromEntries(lose.map((x) => [x.playerId, x]));
    expect(by.good.delta).toBeLessThan(0);
    expect(by.bad.delta).toBeLessThan(by.good.delta); // the weak player loses more
    expect(Math.abs(by.good.delta)).toBeLessThan(10); // a flat split would be -16
    expect(by.good.delta + by.bad.delta).toBeGreaterThanOrEqual(-34); // the team's total swing is unchanged (~-32)
    expect(by.good.delta + by.bad.delta).toBeLessThanOrEqual(-30);
    // The opponents are even-rated and just share the win.
    expect(by.a.delta).toBe(by.b.delta);
    expect(by.a.delta).toBeGreaterThan(0);
  });

  it('gives the stronger player more credit when that team wins', () => {
    const win = rateMatch([P('good', 'red', 1400), P('bad', 'red', 700), P('a', 'blue', 1000), P('b', 'blue', 1000)], 'red');
    const by = Object.fromEntries(win.map((x) => [x.playerId, x]));
    expect(by.good.delta).toBeGreaterThan(by.bad.delta);
    expect(by.bad.delta).toBeGreaterThan(0);
  });

  it('shares nothing unevenly for solo players or evenly matched teams', () => {
    expect(teamShares([1000], -1)).toEqual([1]);
    expect(teamShares([1000, 1000, 1000], 1)).toEqual([1, 1, 1]);
    const f = teamShares([1500, 1000, 600], -1);
    expect(f[0]).toBeLessThan(f[1]);
    expect(f[1]).toBeLessThan(f[2]);
    expect(f.reduce((a, b) => a + b, 0) / 3).toBeCloseTo(1, 1);
    const g = rateMatch([P('a', 'red', 1200), P('b', 'blue', 1000)], 'red'); // 1v1 is the plain Elo
    expect(g[0].delta).toBe(Math.round(kFactor(20) * (1 - expectedScore(1200, 1000))));
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

  it('hides the rank until placement is done', () => {
    expect(visibleRank(1300, 2)).toBeNull();
    expect(visibleRank(1300, 5)!.label).toBe('Champion III');
  });

  it('maps ratings onto the ladder with divisions', () => {
    expect(rankFor(1000).label).toBe('Gear III'); // new players start here
    expect(rankFor(900).label).toBe('Gear I');
    expect(rankFor(949).label).toBe('Gear I');
    expect(rankFor(950).label).toBe('Gear II');
    expect(rankFor(1049).label).toBe('Gear III');
    expect(rankFor(1050).label).toBe('Piston I');
    expect(rankFor(1200).label).toBe('Champion I');
    expect(rankFor(750).label).toBe('Bolt I');
    expect(rankFor(100).label).toBe('Bolt I'); // the floor of the ladder
    expect(rankFor(1350).label).toBe('Apex');
    expect(rankFor(1600).points).toBe(250);
  });

  it('reports progress and the next rank', () => {
    const r = rankFor(975);
    expect(r).toMatchObject({ points: 25, next: 'Gear III' });
    expect(r.progress).toBeCloseTo(0.5);
    expect(rankFor(1040).next).toBe('Piston I');
    expect(rankFor(1340).next).toBe('Apex');
    expect(rankFor(2000).next).toBeNull();
    expect(rankFor(100).progress).toBe(0);
  });

  it('orders ranks so promotions compare higher', () => {
    const ords = [0, 750, 800, 900, 1049, 1050, 1200, 1349, 1350].map((r) => rankFor(r).ordinal);
    expect(ords.slice(1)).toEqual(ords.slice(1).sort((a, b) => a - b));
    expect(new Set(ords.slice(1)).size).toBe(ords.length - 1);
  });

  it('applies changes to a stored record', () => {
    let row = freshRating();
    row = applyChange(row, { playerId: 'a', before: 1000, after: 1016, delta: 16, result: 'win' }, '2v2');
    row = applyChange(row, { playerId: 'a', before: 1016, after: 1004, delta: -12, result: 'loss' }, '1v1');
    row = applyChange(row, { playerId: 'a', before: 1004, after: 1004, delta: 0, result: 'none' }, '1v1');
    expect(row).toMatchObject({ rating: 1004, games: 2, wins: 1, losses: 1, peak: 1016 });
    expect(row.modes['2v2']).toMatchObject({ games: 1, wins: 1 });
    expect(row.modes['1v1']).toMatchObject({ games: 1, losses: 1 });
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
    const rows = await s.leaderboard(10, 5);
    expect(rows.map((r) => r.name)).toEqual(['A', 'B'].filter((n) => rows.some((r) => r.name === n)));
    expect(rows[0].name).toBe('A');
    const b = await s.getRating('b');
    expect(b.losses).toBe(7);
    expect(b.modes['1v1'].losses).toBe(7);
    expect(b.modes['2v2'].games).toBe(0);
  });
});

import { censorText, isBadText, nameProblem } from '../src/engine/net/nameFilter';
import { cleanName, cleanTitle } from '../src/engine/net/relayProtocol';

describe('name filter', () => {
  it('catches profanity through case, leetspeak, spacing and stretching', () => {
    for (const bad of ['fuck', 'FUCK', 'f.u.c.k', 'f u c k', 'fuuuuck', 'sh1t', '$h!t', 'b!tch', 'n1gg3r', 'xX_fuck_Xx', 'ass', 'a$$ hat']) {
      expect(isBadText(bad), bad).toBe(true);
    }
  });

  it('leaves ordinary names alone (including the classic false positives)', () => {
    for (const ok of ['Scunthorpe', 'Grape', 'Class', 'Assistant', 'Cocktail', 'Dickens', 'Essex', 'Team 254', 'Hello World', 'Passion', 'Bassist', 'Analyst', 'Sussex']) {
      expect(isBadText(ok), ok).toBe(false);
    }
  });

  it('refuses a bad name with a message and allows an empty one', () => {
    expect(nameProblem('fuckface')).toMatch(/isn’t allowed/);
    expect(nameProblem('Driver 1323')).toBeNull();
    expect(nameProblem('')).toBeNull();
  });

  it('is enforced by the relay helpers regardless of the client', () => {
    expect(cleanName('Sh1thead')).toBe('Player');
    expect(cleanName('  Alice  ')).toBe('Alice');
    expect(cleanTitle('fuck this room')).toBe('');
    expect(cleanTitle('Friendly practice')).toBe('Friendly practice');
  });

  it('censors words in chat but keeps the rest', () => {
    expect(censorText('well that was shit lol')).toBe('well that was **** lol');
    expect(censorText('good game everyone')).toBe('good game everyone');
  });
});
