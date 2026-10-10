import type { IncomingMessage, ServerResponse } from 'node:http';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { corsHeaders, MAX_GZ_BYTES, MAX_TEXT_BYTES, NAME_PATTERN, storeUpload, SupabaseLogStore, UploadLimiter, type MatchLogStore } from './matchLogCore.ts';

export { parseLog, SupabaseLogStore, type LogMeta, type MatchLogStore } from './matchLogCore.ts';

/**
 * Match logs for imitation learning (src/engine/telemetry, docs/MATCH-LOGS.md). Browsers POST a gzipped JSONL log to
 * /api/match-logs; this stores it. Supabase (the same SUPABASE_URL + SUPABASE_SERVICE_KEY as ranked play) keeps the
 * file in the private `match-logs` Storage bucket and a metadata row in `match_logs` (supabase/match_logs.sql);
 * without those env vars logs go to ./data/demos on disk (dev, tests). The Cloudflare Worker relay serves the same
 * endpoint from server/matchLogCore.ts.
 * No parameter properties: `node server/index.ts` runs in strip-only mode, which rejects them.
 */

export class DiskLogStore implements MatchLogStore {
  readonly persistent = true;
  private readonly dir: string;
  constructor(dir = 'data/demos') {
    this.dir = resolve(dir);
  }
  async save(key: string, gz: Uint8Array): Promise<void> {
    mkdirSync(this.dir, { recursive: true });
    // Dev convenience: keep the raw JSONL so tools/demos_to_dataset.py reads it directly.
    writeFileSync(join(this.dir, key.replace(/\.gz$/, '')), gunzipSync(gz));
  }
}

export function createMatchLogStore(env: Record<string, string | undefined> = process.env): MatchLogStore {
  return env.SUPABASE_URL && env.SUPABASE_SERVICE_KEY ? new SupabaseLogStore(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY) : new DiskLogStore();
}

export interface LogHandlerOptions {
  trustProxy?: boolean;
  log?: (msg: string) => void;
  /** Allowed browser origins for cross-origin uploads (the site may be hosted apart from the relay). Default: any. */
  allowOrigin?: string;
}

export function matchLogHandler(store: MatchLogStore, opts: LogHandlerOptions = {}) {
  const limiter = new UploadLimiter();
  const ipOf = (req: IncomingMessage): string => {
    const fwd = opts.trustProxy ? req.headers['x-forwarded-for'] : undefined;
    const first = (Array.isArray(fwd) ? fwd[0] : fwd)?.split(',')[0]?.trim();
    return first || req.socket.remoteAddress || 'unknown';
  };
  return (req: IncomingMessage, res: ServerResponse): void => {
    const end = (code: number, body = '') => {
      res.writeHead(code, { ...corsHeaders(opts.allowOrigin), 'content-type': 'text/plain' });
      res.end(body);
    };
    if (req.method === 'OPTIONS') return end(204);
    if (req.method !== 'POST') return end(405);
    const name = new URL(req.url ?? '/', 'http://x').searchParams.get('name') ?? '';
    if (!NAME_PATTERN.test(name)) return end(400, 'bad name');
    if (limiter.limited(ipOf(req))) return end(429, 'rate limited');
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
      let text: string | null = null;
      try {
        // maxOutputLength guards against zip bombs: an 8 MB upload can't expand past MAX_TEXT_BYTES.
        text = gunzipSync(gz, { maxOutputLength: MAX_TEXT_BYTES }).toString('utf8');
      } catch {
        text = null;
      }
      void storeUpload(store, name, gz, text, opts.log).then((r) => end(r.status, r.body));
    });
  };
}
