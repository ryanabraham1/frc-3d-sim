/** Visual preferences only; shared across every season. */
export type LightingPreset = 'arena' | 'studio' | 'dramatic';

export const LIGHTING = {
  arena: { sky: 0xdfe8ff, ground: 0x3a3228, ambient: 1.1, key: 0xffffff, keyPower: 2.2, keyPosition: [-6, 18, 8], fill: 0xbfd4ff, fillPower: 0.6, exposure: 1.05, background: 0x0c0e13 },
  studio: { sky: 0xeaf2ff, ground: 0x51473c, ambient: 1.45, key: 0xffedd8, keyPower: 2.6, keyPosition: [-8, 14, 6], fill: 0xc4ddff, fillPower: 1.1, exposure: 1.05, background: 0x111722 },
  dramatic: { sky: 0xaac7ff, ground: 0x29202a, ambient: 0.55, key: 0xffd4a0, keyPower: 3.6, keyPosition: [-10, 10, 8], fill: 0x80b4ff, fillPower: 1.25, exposure: 1.1, background: 0x070a12 },
} as const;

export function normalizeLighting(value: unknown): LightingPreset {
  return value === 'studio' || value === 'dramatic' ? value : 'arena';
}

export function normalizeBrightness(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0.7, Math.min(1.4, value)) : 1;
}
