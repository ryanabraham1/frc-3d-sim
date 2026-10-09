import type { IncomingMessage, ServerResponse } from 'node:http';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';

/**
 * Match logs for imitation learning (src/engine/telemetry, docs/MATCH-LOGS.md). Browsers POST a gzipped JSONL log to
 * /api/match-logs; this stores it. Supabase (the same SUPABASE_URL + SUPABASE_SERVICE_KEY as ranked play) keeps the
 * file in the private `match-logs` Storage bucket and a metadata row in `match_logs` (supabase/match_logs.sql);
 * without those env vars logs go to ./data/demos on disk (dev, tests).
 * No parameter properties: `node server/index.ts` runs in strip-only mode, which rejects them.
 */

const MAX_GZ_BYTES = 8 * 1024 * 1024;
const MAX_TEXT_BYTES = 64 * 1024 * 1024;
/** Per IP: uploads allowed in a sliding hour. A real player produces a handful. */
const PER_HOUR = 30;

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
  save(key: string, gz: Buffer, meta: LogMeta): Promise<void>;
}

export class DiskLogStore implements MatchLogStore {
  readonly persistent = true;
  private readonly dir: string;
  constructor(dir = 'data/demos') {
    this.dir = resolve(dir);
  }
  async save(key: string, gz: Buffer): Promise<void> {
    mkdirSync(this.dir, { recursive: true });
    // Dev convenience: keep the raw JSONL so tools/demos_to_dataset.py reads it directly.
    writeFileSync(join(this.dir, key.replace(/\.gz$/, '')), gunzipSync(gz));
  }
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
  async save(key: string, gz: Buffer, meta: LogMeta): Promise<void> {
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

export function createMatchLogStore(env: Record<string, string | undefined> = process.env): MatchLogStore {
  return env.SUPABASE_URL && env.SUPABASE_SERVICE_KEY ? new SupabaseLogStore(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY) : new DiskLogStore();
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

export interface LogHandlerOptions {
  trustProxy?: boolean;
  log?: (msg: string) => void;
  /** Allowed browser origins for cross-origin uploads (the site may be hosted apart from the relay). Default: any. */
  allowOrigin?: string;
}

export function matchLogHandler(store: MatchLogStore, opts: LogHandlerOptions = {}) {
  const hits = new Map<string, number[]>();
  const ipOf = (req: IncomingMessage): string => {
    const fwd = opts.trustProxy ? req.headers['x-forwarded-for'] : undefined;
    const first = (Array.isArray(fwd) ? fwd[0] : fwd)?.split(',')[0]?.trim();
    return first || req.socket.remoteAddress || 'unknown';
  };
  const limited = (ip: string): boolean => {
    const now = Date.now();
    const recent = (hits.get(ip) ?? []).filter((t) => now - t < 3_600_000);
    if (recent.length >= PER_HOUR) {
      hits.set(ip, recent);
      return true;
    }
    recent.push(now);
    hits.set(ip, recent);
    if (hits.size > 5000) for (const [k, v] of hits) if (!v.some((t) => now - t < 3_600_000)) hits.delete(k);
    return false;
  };
  return (req: IncomingMessage, res: ServerResponse): void => {
    const cors = { 'access-control-allow-origin': opts.allowOrigin ?? '*', 'access-control-allow-methods': 'POST, OPTIONS', 'access-control-allow-headers': 'content-type' };
    const end = (code: number, body = '') => {
      res.writeHead(code, { ...cors, 'content-type': 'text/plain' });
      res.end(body);
    };
    if (req.method === 'OPTIONS') return end(204);
    if (req.method !== 'POST') return end(405);
    const name = new URL(req.url ?? '/', 'http://x').searchParams.get('name') ?? '';
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,120}\.jsonl\.gz$/.test(name)) return end(400, 'bad name');
    if (limited(ipOf(req))) return end(429, 'rate limited');
    const chunks: Buffer[] = [];
    let size = 0;
    let rejected = false;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_GZ_BYTES) {
        rejected = true;
        end(413);
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => {
      if (rejected) return;
      const gz = Buffer.concat(chunks);
      let meta: LogMeta | null = null;
      try {
        // maxOutputLength guards against zip bombs: an 8 MB upload can't expand past MAX_TEXT_BYTES.
        meta = parseLog(gunzipSync(gz, { maxOutputLength: MAX_TEXT_BYTES }).toString('utf8'));
      } catch {
        meta = null;
      }
      if (!meta) return end(400, 'not a match log');
      store.save(name, gz, meta).then(
        () => end(204),
        (e: Error) => {
          opts.log?.(`match log not saved: ${e.message}`);
          end(502, 'storage error');
        },
      );
    });
  };
}
