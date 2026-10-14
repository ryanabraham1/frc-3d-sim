import { expect, it } from 'vitest';
import { FrameHealth } from '../src/engine/render/frameHealth';

it('shows isolated stalls even when almost every frame is fast, and ages them out', () => {
  const f = new FrameHealth();
  for (let i = 0; i < 359; i++) f.record(16.67);
  f.record(450);
  expect(f.stats()).toEqual({ p95FrameMs: 17, worstFrameMs: 450, longFrames: 1 });
  for (let i = 0; i < 360; i++) f.record(16.67);
  expect(f.stats()).toEqual({ p95FrameMs: 17, worstFrameMs: 17, longFrames: 0 });
});
