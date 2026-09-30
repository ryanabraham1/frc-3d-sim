/** Unit helpers. Engine works in SI (meters, seconds, kg, radians); manuals are in inches. */

export const METERS_PER_INCH = 0.0254;

export const inch = (v: number): number => v * METERS_PER_INCH;
export const ft = (v: number): number => v * 12 * METERS_PER_INCH;
export const lb = (v: number): number => v * 0.45359237;
export const deg = (v: number): number => (v * Math.PI) / 180;
export const toDeg = (rad: number): number => (rad * 180) / Math.PI;
export const toInch = (m: number): number => m / METERS_PER_INCH;

export const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const smoothstep = (t: number): number => {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
};

/** Wrap an angle to (-PI, PI]. */
export function wrapAngle(a: number): number {
  let r = a % (2 * Math.PI);
  if (r <= -Math.PI) r += 2 * Math.PI;
  if (r > Math.PI) r -= 2 * Math.PI;
  return r;
}

/** Format seconds as M:SS (ceil so the display reads like an FRC field timer). */
export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds - 1e-6));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, '0')}`;
}
