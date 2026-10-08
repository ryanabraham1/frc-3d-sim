/**
 * Match sound cues in the style of an FRC field (AUTO charge, AUTO-end buzzer, TELEOP bells, END GAME train whistle,
 * match-end buzzer, shift changes), using locally bundled field recordings.
 * WebAudio synthesis remains a fallback if a recording cannot be played.
 * Muting is a per-browser preference.
 */
const KEY = 'frc-sim:sound';

export type Cue = 'start' | 'autoEnd' | 'teleop' | 'period' | 'endgame' | 'end';

export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private _muted = false;
  private clips = new Map<Cue, HTMLAudioElement>();
  private disposed = false;

  constructor() {
    if (typeof Audio !== 'undefined') {
      const files: Record<Cue, string> = {
        start: 'start', autoEnd: 'end', teleop: 'resume',
        period: 'shift_change', endgame: 'warning', end: 'end',
      };
      for (const [cue, file] of Object.entries(files)) {
        const clip = new Audio(`${import.meta.env.BASE_URL}audio/frc/${file}.wav`);
        clip.preload = 'auto';
        clip.volume = 0.5;
        this.clips.set(cue as Cue, clip);
      }
    }
    try {
      this._muted = localStorage.getItem(KEY) === 'off';
    } catch {
      // Storage blocked: sound stays on.
    }
  }

  get muted(): boolean {
    return this._muted;
  }

  set muted(m: boolean) {
    this._muted = m;
    try {
      localStorage.setItem(KEY, m ? 'off' : 'on');
    } catch {
      // Not persisted.
    }
    if (this.master) this.master.gain.value = m ? 0 : 0.5;
    for (const clip of this.clips.values()) clip.muted = m;
  }

  /** Lazily open the audio context (browsers only allow it after a user gesture, which starting a match is). */
  private audio(): AudioContext | null {
    if (this._muted) return null;
    if (!this.ctx) {
      const AC = (globalThis as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext
        ?? (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return null;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.5;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    return this.ctx;
  }

  play(cue: Cue): void {
    if (this._muted || this.disposed) return;
    const clip = this.clips.get(cue);
    if (clip) {
      // Stop the previous cue when a match is restarted or periods change quickly.
      for (const other of this.clips.values()) other.pause();
      clip.currentTime = 0;
      void clip.play().catch(() => {
        if (!this.disposed && !this._muted) this.synthesize(cue);
      });
      return;
    }
    this.synthesize(cue);
  }

  private synthesize(cue: Cue): void {
    const ctx = this.audio();
    if (!ctx || !this.master) return;
    const t = ctx.currentTime + 0.02;
    switch (cue) {
      case 'start':
        // Cavalry-charge arpeggio: G4 C5 E5 G5, the last one held.
        [392, 523.25, 659.25, 783.99].forEach((f, i) => this.brass(ctx, f, t + i * 0.13, i === 3 ? 0.7 : 0.12));
        break;
      case 'autoEnd':
      case 'end':
        this.buzzer(ctx, t, cue === 'end' ? 1.4 : 0.8);
        break;
      case 'teleop':
        for (let i = 0; i < 3; i++) this.bell(ctx, 1046.5, t + i * 0.32);
        break;
      case 'period':
        this.bell(ctx, 880, t);
        break;
      case 'endgame':
        this.whistle(ctx, t, 1.3);
        break;
    }
  }

  private env(ctx: AudioContext, t: number, attack: number, hold: number, release: number, peak: number): GainNode {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.setValueAtTime(peak, t + attack + hold);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + hold + release);
    g.connect(this.master!);
    return g;
  }

  private osc(ctx: AudioContext, type: OscillatorType, f: number, t: number, dur: number, out: AudioNode, detune = 0): OscillatorNode {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = f;
    o.detune.value = detune;
    o.connect(out);
    o.start(t);
    o.stop(t + dur + 0.05);
    return o;
  }

  private brass(ctx: AudioContext, f: number, t: number, hold: number): void {
    const g = this.env(ctx, t, 0.02, hold, 0.18, 0.28);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(900, t);
    lp.frequency.linearRampToValueAtTime(2600, t + 0.08);
    lp.connect(g);
    for (const d of [-6, 6]) this.osc(ctx, 'sawtooth', f, t, hold + 0.2, lp, d);
  }

  private buzzer(ctx: AudioContext, t: number, dur: number): void {
    const g = this.env(ctx, t, 0.01, dur, 0.08, 0.22);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1400;
    lp.connect(g);
    for (const f of [110, 116.5, 220]) this.osc(ctx, 'square', f, t, dur + 0.1, lp);
  }

  private bell(ctx: AudioContext, f: number, t: number): void {
    // Inharmonic partials with a fast decay read as a struck bell.
    [[1, 0.35], [2.76, 0.12], [5.4, 0.06]].forEach(([k, a]) => {
      const g = this.env(ctx, t, 0.003, 0.01, 0.9 / k, a);
      this.osc(ctx, 'sine', f * k, t, 1, g);
    });
  }

  private whistle(ctx: AudioContext, t: number, dur: number): void {
    // Steam whistle: a detuned minor chord with a slight pitch rise and breathy vibrato.
    const g = this.env(ctx, t, 0.08, dur, 0.25, 0.16);
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 6;
    const depth = ctx.createGain();
    depth.gain.value = 6;
    lfo.connect(depth);
    lfo.start(t);
    lfo.stop(t + dur + 0.4);
    for (const f of [370, 440, 554]) {
      const o = this.osc(ctx, 'triangle', f * 0.97, t, dur + 0.3, g);
      o.frequency.linearRampToValueAtTime(f, t + 0.15);
      depth.connect(o.frequency);
    }
  }

  dispose(): void {
    this.disposed = true;
    for (const clip of this.clips.values()) {
      clip.pause();
      clip.removeAttribute('src');
      clip.load();
    }
    this.clips.clear();
    void this.ctx?.close();
    this.ctx = null;
  }
}

/** Cue for a period change (`to` = null: match over). */
export function cueFor(from: { id: string; mode: string } | null, to: { id: string; mode: string } | null): Cue | null {
  if (!to) return 'end';
  if (!from && to.mode === 'auto') return 'start';
  if (to.mode === 'disabled') return 'autoEnd';
  if (to.id === 'endgame') return 'endgame';
  if (to.mode === 'teleop' && from && from.mode !== 'teleop') return 'teleop';
  return 'period';
}
