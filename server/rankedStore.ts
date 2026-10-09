import { RANKED_SEASON_ID, START_RATING, type RankedMode, type RatingChange, type Team } from '../src/engine/net/ranked.ts';

/**
 * Rating persistence for ranked play. The relay is the only writer. `MemoryStore` is for dev, tests and
 * servers without a database (ratings reset on restart); `SupabaseStore` keeps them in Postgres.
 */

/** Win/loss record in one mode (the rating itself is shared by every mode). */
export interface ModeRecord {
  games: number;
  wins: number;
  losses: number;
  draws: number;
}

/** A player's standing for one season: a single rating shared by 1v1, 2v2 and 3v3, with a record per mode. */
export interface RatingRow {
  rating: number;
  games: number;
  wins: number;
  losses: number;
  draws: number;
  peak: number;
  modes: Record<RankedMode, ModeRecord>;
}

export interface LeaderRow extends RatingRow {
  name: string;
  playerId: string;
}

export interface MatchRecord {
  mode: RankedMode;
  season: string;
  outcome: Team | 'tie';
  redScore: number;
  blueScore: number;
  status: 'final' | 'abandoned' | 'void';
  players: { playerId: string; name: string; team: Team; before: number; after: number; result: RatingChange['result'] }[];
}

export interface RankedStore {
  /** True when ratings survive a restart. */
  readonly persistent: boolean;
  /** Register or refresh a player and return their rating for the current season. */
  touchPlayer(playerId: string, name: string): Promise<RatingRow>;
  getRating(playerId: string): Promise<RatingRow>;
  /** Record a finished match and apply `changes` to the players' ratings. */
  saveMatch(match: MatchRecord, changes: RatingChange[]): Promise<void>;
  /** The season's single leaderboard. */
  leaderboard(limit: number, minGames: number): Promise<LeaderRow[]>;
  /** 1-based rank among players with at least `minGames` games, and how many there are (null if unranked). */
  rankOf(playerId: string, minGames: number): Promise<{ rank: number; total: number; row: RatingRow } | null>;
}

const MODES: RankedMode[] = ['1v1', '2v2', '3v3'];
const freshModes = (): Record<RankedMode, ModeRecord> => ({ '1v1': { games: 0, wins: 0, losses: 0, draws: 0 }, '2v2': { games: 0, wins: 0, losses: 0, draws: 0 }, '3v3': { games: 0, wins: 0, losses: 0, draws: 0 } });

export const freshRating = (): RatingRow => ({ rating: START_RATING, games: 0, wins: 0, losses: 0, draws: 0, peak: START_RATING, modes: freshModes() });

/** Fill in anything a stored row is missing (older rows, partial JSON). */
export function normalizeRow(raw: Partial<RatingRow> | null | undefined): RatingRow {
  const base = freshRating();
  if (!raw) return base;
  const modes = freshModes();
  for (const m of MODES) Object.assign(modes[m], raw.modes?.[m] ?? {});
  return { rating: raw.rating ?? base.rating, games: raw.games ?? 0, wins: raw.wins ?? 0, losses: raw.losses ?? 0, draws: raw.draws ?? 0, peak: raw.peak ?? raw.rating ?? base.peak, modes };
}

/** Apply one match result to a rating row (pure). `none` (a void result for a teammate) changes nothing. */
export function applyChange(row: RatingRow, c: RatingChange, mode: RankedMode): RatingRow {
  if (c.result === 'none') return row;
  const win = c.result === 'win';
  const draw = c.result === 'draw';
  const loss = c.result === 'loss' || c.result === 'abandon';
  const m = row.modes[mode];
  return {
    rating: c.after,
    games: row.games + 1,
    wins: row.wins + (win ? 1 : 0),
    losses: row.losses + (loss ? 1 : 0),
    draws: row.draws + (draw ? 1 : 0),
    peak: Math.max(row.peak, c.after),
    modes: { ...row.modes, [mode]: { games: m.games + 1, wins: m.wins + (win ? 1 : 0), losses: m.losses + (loss ? 1 : 0), draws: m.draws + (draw ? 1 : 0) } },
  };
}

export class MemoryStore implements RankedStore {
  readonly persistent = false;
  private players = new Map<string, { name: string; row: RatingRow }>();
  readonly matches: MatchRecord[] = [];

  async touchPlayer(playerId: string, name: string) {
    let p = this.players.get(playerId);
    if (!p) this.players.set(playerId, (p = { name, row: freshRating() }));
    p.name = name;
    return normalizeRow(p.row);
  }

  async getRating(playerId: string) {
    return normalizeRow(this.players.get(playerId)?.row);
  }

  async saveMatch(match: MatchRecord, changes: RatingChange[]) {
    this.matches.push(match);
    if (match.status === 'void') return;
    for (const c of changes) {
      const p = this.players.get(c.playerId);
      if (p) p.row = applyChange(p.row, c, match.mode);
    }
  }

  async leaderboard(limit: number, minGames: number) {
    const rows: LeaderRow[] = [];
    for (const [playerId, p] of this.players) if (p.row.games >= minGames) rows.push({ ...p.row, name: p.name, playerId });
    return rows.sort((a, b) => b.rating - a.rating).slice(0, limit);
  }

  async rankOf(playerId: string, minGames: number) {
    const all = await this.leaderboard(Number.MAX_SAFE_INTEGER, minGames);
    const i = all.findIndex((r) => r.playerId === playerId);
    return i < 0 ? null : { rank: i + 1, total: all.length, row: all[i] };
  }
}

/** Postgres through Supabase's REST API (PostgREST), using the service-role key. Schema: supabase/ranked.sql. */
export class SupabaseStore implements RankedStore {
  readonly persistent = true;
  private readonly url: string;
  private readonly key: string;
  private readonly season: string;
  private readonly fetchImpl: typeof fetch;
  // No parameter properties: `node server/index.ts` runs in strip-only mode, which rejects them.
  constructor(url: string, key: string, fetchImpl: typeof fetch = fetch, season: string = RANKED_SEASON_ID) {
    this.url = url;
    this.key = key;
    // Workers (and browsers) throw "Illegal invocation" if `fetch` is called as a method of another object.
    this.fetchImpl = (input, init) => fetchImpl(input, init);
    this.season = season;
  }

  private async call<T>(path: string, init: RequestInit & { prefer?: string } = {}): Promise<T> {
    const { prefer, ...rest } = init;
    const res = await this.fetchImpl(`${this.url.replace(/\/$/, '')}/rest/v1/${path}`, {
      ...rest,
      headers: {
        apikey: this.key,
        authorization: `Bearer ${this.key}`,
        'content-type': 'application/json',
        ...(prefer ? { prefer } : {}),
        ...(rest.headers as Record<string, string> | undefined),
      },
    });
    if (!res.ok) throw new Error(`Supabase ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const text = await res.text();
    return (text ? JSON.parse(text) : null) as T;
  }

  private readonly cols = 'rating,games,wins,losses,draws,peak,modes';
  private season_ = () => `season=eq.${encodeURIComponent(this.season)}`;

  async touchPlayer(playerId: string, name: string) {
    await this.call('ranked_players?on_conflict=player_id', {
      method: 'POST',
      prefer: 'resolution=merge-duplicates,return=minimal',
      body: JSON.stringify({ player_id: playerId, name, last_seen: new Date().toISOString() }),
    });
    return this.getRating(playerId);
  }

  async getRating(playerId: string) {
    const rows = await this.call<Partial<RatingRow>[]>(`ranked_season_ratings?player_id=eq.${encodeURIComponent(playerId)}&${this.season_()}&select=${this.cols}`);
    return normalizeRow(rows?.[0]);
  }

  async saveMatch(match: MatchRecord, changes: RatingChange[]) {
    await this.call('ranked_matches', {
      method: 'POST',
      prefer: 'return=minimal',
      body: JSON.stringify({ mode: match.mode, season: match.season, outcome: match.outcome, red_score: match.redScore, blue_score: match.blueScore, status: match.status, players: match.players }),
    });
    if (match.status === 'void') return;
    const names = new Map(match.players.map((p) => [p.playerId, p.name]));
    const rows = [];
    for (const c of changes) {
      if (c.result === 'none') continue;
      const next = applyChange(await this.getRating(c.playerId), c, match.mode);
      rows.push({ player_id: c.playerId, season: this.season, name: names.get(c.playerId) ?? 'Player', ...next, updated_at: new Date().toISOString() });
    }
    if (rows.length) await this.call('ranked_season_ratings?on_conflict=player_id,season', { method: 'POST', prefer: 'resolution=merge-duplicates,return=minimal', body: JSON.stringify(rows) });
  }

  async leaderboard(limit: number, minGames: number) {
    const rows = await this.call<(Partial<RatingRow> & { name: string; player_id: string })[]>(
      `ranked_season_ratings?${this.season_()}&games=gte.${minGames}&order=rating.desc&limit=${limit}&select=player_id,name,${this.cols}`,
    );
    return (rows ?? []).map((r) => ({ ...normalizeRow(r), playerId: r.player_id, name: r.name }));
  }

  async rankOf(playerId: string, minGames: number) {
    const row = await this.getRating(playerId);
    if (row.games < minGames) return null;
    const count = async (filter: string): Promise<number> => {
      const res = await this.fetchImpl(`${this.url.replace(/\/$/, '')}/rest/v1/ranked_season_ratings?${this.season_()}&games=gte.${minGames}&${filter}&select=player_id`, {
        method: 'HEAD',
        headers: { apikey: this.key, authorization: `Bearer ${this.key}`, prefer: 'count=exact' },
      });
      const range = res.headers.get('content-range') ?? '';
      return Number(range.split('/')[1]) || 0;
    };
    const [better, total] = await Promise.all([count(`rating=gt.${row.rating}`), count('rating=gte.0')]);
    return { rank: better + 1, total, row };
  }
}

/** SupabaseStore when SUPABASE_URL + SUPABASE_SERVICE_KEY are set, otherwise an in-memory store. */
export function createRankedStore(env: Record<string, string | undefined> = process.env): RankedStore {
  const url = env.SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_KEY;
  return url && key ? new SupabaseStore(url, key) : new MemoryStore();
}
