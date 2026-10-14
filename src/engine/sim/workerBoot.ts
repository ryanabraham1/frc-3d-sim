/** Start the worker's code/WASM/CAD loads alongside the page's asset loads. */
let prepared: Worker | null = null;

export function discardSimulationWorker(): void {
  prepared?.terminate();
  prepared = null;
}

export function warmSimulationWorker(models: readonly (string | undefined)[]): void {
  if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined' || new URLSearchParams(location.search).get('worker') === '0') return;
  discardSimulationWorker();
  try {
    prepared = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    prepared.postMessage({ t: 'warm', models, ...(new URLSearchParams(location.search).get('cadDetail') === 'full' ? { cadDetail: 'full' } : {}) });
  } catch {
    prepared = null;
  }
}

export function takeSimulationWorker(): Worker {
  const worker = prepared ?? new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  prepared = null;
  return worker;
}
