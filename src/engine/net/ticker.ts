/**
 * Background-safe ticker. requestAnimationFrame stops when a tab is hidden, and main-thread timers are
 * throttled to ~1 Hz — which would freeze a multiplayer match whenever the host alt-tabs. Timers inside a
 * dedicated Worker are not throttled that way, so the worker pings the main thread at `hz`.
 */
export class Ticker {
  private worker: Worker | null = null;
  private url = '';
  private fallback = 0;

  constructor(
    private readonly fn: (now: number) => void,
    private readonly hz = 120,
  ) {}

  start(): void {
    this.stop();
    const period = 1000 / this.hz;
    try {
      // At most one pending tick. A stalled main thread must not replay hundreds of obsolete timer messages.
      this.url = URL.createObjectURL(new Blob([`
        let pending = false;
        onmessage = () => { pending = false; };
        setInterval(() => {
          if (!pending) { pending = true; postMessage(0); }
        }, ${period});
      `], { type: 'text/javascript' }));
      this.worker = new Worker(this.url);
      const worker = this.worker;
      worker.onmessage = () => {
        if (this.worker !== worker) return;
        try { this.fn(performance.now()); }
        finally { if (this.worker === worker) worker.postMessage(0); }
      };
    } catch {
      // Workers unavailable (CSP etc.): plain interval — works while the tab is visible.
      this.fallback = window.setInterval(() => this.fn(performance.now()), period);
    }
  }

  stop(): void {
    this.worker?.terminate();
    this.worker = null;
    if (this.url) URL.revokeObjectURL(this.url);
    this.url = '';
    if (this.fallback) clearInterval(this.fallback);
    this.fallback = 0;
  }
}
