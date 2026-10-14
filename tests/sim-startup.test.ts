import { afterEach, expect, it, vi } from 'vitest';
import { discardSimulationWorker, warmSimulationWorker } from '../src/engine/sim/workerBoot';
import { WorkerSim, type WorkerSimInit } from '../src/engine/sim/workerSim';
import type { MatchWorld } from '../src/engine/core/matchWorld';

class FakeWorker {
  static instances: FakeWorker[] = [];
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onerror = null;
  messages: unknown[] = [];
  terminated = false;
  constructor() { FakeWorker.instances.push(this); }
  postMessage(m: unknown) { this.messages.push(m); }
  terminate() { this.terminated = true; }
}
function browser() {
  vi.stubGlobal('Worker', FakeWorker);
  vi.stubGlobal('OffscreenCanvas', class {});
  vi.stubGlobal('location', { search: '' });
  FakeWorker.instances = [];
}
afterEach(() => { discardSimulationWorker(); vi.unstubAllGlobals(); });

it('reuses the worker warmed during asset loading and waits for the view to start the countdown', async () => {
  browser();
  warmSimulationWorker(['sublime-1678']);
  const worker = FakeWorker.instances[0];
  expect(worker.messages).toEqual([{ t: 'warm', models: ['sublime-1678'] }]);
  const fail = vi.fn();
  const sim = new WorkerSim({ robots: [] } as unknown as MatchWorld, { speed: 1 } as WorkerSimInit, () => {}, fail);
  try {
    expect(FakeWorker.instances).toHaveLength(1);
    worker.onmessage!({ data: { t: 'ready', shapes: [] } });
    await sim.started;
    expect(worker.messages).not.toContainEqual({ t: 'start' });
    sim.start();
    expect(worker.messages.at(-1)).toEqual({ t: 'start' });
    expect(fail).not.toHaveBeenCalled();
  } finally { sim.dispose(); }
});

it('terminates unused warm workers when the player leaves or changes the match', () => {
  browser();
  warmSimulationWorker(['sublime-1678']);
  const first = FakeWorker.instances[0];
  warmSimulationWorker(['spectre-2910']);
  expect(first.terminated).toBe(true);
  const second = FakeWorker.instances[1];
  discardSimulationWorker();
  expect(second.terminated).toBe(true);
});

it('a newly released field piece appears on the same render boundary as the held mesh disappears', async () => {
  browser();
  const draw = vi.fn();
  const world = { robots: [], clock: { restore() {} }, pool: { count: 1, drawMirror: draw, flushMirror() {}, applyReplicaState() {} } } as unknown as MatchWorld;
  const sim = new WorkerSim(world, { speed: 1 } as WorkerSimInit, () => {}, () => {});
  const worker = FakeWorker.instances[0];
  try {
    worker.onmessage!({ data: { t: 'ready', shapes: [] } });
    await sim.started;
    const frame = (time: number, pieces: Float32Array) => ({ t: 'frame', time, st: 'running', cd: 0, boost: false, perf: {}, clock: {}, robots: [], hud: [], visuals: [], pieceStates: [], events: [], pieces });
    worker.onmessage!({ data: frame(0, new Float32Array(8)) });
    worker.onmessage!({ data: frame(.05, new Float32Array([1, 0, 2, 0, 0, 0, 0, 1])) });
    sim.draw(100);
    expect(draw).toHaveBeenLastCalledWith(0, null);
    worker.onmessage!({ data: frame(.1, new Float32Array([1, 0, 1.95, 0, 0, 0, 0, 1])) });
    sim.draw(1100);
    expect(draw.mock.calls.at(-1)![1]).toBeInstanceOf(Object);
    expect(draw.mock.calls.at(-1)![1].y).toBeCloseTo(1.95);
  } finally { sim.dispose(); }
});
