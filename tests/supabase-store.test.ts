import { describe, expect, it } from 'vitest';
import { SupabaseStore } from '../server/rankedStore';

describe('supabase store', () => {
  it('calls fetch without binding it to the store (Cloudflare Workers reject that)', async () => {
    // Like a Worker's fetch: throws "Illegal invocation" unless called with no (or the global) `this`.
    const strict = function (this: unknown, _url: unknown, _init?: unknown): Promise<Response> {
      if (this !== undefined && this !== globalThis) throw new TypeError('Illegal invocation');
      return Promise.resolve(new Response('[]', { status: 200, headers: { 'content-range': '0-0/0' } }));
    } as typeof fetch;
    const store = new SupabaseStore('https://example.supabase.co', 'key', strict);
    expect((await store.touchPlayer('a'.repeat(32), 'Ann')).rating).toBe(1000);
    expect(await store.leaderboard(5, 1)).toEqual([]);
  });
});
