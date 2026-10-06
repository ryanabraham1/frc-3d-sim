import { runInNewContext } from 'node:vm';
import { afterEach, expect, it, vi } from 'vitest';
import { Ticker } from '../src/engine/net/ticker';

afterEach(() => vi.unstubAllGlobals());

it('keeps only one outstanding worker tick through a main-thread stall and acknowledges completion', async () => {
  let source: Blob | undefined;
  const postMessage = vi.fn();
  class WorkerStub {
    onmessage: (() => void) | null = null;
    postMessage = postMessage;
    terminate = vi.fn();
  }
  let worker: WorkerStub;
  vi.stubGlobal('Worker', class extends WorkerStub {
    constructor() { super(); worker = this; }
  });
  vi.stubGlobal('URL', {
    createObjectURL(blob: Blob) { source = blob; return 'blob:test'; },
    revokeObjectURL() {},
  });
  const fn = vi.fn();
  const ticker = new Ticker(fn);
  ticker.start();
  let interval: () => void = () => {};
  const emit = vi.fn();
  const context = {
    onmessage: () => {},
    postMessage: emit,
    setInterval(callback: () => void) { interval = callback; },
  };
  runInNewContext(await source!.text(), context);
  for (let i = 0; i < 500; i++) interval();
  expect(emit).toHaveBeenCalledTimes(1);
  worker!.onmessage!();
  expect(fn).toHaveBeenCalledTimes(1);
  expect(postMessage).toHaveBeenCalledTimes(1);
  context.onmessage();
  interval();
  expect(emit).toHaveBeenCalledTimes(2);
  ticker.stop();
  worker!.onmessage!();
  expect(fn).toHaveBeenCalledTimes(1);
});
