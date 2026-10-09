import { NetClient } from '../net/netClient';

/**
 * Where finished match logs go (browser side). Every log is kept in IndexedDB until the server has it, and is
 * gzipped and POSTed to the relay's /api/match-logs (which stores it in Supabase, or on disk in dev). A log that
 * fails to upload (offline, relay asleep, tab closed mid-upload) stays queued and is retried the next time the game
 * starts. Everything is best-effort: logging must never break a match.
 */

const DB = 'frc-sim-logs';
const STORE = 'matches';
/** Keep at most this many already-uploaded logs locally; un-uploaded ones are never dropped. */
const KEEP_UPLOADED = 10;
/** Give up on a log after this many failed attempts (a rejected file shouldn't retry forever). */
const MAX_ATTEMPTS = 6;

export interface StoredLog {
  id: string;
  createdAt: string;
  seasonId: string;
  frames: number;
  text: string;
  uploaded: boolean;
  attempts: number;
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

const done = (tx: IDBTransaction) => new Promise<void>((resolve, reject) => {
  tx.oncomplete = () => resolve();
  tx.onerror = tx.onabort = () => reject(tx.error);
});

export function logFileName(seasonId: string, createdAt: string): string {
  return `${seasonId}-${createdAt.replace(/[:.]/g, '-')}.jsonl`;
}

/** The relay's HTTP origin: VITE_RELAY_URL (ws[s]://host/ws) when the site is hosted apart from it, else this page. */
function uploadUrl(id: string): string {
  const ws = NetClient.defaultUrl();
  const base = ws.startsWith('ws') ? ws.replace(/^ws/, 'http').replace(/\/ws\/?$/, '') : '';
  return `${base}/api/match-logs?name=${encodeURIComponent(id + '.gz')}`;
}

async function gzip(text: string): Promise<Blob> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Response(stream).blob();
}

async function put(log: StoredLog): Promise<void> {
  const db = await open();
  const tx = db.transaction(STORE, 'readwrite');
  tx.objectStore(STORE).put(log);
  await done(tx);
  db.close();
}

async function upload(log: StoredLog): Promise<boolean> {
  try {
    const res = await fetch(uploadUrl(log.id), { method: 'POST', headers: { 'content-type': 'application/gzip' }, body: await gzip(log.text) });
    return res.ok;
  } catch {
    return false;
  }
}

async function tryUpload(log: StoredLog): Promise<void> {
  const ok = await upload(log);
  try {
    await put({ ...log, uploaded: ok, attempts: log.attempts + (ok ? 0 : 1) });
  } catch { /* storage unavailable */ }
}

export async function saveLog(log: Pick<StoredLog, 'createdAt' | 'seasonId' | 'frames' | 'text'>): Promise<string> {
  const stored: StoredLog = { ...log, id: logFileName(log.seasonId, log.createdAt), uploaded: false, attempts: 0 };
  try { await put(stored); } catch { /* private mode / quota: still try the upload */ }
  await tryUpload(stored);
  await prune();
  return stored.id;
}

/** Retry logs that never reached the server (call once at game start). */
export async function flushPending(): Promise<void> {
  for (const l of await listLogs()) if (!l.uploaded && l.attempts < MAX_ATTEMPTS) await tryUpload(l);
  await prune();
}

async function prune(): Promise<void> {
  try {
    const sent = (await listLogs()).filter((l) => l.uploaded).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const stale = sent.slice(0, Math.max(0, sent.length - KEEP_UPLOADED));
    if (!stale.length) return;
    const db = await open();
    const tx = db.transaction(STORE, 'readwrite');
    for (const s of stale) tx.objectStore(STORE).delete(s.id);
    await done(tx);
    db.close();
  } catch { /* ignore */ }
}

export async function listLogs(): Promise<StoredLog[]> {
  try {
    const db = await open();
    const rows = await new Promise<StoredLog[]>((resolve, reject) => {
      const req = db.transaction(STORE).objectStore(STORE).getAll();
      req.onsuccess = () => resolve(req.result as StoredLog[]);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return rows;
  } catch { return []; }
}

export function downloadText(name: string, text: string): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'application/x-ndjson' }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}

/** Console helper: `await matchLogs.list()`, `await matchLogs.downloadAll()`; also retries pending uploads now. */
export function installConsoleHelpers(): void {
  void flushPending();
  (window as unknown as { matchLogs: unknown }).matchLogs = {
    list: async () => (await listLogs()).map(({ id, frames, createdAt, uploaded, attempts }) => ({ id, frames, createdAt, uploaded, attempts })),
    downloadAll: async () => { for (const l of await listLogs()) downloadText(l.id, l.text); },
    flush: flushPending,
  };
}
