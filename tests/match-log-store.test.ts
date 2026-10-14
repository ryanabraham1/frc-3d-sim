import { afterEach, expect, it, vi } from 'vitest';
import { flushPending, type StoredLog } from '../src/engine/telemetry/store';

afterEach(() => vi.unstubAllGlobals());

it('recovers queued matches even after more than six failed uploads', async () => {
  let row: StoredLog = {
    id: '2026-rebuilt-retry.jsonl', createdAt: '2026-10-13T00:00:00Z', seasonId: '2026-rebuilt',
    frames: 4500, text: '{"type":"header"}\n', uploaded: false, attempts: 9,
  };
  // Model the IndexedDB request and transaction callbacks the queue uses.
  vi.stubGlobal('indexedDB', {
    open() {
      const request: Record<string, unknown> = {};
      request.result = {
        close() {},
        transaction() {
          const tx: Record<string, unknown> = {};
          tx.objectStore = () => ({
            getAll() {
              const read: Record<string, unknown> = { result: [row] };
              queueMicrotask(() => (read.onsuccess as () => void)());
              return read;
            },
            put(value: StoredLog) {
              row = value;
              queueMicrotask(() => (tx.oncomplete as () => void)());
            },
          });
          return tx;
        },
      };
      queueMicrotask(() => (request.onsuccess as () => void)());
      return request;
    },
  });
  vi.stubGlobal('location', { protocol: 'https:', host: 'relay.example' });
  const upload = vi.fn(async (_input: string, _init?: RequestInit) => new Response(null, { status: 204 }));
  vi.stubGlobal('fetch', upload);
  await flushPending();
  expect(upload).toHaveBeenCalledOnce();
  expect(upload.mock.calls[0]?.[0]).toBe('https://relay.example/api/match-logs?name=2026-rebuilt-retry.jsonl.gz');
  expect(row.uploaded).toBe(true);
});
