/** Solo leaderboards: the ghost format, which matches count, and the relay's /api/solo-scores endpoint. */
import { describe, expect, it } from 'vitest';
import { boardRobotFor, boardRobotForMatch, boardRobots } from '../src/engine/ghost/board';
import { decodeGhost, encodeGhost, GHOST_HZ, ghostProblem, ghostScoreAt, MAX_SCORE, POSE_STRIDE, type GhostRun } from '../src/engine/ghost/format';
import { GhostRecorder } from '../src/engine/ghost/recorder';
import { cloneConfig } from '../src/engine/robot/config';
import { SEASONS } from '../src/seasons';
import { UploadLimiter } from '../server/matchLogCore';
import { handleSoloScoreRequest, MemorySoloScoreStore, SupabaseSoloScoreStore } from '../server/soloScores';
import type { GameSettings } from '../src/engine/core/season';

const SECRET = 'a'.repeat(48);
const OTHER = 'b'.repeat(48);

/** A clean 150 s run driving a slow circle and scoring every 10 s. */
function run(score = 150, alliance: 'red' | 'blue' = 'blue'): GhostRun {
  const rec = new GhostRecorder(alliance);
  let total = 0;
  for (let i = 0; i < 150 * GHOST_HZ; i++) {
    const t = i / GHOST_HZ;
    if (i && i % (10 * GHOST_HZ) === 0) total += score / 15;
    rec.sample({ x: Math.cos(t / 5) * 4, y: 0.01, z: Math.sin(t / 5) * 2 }, { x: 0, y: Math.sin(t / 10), z: 0, w: Math.cos(t / 10) }, Math.min(total, score), t);
    if (i % 90 === 0) rec.shot(t, { x: 1, y: 0.6, z: 0 }, { x: 3, y: 5, z: 0 });
  }
  return rec.finish(150, score);
}

describe('ghost format', () => {
  it('survives encoding at centimetre accuracy and stays small', async () => {
    const r = run();
    const text = await encodeGhost(r);
    expect(text.length).toBeLessThan(60_000);
    const back = (await decodeGhost(text))!;
    expect(back.score).toBe(r.score);
    expect(back.alliance).toBe('blue');
    expect(back.poses.length).toBe(r.poses.length);
    expect(back.scores).toEqual(r.scores.map((v, i) => (i % 2 ? v : Math.round(v * 100) / 100)));
    r.poses.forEach((v, i) => expect(Math.abs(v - back.poses[i])).toBeLessThan(0.006));
  });

  it('refuses anything that is not a ghost', async () => {
    expect(await decodeGhost('nope')).toBeNull();
    expect(await decodeGhost(42)).toBeNull();
    expect(await decodeGhost(btoa('hello'))).toBeNull();
  });

  it('reads the score at any moment', () => {
    const r: GhostRun = { ...run(), scores: [10, 5, 20, 12] };
    expect(ghostScoreAt(r, 0)).toBe(0);
    expect(ghostScoreAt(r, 10)).toBe(5);
    expect(ghostScoreAt(r, 15)).toBe(5);
    expect(ghostScoreAt(r, 500)).toBe(12);
  });

  it('accepts a real run and rejects impossible ones', () => {
    expect(ghostProblem(run(), 150)).toBeNull();
    expect(ghostProblem(run(), 151)).toMatch(/does not match/);
    expect(ghostProblem(run(), MAX_SCORE + 1)).toMatch(/range/);
    const short = run();
    short.poses = short.poses.slice(0, 20 * GHOST_HZ * POSE_STRIDE);
    expect(ghostProblem(short, 150)).toMatch(/length/);
    const teleport = run();
    for (let i = 0; i < teleport.poses.length; i += POSE_STRIDE) teleport.poses[i] = (i / POSE_STRIDE) % 2 ? 8 : -8;
    expect(ghostProblem(teleport, 150)).toMatch(/too fast/);
    const faked = run();
    faked.scores = [];
    expect(ghostProblem(faked, 150)).toMatch(/timeline/);
  });
});

describe('which robots have a board', () => {
  it('every team robot has exactly its own board, with an id the relay accepts', () => {
    for (const season of SEASONS) {
      const robots = boardRobots(season);
      expect(new Set(robots.map((r) => r.id)).size).toBe(robots.length);
      for (const r of robots) {
        expect(r.id).toMatch(/^[\w.-]{1,64}$/);
        const mine = cloneConfig(r.config);
        mine.teamNumber = 1234;
        expect(boardRobotFor(season, mine)?.config).toBeTruthy();
      }
    }
  });

  it('every season\'s match fits the length the relay accepts', () => {
    for (const season of SEASONS) {
      const seconds = season.timeline.reduce((a, p) => a + p.duration, 0);
      expect(seconds).toBeGreaterThan(60);
      expect(seconds).toBeLessThan(400);
    }
  });

  it('archetypes have no board', () => {
    for (const season of SEASONS) {
      expect(boardRobots(season).length).toBe(season.teamRobots?.length ?? 0);
      for (const preset of season.robotPresets ?? []) expect(boardRobots(season).some((b) => b.id === preset.id)).toBe(false);
    }
  });

  it('a custom build or a match with AI does not count', () => {
    const season = SEASONS.find((s) => boardRobots(s).length)!;
    const robot = cloneConfig(boardRobots(season)[0].config);
    const s = { robot, aiOpponents: false } as GameSettings;
    expect(boardRobotForMatch(season, s)).not.toBeNull();
    expect(boardRobotForMatch(season, { ...s, aiOpponents: true })).toBeNull();
    const custom = cloneConfig(robot);
    custom.maxSpeed += 3;
    expect(boardRobotForMatch(season, { ...s, robot: custom })).toBeNull();
  });
});

describe('/api/solo-scores', () => {
  const setup = () => {
    const store = new MemorySoloScoreStore();
    const limiter = new UploadLimiter();
    const call = async (query: string, init?: RequestInit) => {
      const res = await handleSoloScoreRequest(new Request(`http://relay/api/solo-scores${query}`, init), store, limiter, '1.2.3.4');
      const text = await res.text();
      return { status: res.status, body: text ? JSON.parse(text) as Record<string, unknown> : null };
    };
    const post = async (secret: string, score: number, name = 'Ada', extra: Record<string, unknown> = {}) =>
      call('', { method: 'POST', body: JSON.stringify({ season: '2026-rebuilt', robot: 'hub-bot', name, secret, score, ghost: await encodeGhost(run(score)), ...extra }) });
    return { call, post };
  };

  it('keeps each driver\'s best run and ranks the board', async () => {
    const { call, post } = setup();
    expect((await post(SECRET, 150)).body).toMatchObject({ improved: true, rank: 1, total: 1 });
    expect((await post(OTHER, 300, 'Grace')).body).toMatchObject({ improved: true, rank: 1, total: 2 });
    expect((await post(SECRET, 90)).body).toMatchObject({ improved: false, best: 150, rank: 2 });
    const board = await call('?season=2026-rebuilt&robot=hub-bot', { headers: { 'x-solo-secret': SECRET } });
    const entries = board.body!.entries as { name: string; score: number; mine: boolean; id: string }[];
    expect(entries.map((e) => [e.name, e.score, e.mine])).toEqual([['Grace', 300, false], ['Ada', 150, true]]);
    expect(board.body!.me).toMatchObject({ score: 150, rank: 2 });
    expect(JSON.stringify(board.body)).not.toContain('playerId');
    const ghost = await call(`?ghost=${entries[0].id}`);
    expect((await decodeGhost(ghost.body!.ghost))?.score).toBe(300);
    expect((await call('?season=2026-rebuilt')).body!.robots).toEqual([{ robot: 'hub-bot', top: 300, name: 'Grace', drivers: 2 }]);
  });

  it('renames a driver and filters bad names', async () => {
    const { call, post } = setup();
    await post(SECRET, 150);
    expect((await call('', { method: 'POST', body: JSON.stringify({ rename: true, name: 'Lin', secret: SECRET }) })).status).toBe(204);
    await post(OTHER, 100, 'fuck');
    const entries = (await call('?season=2026-rebuilt&robot=hub-bot')).body!.entries as { name: string }[];
    expect(entries.map((e) => e.name)).toEqual(['Lin', 'Player']);
  });

  it('rejects bad submissions', async () => {
    const { call, post } = setup();
    expect((await post('short', 150)).status).toBe(400);
    expect((await post(SECRET, 150, 'Ada', { robot: '../x' })).status).toBe(400);
    expect((await post(SECRET, 150, 'Ada', { ghost: 'nope' })).status).toBe(400);
    expect((await post(SECRET, 150, 'Ada', { score: 9999 })).status).toBe(422);
    expect((await call('?season=../x')).status).toBe(400);
    expect((await call('?ghost=missing')).status).toBe(404);
    expect((await call('', { method: 'DELETE' })).status).toBe(405);
    expect((await call('', { method: 'OPTIONS' })).status).toBe(204);
  });

  it('limits writes per IP', async () => {
    const { post } = setup();
    let last = 0;
    for (let i = 0; i < 31; i++) last = (await post(SECRET, 10 + i)).status;
    expect(last).toBe(429);
  });

  it('answers 502 when storage fails', async () => {
    const broken = new SupabaseSoloScoreStore('https://x.supabase.co', 'k', (async () => new Response('down', { status: 500 })) as typeof fetch);
    const res = await handleSoloScoreRequest(new Request('http://relay/api/solo-scores?season=2026-rebuilt'), broken, new UploadLimiter(), 'ip');
    expect(res.status).toBe(502);
  });

  it('a board read never asks Postgres for a score too big for its integer column', async () => {
    const urls: string[] = [];
    const store = new SupabaseSoloScoreStore('https://x.supabase.co', 'k', (async (url: string, init?: RequestInit) => {
      urls.push(url);
      const big = /score=gt\.(\d+)/.exec(url);
      if (big && Number(big[1]) > 2147483647) return new Response('out of range', { status: 400 });
      return new Response(init?.method === 'HEAD' ? null : '[]', { status: 200, headers: { 'content-range': '*/0' } });
    }) as typeof fetch);
    const res = await handleSoloScoreRequest(new Request('http://relay/api/solo-scores?season=2026-rebuilt&robot=x'), store, new UploadLimiter(), 'ip');
    expect(res.status).toBe(200);
    expect(urls.some((u) => u.includes('score=gt.'))).toBe(true);
  });

  it('asks Supabase for a board without the ghost column, and upserts on the driver', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const store = new SupabaseSoloScoreStore('https://x.supabase.co/', 'k', (async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return new Response(init?.method === 'POST' ? null : '[]', { status: init?.method === 'POST' ? 201 : 200 });
    }) as typeof fetch);
    await store.top('2026-rebuilt', 'hub-bot', 50);
    expect(calls[0].url).toContain('order=score.desc,updated_at.asc&limit=50');
    expect(calls[0].url).not.toContain('ghost');
    await store.put({ season: 's', robot: 'r', playerId: 'p', name: 'n', score: 1, ghost: 'g' });
    expect(calls[1].url).toContain('on_conflict=season,robot,player_id');
    expect(JSON.parse(String(calls[1].init!.body))).toMatchObject({ player_id: 'p', score: 1, ghost: 'g' });
  });
});
