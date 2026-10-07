import { START_RATING, type RankedMode, type RatingChange, type Team } from '../src/engine/net/ranked.ts';

/**
 * Rating persistence for ranked play. The relay is the only writer. `MemoryStore` is for dev, tests and
 * servers without a database (ratings reset on restart); `SupabaseStore` keeps them in Postgres.
 */

export interface RatingRow {
  rating: number;
  games: number;
  wins: number;
  losses: number;
  draws: number;
  peak: number;
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
  /** Register or refresh a player and return all their ratings. */
  touchPlayer(playerId: string, name: string): Promise<Record<RankedMode, RatingRow>>;
  getRating(playerId: string, mode: RankedMode): Promise<RatingRow>;
  /** Record a finished match and apply `changes` to the players' ratings. */
  saveMatch(match: MatchRecord, changes: RatingChange[]): Promise<void>;
  leaderboard(mode: RankedMode, limit: number, minGames: number): Promise<LeaderRow[]>;
  /** 1-based rank among players with at least `minGames` games, and how many there are (null if unranked). */
  rankOf(playerId: string, mode: RankedMode, minGames: number): Promise<{ rank: number; total: number; row: RatingRow } | null>;
}

export const freshRating = (): RatingRow => ({ rating: START_RATING, games: 0, wins: 0, losses: 0, draws: 0, peak: START_RATING });

/** Apply one match result to a rating row (pure). `none` (a void result for a teammate) changes nothing. */
export function applyChange(row: RatingRow, c: RatingChange): RatingRow {
  if (c.result === 'none') return row;
  const rating = c.after;
  return {
    rating,
    games: row.games + 1,
    wins: row.wins + (c.result === 'win' ? 1 : 0),
    losses: row.losses + (c.result === 'loss' || c.result === 'abandon' ? 1 : 0),
    draws: row.draws + (c.result === 'draw' ? 1 : 0),
    peak: Math.max(row.peak, rating),
  };
}

const MODES: RankedMode[] = ['1v1', '2v2', '3v3'];

export class MemoryStore implements RankedStore {
  readonly persistent = false;
  private players = new Map<string, { name: string; ratings: Map<RankedMode, RatingRow> }>();
  readonly matches: MatchRecord[] = [];

  async touchPlayer(playerId: string, name: string) {
    let p = this.players.get(playerId);
    if (!p) this.players.set(playerId, (p = { name, ratings: new Map() }));
    p.name = name;
    return Object.fromEntries(MODES.map((m) => [m, { ...(p!.ratings.get(m) ?? freshRating()) }])) as Record<RankedMode, RatingRow>;
  }

  async getRating(playerId: string, mode: RankedMode) {
    return { ...(this.players.get(playerId)?.ratings.get(mode) ?? freshRating()) };
  }

  async saveMatch(match: MatchRecord, changes: RatingChange[]) {
    this.matches.push(match);
    if (match.status === 'void') return;
    for (const c of changes) {
      const p = this.players.get(c.playerId);
      if (!p) continue;
      p.ratings.set(match.mode, applyChange(p.ratings.get(match.mode) ?? freshRating(), c));
    }
  }

  async leaderboard(mode: RankedMode, limit: number, minGames: number) {
    const rows: LeaderRow[] = [];
    for (const [playerId, p] of this.players) {
      const r = p.ratings.get(mode);
      if (r && r.games >= minGames) rows.push({ ...r, name: p.name, playerId });
    }
    return rows.sort((a, b) => b.rating - a.rating).slice(0, limit);
  }

  async rankOf(playerId: string, mode: RankedMode, minGames: number) {
    const all = await this.leaderboard(mode, Number.MAX_SAFE_INTEGER, minGames);
    const i = all.findIndex((r) => r.playerId === playerId);
    return i < 0 ? null : { rank: i + 1, total: all.length, row: all[i] };
  }
}

/** Postgres through Supabase's REST API (PostgREST), using the service-role key. Schema: supabase/ranked.sql. */
export class SupabaseStore implements RankedStore {
  readonly persistent = true;
  constructor(
    private readonly url: string,
    private readonly key: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

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

  async touchPlayer(playerId: string, name: string) {
    await this.call('ranked_players?on_conflict=player_id', {
      method: 'POST',
      prefer: 'resolution=merge-duplicates,return=minimal',
      body: JSON.stringify({ player_id: playerId, name, last_seen: new Date().toISOString() }),
    });
    const rows = await this.call<(RatingRow & { mode: RankedMode })[]>(`ranked_ratings?player_id=eq.${encodeURIComponent(playerId)}&select=mode,rating,games,wins,losses,draws,peak`);
    const out = Object.fromEntries(MODES.map((m) => [m, freshRating()])) as Record<RankedMode, RatingRow>;
    for (const r of rows ?? []) out[r.mode] = { rating: r.rating, games: r.games, wins: r.wins, losses: r.losses, draws: r.draws, peak: r.peak };
    return out;
  }

  async getRating(playerId: string, mode: RankedMode) {
    const rows = await this.call<RatingRow[]>(`ranked_ratings?player_id=eq.${encodeURIComponent(playerId)}&mode=eq.${mode}&select=rating,games,wins,losses,draws,peak`);
    return rows?.[0] ?? freshRating();
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
      const next = applyChange(await this.getRating(c.playerId, match.mode), c);
      rows.push({ player_id: c.playerId, mode: match.mode, name: names.get(c.playerId) ?? 'Player', ...next, updated_at: new Date().toISOString() });
    }
    if (rows.length) await this.call('ranked_ratings?on_conflict=player_id,mode', { method: 'POST', prefer: 'resolution=merge-duplicates,return=minimal', body: JSON.stringify(rows) });
  }

  async leaderboard(mode: RankedMode, limit: number, minGames: number) {
    const rows = await this.call<(RatingRow & { name: string; player_id: string })[]>(
      `ranked_ratings?mode=eq.${mode}&games=gte.${minGames}&order=rating.desc&limit=${limit}&select=player_id,name,rating,games,wins,losses,draws,peak`,
    );
    return (rows ?? []).map((r) => ({ playerId: r.player_id, name: r.name, rating: r.rating, games: r.games, wins: r.wins, losses: r.losses, draws: r.draws, peak: r.peak }));
  }

  async rankOf(playerId: string, mode: RankedMode, minGames: number) {
    const row = await this.getRating(playerId, mode);
    if (row.games < minGames) return null;
    const count = async (filter: string): Promise<number> => {
      const res = await this.fetchImpl(`${this.url.replace(/\/$/, '')}/rest/v1/ranked_ratings?mode=eq.${mode}&games=gte.${minGames}&${filter}&select=player_id`, {
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
