/**
 * Ghost runs: what a solo leaderboard run keeps so others can race it. Poses are in the world frame (origin at field
 * center), sampled at GHOST_HZ against the match clock, so a run plays back on any machine. Pure, and shared with the
 * relay (server/soloScores.ts), so no imports and no parameter properties. See docs/LEADERBOARD.md.
 */

export const GHOST_VERSION = 1;
export const GHOST_HZ = 15;
/** x, y, z, qx, qy, qz, qw per sample. */
export const POSE_STRIDE = 7;
/** t, x, y, z, vx, vy, vz per launched piece. */
export const SHOT_STRIDE = 7;
/** t, leaderboard score per score change. */
export const SCORE_STRIDE = 2;
/** Encoded (gzip + base64) size limit; a full match is about 15-40 KB. */
export const MAX_GHOST_CHARS = 400_000;
const MAX_JSON_BYTES = 4 * 1024 * 1024;
export const MAX_SCORE = 20_000;

export interface GhostRun {
  v: number;
  hz: number;
  /** The alliance it was driven on: playback flips it onto the viewer's side. */
  alliance: 'red' | 'blue';
  /** Final leaderboard score: alliance total less penalties. */
  score: number;
  poses: number[];
  shots: number[];
  scores: number[];
}

/** Stored form: poses as per-column deltas of fixed-point integers, which gzip well. */
interface Packed {
  v: number;
  hz: number;
  a: 'red' | 'blue';
  s: number;
  p: number[];
  h: number[];
  c: number[];
}

const POSE_SCALE = [100, 100, 100, 10000, 10000, 10000, 10000];

function pack(run: GhostRun): Packed {
  const p = new Array<number>(run.poses.length);
  const last = new Array<number>(POSE_STRIDE).fill(0);
  for (let i = 0; i < run.poses.length; i++) {
    const c = i % POSE_STRIDE;
    const q = Math.round(run.poses[i] * POSE_SCALE[c]);
    p[i] = q - last[c];
    last[c] = q;
  }
  const centi = (v: number) => Math.round(v * 100);
  return { v: run.v, hz: run.hz, a: run.alliance, s: run.score, p, h: run.shots.map(centi), c: run.scores.map((v, i) => (i % SCORE_STRIDE ? v : centi(v))) };
}

function unpack(k: Packed): GhostRun | null {
  const ints = (a: unknown): a is number[] => Array.isArray(a) && a.every((v) => Number.isFinite(v));
  if (!k || k.v !== GHOST_VERSION || (k.a !== 'red' && k.a !== 'blue') || !Number.isFinite(k.hz) || k.hz <= 0 || !Number.isFinite(k.s)) return null;
  if (!ints(k.p) || !ints(k.h) || !ints(k.c) || k.p.length % POSE_STRIDE || k.h.length % SHOT_STRIDE || k.c.length % SCORE_STRIDE) return null;
  const poses = new Array<number>(k.p.length);
  const sum = new Array<number>(POSE_STRIDE).fill(0);
  for (let i = 0; i < k.p.length; i++) {
    const c = i % POSE_STRIDE;
    sum[c] += k.p[i];
    poses[i] = sum[c] / POSE_SCALE[c];
  }
  return { v: k.v, hz: k.hz, alliance: k.a, score: k.s, poses, shots: k.h.map((v) => v / 100), scores: k.c.map((v, i) => (i % SCORE_STRIDE ? v : v / 100)) };
}

async function pipe(bytes: Uint8Array, stream: unknown, max: number): Promise<Uint8Array | null> {
  const reader = new Blob([new Uint8Array(bytes)]).stream().pipeThrough(stream as unknown as ReadableWritablePair<Uint8Array, Uint8Array>).getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) { await reader.cancel(); return null; }
    parts.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.byteLength; }
  return out;
}

function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** Compact text form for storage and upload. */
export async function encodeGhost(run: GhostRun): Promise<string> {
  const gz = await pipe(new TextEncoder().encode(JSON.stringify(pack(run))), new CompressionStream('gzip'), MAX_JSON_BYTES);
  return toBase64(gz!);
}

/** Null for anything that isn't a ghost of this version. */
export async function decodeGhost(text: unknown): Promise<GhostRun | null> {
  if (typeof text !== 'string' || !text || text.length > MAX_GHOST_CHARS) return null;
  try {
    const gz = Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
    const json = await pipe(gz, new DecompressionStream('gzip'), MAX_JSON_BYTES);
    return json ? unpack(JSON.parse(new TextDecoder().decode(json)) as Packed) : null;
  } catch {
    return null;
  }
}

/** Fastest a robot's recorded path may move between samples (m/s), and how many jumps a run may have (righting a tipped robot moves it). */
const MAX_SPEED = 12;
const MAX_JUMPS = 10;

/** Why a submitted run can't be real, or null. A plausibility check, not proof: the client runs the sim. */
export function ghostProblem(run: GhostRun, score: number): string | null {
  if (!Number.isInteger(score) || score < 0 || score > MAX_SCORE) return 'score out of range';
  if (run.score !== score) return 'score does not match the run';
  if (run.hz !== GHOST_HZ) return 'wrong sample rate';
  const n = run.poses.length / POSE_STRIDE;
  const seconds = n / run.hz;
  if (seconds < 60 || seconds > 400) return 'wrong match length';
  let jumps = 0;
  const limit = MAX_SPEED / run.hz;
  for (let i = 0; i < n; i++) {
    const j = i * POSE_STRIDE;
    if (Math.abs(run.poses[j]) > 20 || Math.abs(run.poses[j + 2]) > 20 || run.poses[j + 1] < -2 || run.poses[j + 1] > 8) return 'off the field';
    if (i && Math.hypot(run.poses[j] - run.poses[j - POSE_STRIDE], run.poses[j + 2] - run.poses[j + 2 - POSE_STRIDE]) > limit) jumps++;
  }
  if (jumps > MAX_JUMPS) return 'robot moved too fast';
  const last = run.scores.length ? run.scores[run.scores.length - 1] : 0;
  if (last !== score) return 'score timeline does not match';
  return null;
}

/** The leaderboard score the run had at match time `t` (`scores` is sorted by time). */
export function ghostScoreAt(run: GhostRun, t: number): number {
  let lo = 0, hi = run.scores.length / SCORE_STRIDE;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (run.scores[mid * SCORE_STRIDE] <= t) lo = mid + 1;
    else hi = mid;
  }
  return lo ? run.scores[(lo - 1) * SCORE_STRIDE + 1] : 0;
}
