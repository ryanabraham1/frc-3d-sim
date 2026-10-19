/** Recorded shooter drum with original synthesized foam FUEL / hub impacts. */
export interface HubImpact {
  /** World coordinates; y is up. */
  x: number;
  y: number;
  z: number;
  speed: number;
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

export class GameplayAudio {
  /** Audition page readout: reports the real context / sample state rather than assuming playback succeeded. */
  get playbackState(): string {
    if (!this.ctx) return 'Audio locked — click Start audio';
    if (!this.shooterBuffer) return `${this.ctx.state} · loading drum recording`;
    return `${this.ctx.state} · recording ready · ${this.shooter ? 'drum spinning' : 'drum stopped'}`;
  }
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private shooterBuffer: AudioBuffer | null = null;
  private shooter: { source: AudioBufferSourceNode; gain: GainNode } | null = null;
  private wantsShooter = false;
  private noise: AudioBuffer | null = null;
  private enabled = false;
  private disposed = false;
  private lastImpact = -Infinity;
  private listener = { x: 0, z: 0 };
  private readonly unlock = () => {
    if (!this.enabled || this.disposed) return;
    try {
      if (!this.ctx) this.create();
      if (this.ctx?.state === 'suspended') void this.ctx.resume().catch(() => {});
    } catch { /* Audio unavailable: the match still runs. */ }
  };

  constructor() {
    if (typeof window !== 'undefined') {
      window.addEventListener('pointerdown', this.unlock);
      window.addEventListener('keydown', this.unlock);
    }
  }

  private create(): void {
    const AC = globalThis.AudioContext ?? (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = this.ctx = new AC();
    const master = this.master = ctx.createGain();
    master.gain.value = 0;
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -15;
    limiter.knee.value = 16;
    limiter.ratio.value = 5;
    master.connect(limiter).connect(ctx.destination);
    void fetch(`${import.meta.env.BASE_URL}audio/robot/shooter-drum.wav`)
      .then(response => { if (!response.ok) throw new Error('Shooter recording unavailable'); return response.arrayBuffer(); })
      .then(data => ctx.decodeAudioData(data))
      .then(buffer => { if (!this.disposed) { this.shooterBuffer = buffer; this.syncShooter(); } })
      .catch(() => { /* Stay silent if the recording is unavailable; no synthetic substitute. */ });
    this.noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const samples = this.noise.getChannelData(0);
    for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1;
  }

  /** Called by the view, so worker simulation and multiplayer use the same audio path. */
  update(active: boolean, muted: boolean, shoot: boolean, listener: { x: number; z: number }): void {
    this.enabled = active && !muted;
    this.wantsShooter = this.enabled && shoot;
    this.listener.x = listener.x;
    this.listener.z = listener.z;
    if (!this.ctx || !this.master) return;
    this.master.gain.setTargetAtTime(this.enabled ? 0.55 : 0, this.ctx.currentTime, 0.025);
    this.syncShooter();
  }

  /** Recorded mechanical texture, with a rising speed envelope and a natural coast on release. */
  private syncShooter(): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.shooterBuffer) return;
    const t = ctx.currentTime;
    if (this.wantsShooter && !this.shooter) {
      const source = ctx.createBufferSource();
      source.buffer = this.shooterBuffer;
      source.loop = true;
      source.loopStart = 0;
      source.loopEnd = this.shooterBuffer.duration;
      source.playbackRate.setValueAtTime(0.48, t);
      source.playbackRate.exponentialRampToValueAtTime(1, t + 0.85);
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.65, t + 0.4);
      source.connect(gain).connect(this.master);
      this.shooter = { source, gain };
      source.start(t, source.loopStart);
      source.onended = () => { source.disconnect(); gain.disconnect(); };
    } else if (!this.wantsShooter && this.shooter) {
      const { source, gain } = this.shooter;
      this.shooter = null;
      const release = this.enabled ? 0.65 : 0.04;
      source.playbackRate.cancelAndHoldAtTime(t);
      source.playbackRate.exponentialRampToValueAtTime(0.25, t + release);
      gain.gain.cancelAndHoldAtTime(t);
      gain.gain.linearRampToValueAtTime(0, t + release);
      source.stop(t + release + 0.02);
    }
  }

  hubImpact(hit: HubImpact): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.noise || !this.enabled || ctx.state !== 'running') return;
    const t = ctx.currentTime;
    // Dense streams blend naturally; bound the number of transient voices during six-robot volleys.
    if (t - this.lastImpact < 0.025) return;
    this.lastImpact = t;
    const distance = Math.hypot(hit.x - this.listener.x, hit.z - this.listener.z);
    const level = (0.11 + clamp01(hit.speed / 9) * 0.2) / (1 + distance * 0.16);
    const pan = ctx.createStereoPanner();
    pan.pan.value = Math.max(-0.7, Math.min(0.7, (hit.x - this.listener.x) / 12));
    pan.connect(this.master);
    let remaining = 4;
    const cleanup = () => { if (--remaining === 0) pan.disconnect(); };
    // Foam contact: a rounded low thud, then a brief band-limited scrape.
    const noise = ctx.createBufferSource();
    noise.buffer = this.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 950 + Math.random() * 500;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(level, t + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.085);
    noise.connect(filter).connect(g).connect(pan);
    noise.start(t, Math.random() * 0.5, 0.1);
    noise.onended = () => { noise.disconnect(); filter.disconnect(); g.disconnect(); cleanup(); };
    const variation = 0.9 + Math.random() * 0.2;
    // A hollow plastic/panel resonance with a quiet, short metal rattle; no scoring chime.
    for (const [f, amp, decay] of [[155, 0.8, 0.12], [430, 0.22, 0.085], [1320, 0.06, 0.045]]) {
      const o = ctx.createOscillator();
      o.frequency.setValueAtTime(f * variation, t);
      o.frequency.exponentialRampToValueAtTime(f * variation * 0.8, t + decay);
      const env = ctx.createGain();
      env.gain.setValueAtTime(0.0001, t);
      env.gain.exponentialRampToValueAtTime(level * amp, t + 0.002);
      env.gain.exponentialRampToValueAtTime(0.0001, t + decay);
      o.connect(env).connect(pan);
      o.start(t);
      o.stop(t + decay + 0.01);
      o.onended = () => { o.disconnect(); env.disconnect(); cleanup(); };
    }
  }

  dispose(): void {
    this.disposed = true;
    this.enabled = false;
    if (typeof window !== 'undefined') {
      window.removeEventListener('pointerdown', this.unlock);
      window.removeEventListener('keydown', this.unlock);
    }
    this.shooter?.source.stop();
    this.shooter = null;
    void this.ctx?.close().catch(() => {});
    this.ctx = null;
  }
}
