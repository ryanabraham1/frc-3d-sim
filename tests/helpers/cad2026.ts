import { readdirSync, readFileSync } from 'node:fs';
import { decodeCadModel } from '../../src/engine/robot/cadModels';

/**
 * Decode every 2026 robot CAD (public/models/robots/2026/*.glb) into the model cache, as the browser does before a match,
 * so headless robots get the real drawn geometry rather than the lightweight procedural stand-ins.
 */
export async function loadCad2026(): Promise<void> {
  for (const f of readdirSync('public/models/robots/2026')) {
    if (!f.endsWith('.glb')) continue;
    const b = readFileSync(`public/models/robots/2026/${f}`);
    await decodeCadModel(f.replace(/\.glb$/, ''), b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
  }
}
