import { decodeGhost, encodeGhost, type GhostRun } from '@engine/ghost/format';
import { relayHttpBase } from '@engine/telemetry/store';

/**
 * Solo leaderboard data on the browser side. Your best run per robot is always kept here in IndexedDB, so ghosts and
 * personal bests work offline; it goes to the relay's /api/solo-scores too, and a run that couldn't be sent is retried
 * the next time the leaderboard opens. See docs/LEADERBOARD.md.
 */

const DB = 'frc-sim-solo';
const STORE = 'best';
const NAME_KEY = 'frc-sim-name';
const AUTO_GHOST_KEY = 'frc-sim-auto-ghost';

export interface LocalBest {
  key: string;
  season: string;
  robot: string;
  score: number;
  ghost: string;
  at: string;
  sent: boolean;
}

export interface BoardEntry { id: string; name: string; score: number; at: string; mine: boolean }
export interface Board { total: number; entries: BoardEntry[]; me: { id: string; score: number; at: string; rank: number } | null }
export interface RobotSummary { robot: string; top: number; name: string; drivers: number }

export interface RunOutcome {
  score: number;
  /** Your previous best on this robot, null on a first run. */
  previous: number | null;
  /** Position on the online board; null when the relay couldn't be reached. */
  rank: number | null;
  total: number | null;
}

const keyOf = (season: string, robot: string) => `${season}|${robot}`;

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'key' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function transact<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const req = work(db.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

export async function localBests(season: string): Promise<LocalBest[]> {
  try {
    return (await transact<LocalBest[]>('readonly', (s) => s.getAll())).filter((b) => b.season === season);
  } catch {
    return [];
  }
}

async function localBest(season: string, robot: string): Promise<LocalBest | null> {
  try {
    return (await transact<LocalBest | undefined>('readonly', (s) => s.get(keyOf(season, robot)))) ?? null;
  } catch {
    return null;
  }
}

const store = (best: LocalBest) => transact('readwrite', (s) => s.put(best)).catch(() => undefined);

/** Your best run on this robot on this device, to race. */
export async function localGhost(season: string, robot: string): Promise<GhostRun | null> {
  const best = await localBest(season, robot);
  return best ? decodeGhost(best.ghost) : null;
}

export function driverName(): string {
  try { return localStorage.getItem(NAME_KEY) ?? ''; } catch { return ''; }
}
export function saveDriverName(name: string): void {
  try { localStorage.setItem(NAME_KEY, name); } catch { /* this session only */ }
}

/** Race your own best automatically in Solo practice? */
export function autoBestGhost(): boolean {
  try { return localStorage.getItem(AUTO_GHOST_KEY) !== '0'; } catch { return true; }
}
export function setAutoBestGhost(on: boolean): void {
  try { localStorage.setItem(AUTO_GHOST_KEY, on ? '1' : '0'); } catch { /* this session only */ }
}

const api = (query = '') => `${relayHttpBase()}/api/solo-scores${query}`;

async function getJson<T>(query: string, headers: Record<string, string> = {}): Promise<T | null> {
  try {
    const res = await fetch(api(query), { headers });
    return res.ok ? await res.json() as T : null;
  } catch {
    return null;
  }
}

/** Null when the relay can't be reached. */
export async function fetchSummary(season: string): Promise<RobotSummary[] | null> {
  const r = await getJson<{ robots: RobotSummary[] }>(`?season=${encodeURIComponent(season)}`);
  return r?.robots ?? null;
}

export function fetchBoard(season: string, robot: string, secret: string): Promise<Board | null> {
  return getJson<Board>(`?season=${encodeURIComponent(season)}&robot=${encodeURIComponent(robot)}`, secret ? { 'x-solo-secret': secret } : {});
}

export async function fetchGhost(id: string): Promise<GhostRun | null> {
  const r = await getJson<{ ghost: string }>(`?ghost=${encodeURIComponent(id)}`);
  return r ? decodeGhost(r.ghost) : null;
}

async function submit(best: LocalBest, secret: string): Promise<{ rank: number; total: number } | null> {
  if (!secret) return null;
  try {
    const res = await fetch(api(), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ season: best.season, robot: best.robot, name: driverName(), secret, score: best.score, ghost: best.ghost }),
    });
    if (!res.ok) return null;
    const out = await res.json() as { rank: number; total: number };
    await store({ ...best, sent: true });
    return out;
  } catch {
    return null;
  }
}

/** Keep a finished run if it's your best, and put it on the online board. */
export async function recordRun(season: string, robot: string, run: GhostRun, secret: string): Promise<RunOutcome> {
  const old = await localBest(season, robot);
  const previous = old?.score ?? null;
  if (old && old.score >= run.score) {
    const standing = await fetchBoard(season, robot, secret);
    return { score: run.score, previous, rank: standing?.me?.rank ?? null, total: standing?.total ?? null };
  }
  const best: LocalBest = { key: keyOf(season, robot), season, robot, score: run.score, ghost: await encodeGhost(run), at: new Date().toISOString(), sent: false };
  await store(best);
  const placed = await submit(best, secret);
  return { score: run.score, previous, rank: placed?.rank ?? null, total: placed?.total ?? null };
}

/** Send any best the relay hasn't got yet (it was offline, or the driver's first run was before it was reachable). */
export async function flushBests(season: string, secret: string): Promise<void> {
  for (const best of await localBests(season)) if (!best.sent) await submit(best, secret);
}

/** Change your name on every board. */
export async function renameDriver(name: string, secret: string): Promise<void> {
  saveDriverName(name);
  if (!secret) return;
  try {
    await fetch(api(), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ rename: true, name, secret }) });
  } catch { /* the next run sends the name */ }
}
