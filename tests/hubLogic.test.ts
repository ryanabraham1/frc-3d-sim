import { describe, expect, it } from 'vitest';
import {
  decideFirstInactive,
  HubGrace,
  hubActive,
  hubLight,
  secondsActiveRemaining,
  secondsUntilActive,
} from '../src/seasons/2026-rebuilt/hubLogic';
import { TIMELINE } from '../src/seasons/2026-rebuilt/config';

describe('HUB status (Table 6-3)', () => {
  it('both hubs active in AUTO, TRANSITION and END GAME', () => {
    for (const p of ['auto', 'transition', 'endgame']) {
      expect(hubActive(p, 'red', 'red')).toBe(true);
      expect(hubActive(p, 'blue', 'red')).toBe(true);
    }
  });

  it('RED scored more in AUTO → RED inactive in SHIFT 1 & 3, active in 2 & 4', () => {
    const f = decideFirstInactive(30, 12, 0.9);
    expect(f).toBe('red');
    const table = ['shift1', 'shift2', 'shift3', 'shift4'].map((s) => [hubActive(s, 'red', f), hubActive(s, 'blue', f)]);
    expect(table).toEqual([
      [false, true],
      [true, false],
      [false, true],
      [true, false],
    ]);
  });

  it('BLUE scored more → mirrored table', () => {
    const f = decideFirstInactive(3, 4, 0.1);
    expect(f).toBe('blue');
    expect(hubActive('shift1', 'red', f)).toBe(true);
    expect(hubActive('shift1', 'blue', f)).toBe(false);
    expect(hubActive('shift2', 'blue', f)).toBe(true);
  });

  it('tie → FMS random pick', () => {
    expect(decideFirstInactive(5, 5, 0.2)).toBe('red');
    expect(decideFirstInactive(5, 5, 0.8)).toBe('blue');
  });

  it('hubs are not active during the disabled assessment windows', () => {
    expect(hubActive('auto-pause', 'red', null)).toBe(false);
    expect(hubActive('post', 'blue', 'red')).toBe(false);
  });
});

describe('3 s grace window (6.5)', () => {
  it('fuel counts up to 3 s after deactivation, not after', () => {
    const g = new HubGrace();
    // RED active in shift2 (first inactive = red), deactivates at t=100 when shift3 begins.
    g.update(99.99, 'shift2', 'red');
    expect(g.counts('red', 101, 'shift3', 'red')).toBe(true);
    expect(g.counts('red', 102.99, 'shift3', 'red')).toBe(true);
    expect(g.counts('red', 103.2, 'shift3', 'red')).toBe(false);
  });

  it('fuel landing during the post-AUTO assessment still counts', () => {
    const g = new HubGrace();
    g.update(20, 'auto', null);
    expect(g.counts('blue', 22, 'auto-pause', null)).toBe(true);
  });
});

describe('HUB lights (Table 5-3)', () => {
  it('pulses a warning in the last 3 s before deactivation', () => {
    expect(hubLight('shift2', 2.5, 'red', 'red', 'shift3')).toBe('warning');
    expect(hubLight('shift2', 5, 'red', 'red', 'shift3')).toBe('active');
  });
  it('chases during TRANSITION on the hub that goes inactive in SHIFT 1', () => {
    expect(hubLight('transition', 6, 'blue', 'blue', 'shift1')).toBe('chase');
    expect(hubLight('transition', 6, 'red', 'blue', 'shift1')).toBe('active');
  });
  it('off when inactive, white after the match', () => {
    expect(hubLight('shift1', 10, 'blue', 'blue', 'shift2')).toBe('off');
    expect(hubLight('post', 2, 'blue', 'blue', null)).toBe('post');
  });
  it('warns before the end of the match', () => {
    expect(hubLight('endgame', 2, 'red', 'blue', 'post')).toBe('warning');
  });
});

describe('planning helpers', () => {
  it('seconds until active / active remaining', () => {
    const idx = TIMELINE.findIndex((p) => p.id === 'shift1');
    expect(secondsUntilActive(TIMELINE, idx, 10, 'red', 'red')).toBe(10);
    expect(secondsActiveRemaining(TIMELINE, idx, 10, 'blue', 'red')).toBe(10);
    const s4 = TIMELINE.findIndex((p) => p.id === 'shift4');
    // Red inactive first → red is active in SHIFT 4 and stays active through END GAME.
    expect(secondsActiveRemaining(TIMELINE, s4, 5, 'red', 'red')).toBe(5 + 30);
  });
});
