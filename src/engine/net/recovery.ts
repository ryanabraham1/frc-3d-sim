import type { RigidBody } from '@dimforge/rapier3d-compat';
/** Portable gameplay checkpoints. Only explicitly named fields can be restored. */
export type RecoveryFields = Record<string, string>;

function replacer(_key: string, value: unknown): unknown {
  if (value === undefined || typeof value === 'function') throw new Error('Checkpoint field contains a runtime reference');
  if (typeof value === 'number' && !Number.isFinite(value)) return { $number: String(value) };
  if (value instanceof Map) return { $map: [...value] };
  if (value instanceof Set) return { $set: [...value] };
  if (value && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype) {
    throw new Error('Checkpoint field contains a runtime object');
  }
  return value;
}
function reviver(_key: string, value: unknown): unknown {
  if (!value || typeof value !== 'object') return value;
  const v = value as Record<string, unknown>;
  if ('$number' in v) return Number(v.$number);
  if ('$map' in v) return new Map(v.$map as [unknown, unknown][]);
  if ('$set' in v) return new Set(v.$set as unknown[]);
  return value;
}
export function captureFields(target: object, keys: readonly string[]): RecoveryFields {
  const fields = target as Record<string, unknown>;
  return Object.fromEntries(keys.map(key => [key, JSON.stringify(fields[key], replacer)]));
}
export function restoreFields(target: object, keys: readonly string[], state: RecoveryFields): void {
  const fields = target as Record<string, unknown>;
  for (const key of keys) {
    if (typeof state[key] !== 'string') throw new Error(`Missing checkpoint field: ${key}`);
    const value = JSON.parse(state[key], reviver);
    const current = fields[key];
    if (current instanceof Map && value instanceof Map) { current.clear(); value.forEach((v, k) => current.set(k, v)); }
    else if (current instanceof Set && value instanceof Set) { current.clear(); value.forEach(v => current.add(v)); }
    else if (Array.isArray(current) && Array.isArray(value)) current.splice(0, current.length, ...value);
    else fields[key] = value;
  }
}
/** AI route progress is data; world/robot/strategy references stay bound to the new world. */
export function capturePilot(target: object): RecoveryFields {
  const out: RecoveryFields = {};
  for (const key of Object.keys(target)) {
    const value = (target as Record<string, unknown>)[key];
    if (value === undefined || typeof value === 'function') continue;
    try { Object.assign(out, captureFields(target, [key])); } catch { /* runtime reference */ }
  }
  return out;
}
export function restorePilot(target: object, state: RecoveryFields): void {
  // Recompute the safe field list locally; never let a checkpoint overwrite world references.
  restoreFields(target, Object.keys(capturePilot(target)).filter(key => typeof state[key] === 'string'), state);
}

export function bodyState(body: RigidBody) {
  return { p: body.translation(), q: body.rotation(), v: body.linvel(), w: body.angvel(),
    type: body.bodyType(), enabled: body.isEnabled(), sleeping: body.isSleeping(),
    colliders: Array.from({ length: body.numColliders() }, (_, i) => {
      const c = body.collider(i);
      return { groups: c.collisionGroups(), sensor: c.isSensor() };
    }) };
}
export function restoreBody(body: RigidBody, state: ReturnType<typeof bodyState>): void {
  body.setBodyType(state.type, false);
  body.setEnabled(state.enabled);
  body.setTranslation(state.p, false); body.setRotation(state.q, false);
  body.setLinvel(state.v, false); body.setAngvel(state.w, false);
  state.colliders.forEach((c, i) => { if (i < body.numColliders()) {
    body.collider(i).setCollisionGroups(c.groups); body.collider(i).setSensor(c.sensor);
  } });
  if (state.sleeping) body.sleep(); else if (state.enabled) body.wakeUp();
}

export interface CompressedCheckpoint { encoding: 'gzip'; payload: string }
/** Compression runs through a native stream instead of adding a large frame to the host's uplink. */
export async function compressCheckpoint(json: string): Promise<unknown> {
  if (typeof CompressionStream === 'undefined') return JSON.parse(json);
  const stream = new Blob([json]).stream().pipeThrough(new CompressionStream('gzip'));
  const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return { encoding: 'gzip', payload: btoa(binary) };
}
export async function decompressCheckpoint(data: unknown): Promise<unknown> {
  const compressed = data as CompressedCheckpoint;
  if (compressed?.encoding !== 'gzip') return data;
  const bytes = Uint8Array.from(atob(compressed.payload), c => c.charCodeAt(0));
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return JSON.parse(await new Response(stream).text());
}
