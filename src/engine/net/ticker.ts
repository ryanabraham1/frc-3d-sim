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
      this.url = URL.createObjectURL(new Blob([`setInterval(() => postMessage(0), ${period});`], { type: 'text/javascript' }));
      this.worker = new Worker(this.url);
      this.worker.onmessage = () => this.fn(performance.now());
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
