/** The relay's /api/match-logs endpoint: validation, limits and the Supabase calls. */
import { afterEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { gzipSync } from 'node:zlib';
import { matchLogHandler, parseLog, SupabaseLogStore, type LogMeta, type MatchLogStore } from '../server/matchLogs';

const log = (over: Record<string, unknown> = {}) => [
  JSON.stringify({ type: 'header', version: 1, seasonId: '2026-rebuilt', mode: 'host', seed: 5, robots: [{ id: 0, archetype: { label: 'turret-hopper' } }, { id: 1, archetype: { label: 'custom' } }], ...over }),
  JSON.stringify({ type: 'frame', t: 1, f: 0, rows: [] }),
  JSON.stringify({ type: 'end', t: 150, frames: 4500, humans: 2, totals: { red: 40, blue: 55 } }),
].join('\n') + '\n';

describe('parseLog', () => {
  it('extracts the metadata the table stores', () => {
    expect(parseLog(log())).toEqual({ season: '2026-rebuilt', mode: 'host', seed: 5, frames: 4500, humanRobots: 2, archetypes: ['turret-hopper', 'custom'], totals: { red: 40, blue: 55 } });
  });
  it('accepts an abandoned match with no end record', () => {
    expect(parseLog(log().split('\n').slice(0, 2).join('\n'))?.frames).toBe(0);
  });
  it('rejects anything else', () => {
    expect(parseLog('hello')).toBeNull();
    expect(parseLog(log({ version: 2 }))).toBeNull();
    expect(parseLog(log({ seasonId: '../etc' }))).toBeNull();
  });
});

describe('POST /api/match-logs', () => {
  let server: Server | undefined;
  afterEach(() => { server?.close(); server = undefined; });
  function start(store: MatchLogStore) {
    server = createServer(matchLogHandler(store));
    return new Promise<string>((resolve) => server!.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${(server!.address() as AddressInfo).port}/api/match-logs`)));
  }
  const saved: { key: string; bytes: number; meta: LogMeta }[] = [];
  const store: MatchLogStore = { persistent: true, async save(key, gz, meta) { saved.push({ key, bytes: gz.length, meta }); } };
  const post = (url: string, name: string, body: Buffer | string) => fetch(`${url}?name=${name}`, { method: 'POST', body: new Uint8Array(Buffer.from(body)) });

  it('stores a valid gzipped log with its metadata', async () => {
    saved.length = 0;
    const url = await start(store);
    const res = await post(url, '2026-rebuilt-a.jsonl.gz', gzipSync(log()));
    expect(res.status).toBe(204);
    expect(saved).toHaveLength(1);
    expect(saved[0].key).toBe('2026-rebuilt-a.jsonl.gz');
    expect(saved[0].meta.humanRobots).toBe(2);
  });

  it('rejects bad names, non-gzip bodies and non-log content', async () => {
    saved.length = 0;
    const url = await start(store);
    expect((await post(url, '..%2Fx.jsonl.gz', gzipSync(log()))).status).toBe(400);
    expect((await post(url, 'a.jsonl.gz', 'not gzip')).status).toBe(400);
    expect((await post(url, 'a.jsonl.gz', gzipSync('{"hello":1}'))).status).toBe(400);
    expect(saved).toHaveLength(0);
  });

  it('rate-limits one IP', async () => {
    const url = await start(store);
    const codes: number[] = [];
    for (let i = 0; i < 32; i++) codes.push((await post(url, `r${i}.jsonl.gz`, gzipSync(log()))).status);
    expect(codes.slice(0, 30).every((c) => c === 204)).toBe(true);
    expect(codes.slice(30)).toEqual([429, 429]);
  });

  it('answers a browser preflight', async () => {
    const url = await start(store);
    const res = await fetch(url, { method: 'OPTIONS' });
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
  });
});

describe('SupabaseLogStore', () => {
  it('uploads to the private bucket then upserts the metadata row', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fake = (async (url: string, init: RequestInit) => { calls.push({ url, init }); return new Response(null, { status: 200 }); }) as unknown as typeof fetch;
    const s = new SupabaseLogStore('https://proj.supabase.co/', 'service-key', fake);
    await s.save('m.jsonl.gz', Buffer.from('gz'), { season: '2026-rebuilt', mode: 'solo', seed: 1, frames: 10, humanRobots: 1, archetypes: ['x'], totals: null });
    expect(calls[0].url).toBe('https://proj.supabase.co/storage/v1/object/match-logs/2026-rebuilt/m.jsonl.gz');
    expect((calls[0].init.headers as Record<string, string>)['x-upsert']).toBe('true');
    expect(calls[1].url).toContain('/rest/v1/match_logs?on_conflict=path');
    expect(JSON.parse(calls[1].init.body as string)).toMatchObject({ path: '2026-rebuilt/m.jsonl.gz', human_robots: 1, archetypes: ['x'] });
  });
  it('surfaces storage failures so the client keeps the log queued', async () => {
    const fake = (async () => new Response('nope', { status: 500 })) as unknown as typeof fetch;
    await expect(new SupabaseLogStore('https://p.supabase.co', 'k', fake).save('a.jsonl.gz', Buffer.from('x'), { season: 's', mode: '', seed: 0, frames: 0, humanRobots: 0, archetypes: [], totals: null })).rejects.toThrow(/500/);
  });
});
