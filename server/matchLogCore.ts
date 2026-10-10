/**
 * Runtime-neutral half of the match-log upload (docs/MATCH-LOGS.md): validation, rate limits and the Supabase store.
 * Shared by the Node server (server/matchLogs.ts) and the Cloudflare Worker relay (cloudflare/worker.ts), so no
 * node:fs / node:http imports here. No parameter properties: `node server/index.ts` runs in strip-only mode.
 */

export const MAX_GZ_BYTES = 8 * 1024 * 1024;
export const MAX_TEXT_BYTES = 64 * 1024 * 1024;
/** Per IP: uploads allowed in a sliding hour. A real player produces a handful. */
export const PER_HOUR = 30;

export interface LogMeta {
  season: string;
  mode: string;
  seed: number;
  frames: number;
  humanRobots: number;
  archetypes: string[];
  totals: unknown;
}

export interface MatchLogStore {
  readonly persistent: boolean;
  /** `key` is the client's idempotency key (retries overwrite instead of duplicating). */
  save(key: string, gz: Uint8Array, meta: LogMeta): Promise<void>;
}

export class SupabaseLogStore implements MatchLogStore {
  readonly persistent = true;
  private readonly url: string;
  private readonly key: string;
  private readonly fetchImpl: typeof fetch;
  constructor(url: string, key: string, fetchImpl: typeof fetch = fetch) {
    this.url = url.replace(/\/$/, '');
    this.key = key;
    this.fetchImpl = fetchImpl;
  }
  async save(key: string, gz: Uint8Array, meta: LogMeta): Promise<void> {
    const path = `${meta.season}/${key}`;
    const auth = { apikey: this.key, authorization: `Bearer ${this.key}` };
    const up = await this.fetchImpl(`${this.url}/storage/v1/object/match-logs/${path}`, {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/gzip', 'x-upsert': 'true' },
      body: new Uint8Array(gz),
    });
    if (!up.ok) throw new Error(`Supabase storage ${up.status}: ${(await up.text()).slice(0, 200)}`);
    const row = await this.fetchImpl(`${this.url}/rest/v1/match_logs?on_conflict=path`, {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json', prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({
        path, season: meta.season, mode: meta.mode, seed: meta.seed, frames: meta.frames, human_robots: meta.humanRobots,
        archetypes: meta.archetypes, totals: meta.totals ?? null, bytes: gz.length,
      }),
    });
    if (!row.ok) throw new Error(`Supabase match_logs ${row.status}: ${(await row.text()).slice(0, 200)}`);
  }
}

/** Pull the metadata out of a log, rejecting anything that isn't one of ours. */
export function parseLog(text: string): LogMeta | null {
  const lines = text.split('\n');
  let header: { type?: string; version?: number; seasonId?: string; mode?: string; seed?: number; robots?: { archetype?: { label?: string } }[] };
  try {
    header = JSON.parse(lines[0]);
  } catch {
    return null;
  }
  if (header.type !== 'header' || header.version !== 1 || typeof header.seasonId !== 'string' || !/^[\w-]{1,40}$/.test(header.seasonId)) return null;
  let end: { frames?: number; humans?: number; totals?: unknown } = {};
  for (let i = lines.length - 1; i >= 0 && i > lines.length - 6; i--) {
    if (lines[i].startsWith('{"type":"end"')) {
      try { end = JSON.parse(lines[i]); } catch { /* partial log */ }
      break;
    }
  }
  return {
    season: header.seasonId,
    mode: String(header.mode ?? '').slice(0, 20),
    seed: Number(header.seed) || 0,
    frames: Number(end.frames) || 0,
    humanRobots: Number(end.humans) || 0,
    archetypes: [...new Set((header.robots ?? []).map((r) => String(r.archetype?.label ?? 'unknown').slice(0, 60)))],
    totals: end.totals,
  };
}

export const NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,120}\.jsonl\.gz$/;

/** Sliding-hour upload count per IP. */
export class UploadLimiter {
  private readonly hits = new Map<string, number[]>();
  limited(ip: string, now = Date.now()): boolean {
    const recent = (this.hits.get(ip) ?? []).filter((t) => now - t < 3_600_000);
    if (recent.length >= PER_HOUR) {
      this.hits.set(ip, recent);
      return true;
    }
    recent.push(now);
    this.hits.set(ip, recent);
    if (this.hits.size > 5000) for (const [k, v] of this.hits) if (!v.some((t) => now - t < 3_600_000)) this.hits.delete(k);
    return false;
  }
}

export function corsHeaders(allowOrigin = '*'): Record<string, string> {
  return { 'access-control-allow-origin': allowOrigin, 'access-control-allow-methods': 'POST, OPTIONS', 'access-control-allow-headers': 'content-type' };
}

/** Validate a received upload (`text` = the gunzipped body, null when it wasn't gzip or was too big) and store it. */
export async function storeUpload(store: MatchLogStore, name: string, gz: Uint8Array, text: string | null, log?: (msg: string) => void): Promise<{ status: number; body: string }> {
  const meta = text === null ? null : parseLog(text);
  if (!meta) return { status: 400, body: 'not a match log' };
  try {
    await store.save(name, gz, meta);
    return { status: 204, body: '' };
  } catch (e) {
    log?.(`match log not saved: ${(e as Error).message}`);
    return { status: 502, body: 'storage error' };
  }
}

/** Gunzip with an output cap (zip-bomb guard) using the web DecompressionStream; null when not gzip or too big. */
export async function gunzipText(gz: Uint8Array, maxBytes = MAX_TEXT_BYTES): Promise<string | null> {
  try {
    const reader = new Blob([new Uint8Array(gz)]).stream().pipeThrough(new DecompressionStream('gzip')).getReader();
    const parts: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) { await reader.cancel(); return null; }
      parts.push(value);
    }
    const out = new Uint8Array(total);
    let at = 0;
    for (const p of parts) { out.set(p, at); at += p.byteLength; }
    return new TextDecoder().decode(out);
  } catch {
    return null;
  }
}

/** POST /api/match-logs for fetch-style runtimes (the Cloudflare Worker relay). */
export async function handleMatchLogRequest(request: Request, store: MatchLogStore, limiter: UploadLimiter, ip: string, opts: { allowOrigin?: string; log?: (msg: string) => void } = {}): Promise<Response> {
  const end = (status: number, body = '') => new Response(status === 204 ? null : body, { status, headers: { ...corsHeaders(opts.allowOrigin), 'content-type': 'text/plain' } });
  if (request.method === 'OPTIONS') return end(204);
  if (request.method !== 'POST') return end(405);
  const name = new URL(request.url).searchParams.get('name') ?? '';
  if (!NAME_PATTERN.test(name)) return end(400, 'bad name');
  if (Number(request.headers.get('content-length') ?? 0) > MAX_GZ_BYTES) return end(413);
  if (limiter.limited(ip)) return end(429, 'rate limited');
  const gz = new Uint8Array(await request.arrayBuffer());
  if (gz.byteLength > MAX_GZ_BYTES) return end(413);
  const r = await storeUpload(store, name, gz, await gunzipText(gz), opts.log);
  return end(r.status, r.body);
}
