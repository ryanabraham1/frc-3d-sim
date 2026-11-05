/**
 * Solo leaderboards at /api/solo-scores (docs/LEADERBOARD.md): each driver's best run per season and robot, with the
 * ghost others race. Runtime-neutral: the Cloudflare Worker passes its Request straight in and the Node server builds
 * one, so no node:http or node:fs here. No parameter properties: `node server/index.ts` runs in strip-only mode.
 *
 *   GET  ?season=S            top score and driver count of every robot
 *   GET  ?season=S&robot=R    a board (send `x-solo-secret` to get your own row and rank)
 *   GET  ?ghost=ID            a run's ghost
 *   POST {season, robot, name, secret, score, ghost}   submit a run (kept only if it beats your best)
 *   POST {rename: true, name, secret}                  change your name on every board
 */
import { cleanName } from '../src/engine/net/relayProtocol.ts';
import { decodeGhost, ghostProblem, MAX_GHOST_CHARS, MAX_SCORE } from '../src/engine/ghost/format.ts';
import { UploadLimiter } from './matchLogCore.ts';
import { playerIdFor } from './ranked.ts';

export const BOARD_SIZE = 50;
const MAX_BODY_BYTES = MAX_GHOST_CHARS + 4096;
const ID = /^[\w.-]{1,64}$/;
const SECRET = /^[0-9a-f]{32,128}$/;

export interface SoloRow {
  id: string;
  name: string;
  score: number;
  /** ISO time the run was set. */
  at: string;
  playerId: string;
}

export interface SoloSummary {
  robot: string;
  top: number;
  name: string;
  drivers: number;
}

export interface SoloScoreStore {
  /** Best first; ties go to whoever set the score first. */
  top(season: string, robot: string, limit: number): Promise<SoloRow[]>;
  /** A driver's row on a board. */
  mine(season: string, robot: string, playerId: string): Promise<SoloRow | null>;
  /** Drivers on a board, and how many of them have more than `score`. */
  standing(season: string, robot: string, score: number): Promise<{ above: number; total: number }>;
  summary(season: string): Promise<SoloSummary[]>;
  ghost(id: string): Promise<string | null>;
  put(row: { season: string; robot: string; playerId: string; name: string; score: number; ghost: string }): Promise<void>;
  rename(playerId: string, name: string): Promise<void>;
}

const summarize = (rows: { robot: string; name: string; score: number }[]): SoloSummary[] => {
  const out = new Map<string, SoloSummary>();
  for (const r of rows) {
    const s = out.get(r.robot);
    if (s) s.drivers++;
    else out.set(r.robot, { robot: r.robot, top: r.score, name: r.name, drivers: 1 });
  }
  return [...out.values()];
};

/** Dev and tests: gone on restart. */
export class MemorySoloScoreStore implements SoloScoreStore {
  private readonly rows: (SoloRow & { season: string; robot: string; ghost: string })[] = [];
  private seq = 0;
  private board(season: string, robot: string) {
    return this.rows.filter((r) => r.season === season && r.robot === robot).sort((a, b) => b.score - a.score || a.at.localeCompare(b.at));
  }
  async top(season: string, robot: string, limit: number): Promise<SoloRow[]> { return this.board(season, robot).slice(0, limit); }
  async mine(season: string, robot: string, playerId: string): Promise<SoloRow | null> { return this.board(season, robot).find((r) => r.playerId === playerId) ?? null; }
  async standing(season: string, robot: string, score: number) {
    const b = this.board(season, robot);
    return { above: b.filter((r) => r.score > score).length, total: b.length };
  }
  async summary(season: string): Promise<SoloSummary[]> {
    return summarize(this.rows.filter((r) => r.season === season).sort((a, b) => b.score - a.score));
  }
  async ghost(id: string): Promise<string | null> { return this.rows.find((r) => r.id === id)?.ghost ?? null; }
  async put(row: { season: string; robot: string; playerId: string; name: string; score: number; ghost: string }): Promise<void> {
    const at = new Date().toISOString();
    const old = this.rows.find((r) => r.season === row.season && r.robot === row.robot && r.playerId === row.playerId);
    if (old) Object.assign(old, row, { at });
    else this.rows.push({ ...row, at, id: `run-${++this.seq}` });
  }
  async rename(playerId: string, name: string): Promise<void> {
    for (const r of this.rows) if (r.playerId === playerId) r.name = name;
  }
}

interface DbRow { id: string; name: string; score: number; updated_at: string; player_id: string }

export class SupabaseSoloScoreStore implements SoloScoreStore {
  private readonly url: string;
  private readonly auth: Record<string, string>;
  private readonly fetchImpl: typeof fetch;
  constructor(url: string, key: string, fetchImpl: typeof fetch = fetch) {
    this.url = `${url.replace(/\/$/, '')}/rest/v1/solo_scores`;
    this.auth = { apikey: key, authorization: `Bearer ${key}` };
    // Workers requires its native fetch receiver to be the global scope, not this store.
    this.fetchImpl = fetchImpl.bind(globalThis);
  }
  private async get<T>(query: string): Promise<T> {
    const res = await this.fetchImpl(`${this.url}?${query}`, { headers: this.auth });
    if (!res.ok) throw new Error(`Supabase solo_scores ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return res.json() as Promise<T>;
  }
  private async count(query: string): Promise<number> {
    const res = await this.fetchImpl(`${this.url}?select=id&${query}`, { method: 'HEAD', headers: { ...this.auth, prefer: 'count=exact' } });
    if (!res.ok) throw new Error(`Supabase solo_scores ${res.status}`);
    return Number(res.headers.get('content-range')?.split('/')[1]) || 0;
  }
  private static row(r: DbRow): SoloRow {
    return { id: r.id, name: r.name, score: r.score, at: r.updated_at, playerId: r.player_id };
  }
  private static board(season: string, robot: string): string {
    return `season=eq.${encodeURIComponent(season)}&robot=eq.${encodeURIComponent(robot)}`;
  }
  async top(season: string, robot: string, limit: number): Promise<SoloRow[]> {
    const rows = await this.get<DbRow[]>(`select=id,name,score,updated_at,player_id&${SupabaseSoloScoreStore.board(season, robot)}&order=score.desc,updated_at.asc&limit=${limit}`);
    return rows.map(SupabaseSoloScoreStore.row);
  }
  async mine(season: string, robot: string, playerId: string): Promise<SoloRow | null> {
    const rows = await this.get<DbRow[]>(`select=id,name,score,updated_at,player_id&${SupabaseSoloScoreStore.board(season, robot)}&player_id=eq.${encodeURIComponent(playerId)}`);
    return rows[0] ? SupabaseSoloScoreStore.row(rows[0]) : null;
  }
  async standing(season: string, robot: string, score: number) {
    const board = SupabaseSoloScoreStore.board(season, robot);
    const [above, total] = await Promise.all([this.count(`${board}&score=gt.${score}`), this.count(board)]);
    return { above, total };
  }
  async summary(season: string): Promise<SoloSummary[]> {
    return summarize(await this.get<{ robot: string; name: string; score: number }[]>(`select=robot,name,score&season=eq.${encodeURIComponent(season)}&order=score.desc&limit=5000`));
  }
  async ghost(id: string): Promise<string | null> {
    const rows = await this.get<{ ghost: string }[]>(`select=ghost&id=eq.${encodeURIComponent(id)}`);
    return rows[0]?.ghost ?? null;
  }
  async put(row: { season: string; robot: string; playerId: string; name: string; score: number; ghost: string }): Promise<void> {
    const res = await this.fetchImpl(`${this.url}?on_conflict=season,robot,player_id`, {
      method: 'POST',
      headers: { ...this.auth, 'content-type': 'application/json', prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({ season: row.season, robot: row.robot, player_id: row.playerId, name: row.name, score: row.score, ghost: row.ghost, updated_at: new Date().toISOString() }),
    });
    if (!res.ok) throw new Error(`Supabase solo_scores ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  async rename(playerId: string, name: string): Promise<void> {
    const res = await this.fetchImpl(`${this.url}?player_id=eq.${encodeURIComponent(playerId)}`, {
      method: 'PATCH',
      headers: { ...this.auth, 'content-type': 'application/json', prefer: 'return=minimal' },
      body: JSON.stringify({ name }),
    });
    if (!res.ok) throw new Error(`Supabase solo_scores ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
}

const HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'content-type, x-solo-secret',
  'cache-control': 'no-store',
};
const reply = (status: number, body?: unknown) => new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { ...HEADERS, 'content-type': 'application/json' } });

async function read(request: Request, store: SoloScoreStore): Promise<Response> {
  const q = new URL(request.url).searchParams;
  const ghostId = q.get('ghost');
  if (ghostId !== null) {
    if (!ID.test(ghostId)) return reply(400, { error: 'bad id' });
    const ghost = await store.ghost(ghostId);
    return ghost ? reply(200, { ghost }) : reply(404, { error: 'no such run' });
  }
  const season = q.get('season') ?? '', robot = q.get('robot');
  if (!ID.test(season) || (robot !== null && !ID.test(robot))) return reply(400, { error: 'bad board' });
  if (robot === null) return reply(200, { robots: await store.summary(season) });
  const secret = request.headers.get('x-solo-secret');
  const me = secret && SECRET.test(secret) ? playerIdFor(secret) : null;
  const [rows, mine] = await Promise.all([store.top(season, robot, BOARD_SIZE), me ? store.mine(season, robot, me) : null]);
  // No run of your own: ask for the total with a score nobody can have (it must still fit Postgres `integer`).
  const standing = await store.standing(season, robot, mine?.score ?? MAX_SCORE);
  return reply(200, {
    total: standing.total,
    entries: rows.map((r) => ({ id: r.id, name: cleanName(r.name), score: r.score, at: r.at, mine: r.playerId === me })),
    me: mine ? { id: mine.id, score: mine.score, at: mine.at, rank: standing.above + 1 } : null,
  });
}

async function write(request: Request, store: SoloScoreStore, limiter: UploadLimiter, ip: string): Promise<Response> {
  if (Number(request.headers.get('content-length') ?? 0) > MAX_BODY_BYTES) return reply(413);
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) return reply(413);
  let body: { season?: unknown; robot?: unknown; name?: unknown; secret?: unknown; score?: unknown; ghost?: unknown; rename?: unknown };
  try { body = JSON.parse(text); } catch { return reply(400, { error: 'not JSON' }); }
  if (typeof body.secret !== 'string' || !SECRET.test(body.secret)) return reply(400, { error: 'bad secret' });
  if (limiter.limited(ip)) return reply(429, { error: 'rate limited' });
  const playerId = playerIdFor(body.secret);
  const name = cleanName(body.name);
  if (body.rename === true) {
    await store.rename(playerId, name);
    return reply(204);
  }
  const { season, robot, score } = body;
  if (typeof season !== 'string' || typeof robot !== 'string' || !ID.test(season) || !ID.test(robot)) return reply(400, { error: 'bad board' });
  const run = await decodeGhost(body.ghost);
  if (!run) return reply(400, { error: 'not a ghost' });
  const problem = ghostProblem(run, score as number);
  if (problem) return reply(422, { error: problem });
  const old = await store.mine(season, robot, playerId);
  const improved = !old || old.score < (score as number);
  if (improved) await store.put({ season, robot, playerId, name, score: score as number, ghost: body.ghost as string });
  const best = improved ? (score as number) : old.score;
  const { above, total } = await store.standing(season, robot, best);
  return reply(200, { improved, best, rank: above + 1, total });
}

/** /api/solo-scores for any fetch-style runtime. Writes are limited per IP; a driver only submits new bests. */
export async function handleSoloScoreRequest(request: Request, store: SoloScoreStore, limiter: UploadLimiter, ip: string, log?: (msg: string) => void): Promise<Response> {
  if (request.method === 'OPTIONS') return reply(204);
  try {
    if (request.method === 'GET') return await read(request, store);
    if (request.method === 'POST') return await write(request, store, limiter, ip);
    return reply(405);
  } catch (e) {
    log?.(`solo scores: ${(e as Error).message}`);
    return reply(502, { error: 'storage error' });
  }
}

export function createSoloScoreStore(env: Record<string, string | undefined>): SoloScoreStore {
  return env.SUPABASE_URL && env.SUPABASE_SERVICE_KEY ? new SupabaseSoloScoreStore(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY) : new MemorySoloScoreStore();
}
