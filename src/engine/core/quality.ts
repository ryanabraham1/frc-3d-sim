/**
 * Device-based quality: a tier picked from what the device reports (cores, memory, GPU, touch), a player override, and
 * a governor that sheds work at runtime when the machine can't keep up. Heuristic thresholds are estimates [EST]; the
 * governor is what actually protects a slow device.
 */
export type QualityTier = 'low' | 'medium' | 'high';
export type QualityPref = 'auto' | QualityTier;

/**
 * Which robots keep their held FUEL as real Rapier bodies (`StowBay`). The rest draw the visual-only particle pile,
 * which costs no physics step time and looks the same to everyone watching (it is what every multiplayer client sees).
 */
export type HopperPhysics = 'all' | 'player' | 'none';

export interface QualityProfile {
  tier: QualityTier;
  /** Highest render pixel ratio (the dynamic resolution works below it). */
  pixelRatioCap: number;
  /** Floor of the dynamic resolution. */
  minPixelRatio: number;
  shadows: boolean;
  /** Real-body hoppers when solo / when hosting a multiplayer match (remote drivers' hoppers are never simulated on the host). */
  hopperSolo: HopperPhysics;
  hopperHost: HopperPhysics;
  /** Simulated balls per hopper before the lower layers are buried (see StowBay). */
  activeMax: number;
}

export const QUALITY: Record<QualityTier, QualityProfile> = {
  low: { tier: 'low', pixelRatioCap: 1, minPixelRatio: 0.6, shadows: false, hopperSolo: 'none', hopperHost: 'none', activeMax: 14 },
  medium: { tier: 'medium', pixelRatioCap: 1.25, minPixelRatio: 0.7, shadows: true, hopperSolo: 'player', hopperHost: 'player', activeMax: 20 },
  high: { tier: 'high', pixelRatioCap: 1.5, minPixelRatio: 0.75, shadows: true, hopperSolo: 'all', hopperHost: 'player', activeMax: 26 },
};

export interface DeviceInfo {
  cores?: number;
  /** navigator.deviceMemory (GB, Chromium only, capped at 8 by the browser). */
  memoryGb?: number;
  touch?: boolean;
  /** UNMASKED_RENDERER_WEBGL, if the browser exposes it. */
  gpu?: string;
  screenPixels?: number;
}

const SOFTWARE_GPU = /swiftshader|llvmpipe|software|microsoft basic|softpipe/i;
const WEAK_GPU = /mali-[gt]?[1-6]\d\d|adreno \(?tm\)? ?[1-5]\d\d|powervr|videocore|intel\(r\) (hd|uhd|iris\(r\) plus) graphics ?\d*$|intel.*(hd graphics|uhd graphics) ?\d*/i;

/** Pure classification of a device, so it can be tested. */
export function classifyDevice(d: DeviceInfo): QualityTier {
  if (d.gpu && SOFTWARE_GPU.test(d.gpu)) return 'low';
  const cores = d.cores ?? 4;
  const mem = d.memoryGb ?? (cores >= 8 ? 8 : 4);
  let tier: QualityTier = cores >= 8 && mem >= 8 ? 'high' : cores >= 4 && mem >= 4 ? 'medium' : 'low';
  if (cores >= 6 && mem >= 4 && !d.touch) tier = 'high';
  // Phones and tablets run hot and throttle: never above medium.
  if (d.touch && tier === 'high') tier = 'medium';
  if (d.gpu && WEAK_GPU.test(d.gpu)) tier = tier === 'high' ? 'medium' : 'low';
  if (d.screenPixels && d.screenPixels > 3840 * 2160 * 0.9 && tier === 'high') tier = 'medium'; // 4K+ fills slowly
  return tier;
}

const STORAGE_KEY = 'frc-quality';
let detected: QualityTier | null = null;

function gpuName(): string | undefined {
  try {
    const gl = document.createElement('canvas').getContext('webgl') as WebGLRenderingContext | null;
    if (!gl) return undefined;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const name = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : undefined;
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return name;
  } catch {
    return undefined;
  }
}

export function detectDevice(): DeviceInfo {
  const nav = typeof navigator === 'undefined' ? undefined : (navigator as Navigator & { deviceMemory?: number });
  return {
    cores: nav?.hardwareConcurrency,
    memoryGb: nav?.deviceMemory,
    touch: typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches,
    gpu: gpuName(),
    screenPixels: typeof screen === 'undefined' ? undefined : screen.width * screen.height * (window.devicePixelRatio || 1) ** 2,
  };
}

export function detectTier(): QualityTier {
  return (detected ??= classifyDevice(detectDevice()));
}

/** The player's choice: `?quality=` wins over the saved menu setting. */
export function qualityPref(): QualityPref {
  const valid = (v: string | null): v is QualityPref => v === 'auto' || v === 'low' || v === 'medium' || v === 'high';
  try {
    const q = new URLSearchParams(location.search).get('quality');
    if (valid(q)) return q;
    const s = localStorage.getItem(STORAGE_KEY);
    if (valid(s)) return s;
  } catch { /* storage blocked */ }
  return 'auto';
}

export function setQualityPref(pref: QualityPref): void {
  try { localStorage.setItem(STORAGE_KEY, pref); } catch { /* storage blocked */ }
}

export function resolveTier(pref: QualityPref = qualityPref()): QualityTier {
  return pref === 'auto' ? detectTier() : pref;
}

export function stepDown(t: QualityTier): QualityTier {
  return t === 'high' ? 'medium' : 'low';
}

/**
 * Runtime shedding. Feed it the host's sim load (fraction of wall time spent simulating) and the frame rate; it reports
 * when to drop a level of work. One-way within a match: a machine that struggled once will again, and flip-flopping
 * between representations is what players see as glitches.
 */
export class QualityGovernor {
  private simHot = 0;
  private fpsLow = 0;
  private cooldown = 0;

  /** Call every ~0.5 s. `fps` is the real frame rate (0 = unknown). Returns what to shed now, if anything. */
  update(simLoad: number, fps: number, dtSec = 0.5): 'hopper' | 'shadows' | null {
    this.cooldown = Math.max(0, this.cooldown - dtSec);
    this.simHot = simLoad > 0.6 ? this.simHot + dtSec : Math.max(0, this.simHot - dtSec);
    this.fpsLow = fps > 0 && fps < 40 ? this.fpsLow + dtSec : Math.max(0, this.fpsLow - dtSec);
    if (this.cooldown > 0) return null;
    if (this.simHot >= 2) {
      this.simHot = 0;
      this.cooldown = 3;
      return 'hopper';
    }
    if (this.fpsLow >= 6) {
      this.fpsLow = 0;
      this.cooldown = 3;
      return 'shadows';
    }
    return null;
  }
}
