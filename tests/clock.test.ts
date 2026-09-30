import { describe, expect, it } from 'vitest';
import { MatchClock } from '../src/engine/match/clock';
import { TIMELINE } from '../src/seasons/2026-rebuilt/config';

describe('MatchClock (REBUILT timeline, Table 6-2)', () => {
  it('has AUTO 20 s + TELEOP 2:20 of driving', () => {
    const c = new MatchClock(TIMELINE);
    expect(TIMELINE.filter((p) => p.mode === 'auto').reduce((s, p) => s + p.duration, 0)).toBe(20);
    expect(TIMELINE.filter((p) => p.mode === 'teleop').reduce((s, p) => s + p.duration, 0)).toBe(140);
    expect(c.totalDuration).toBe(20 + 3 + 140 + 3);
  });

  it('shows one continuous TELEOP countdown across transition/shifts/end game', () => {
    const c = new MatchClock(TIMELINE);
    c.start();
    expect(c.displayTime).toBe(20);
    c.advance(23); // AUTO + 3 s assessment
    expect(c.current.id).toBe('transition');
    expect(c.displayTime).toBeCloseTo(140);
    c.advance(10);
    expect(c.current.id).toBe('shift1');
    expect(c.displayTime).toBeCloseTo(130); // 2:10
    c.advance(25 * 4);
    expect(c.current.id).toBe('endgame');
    expect(c.displayTime).toBeCloseTo(30);
  });

  it('reports every transition even with a large dt, and finishes', () => {
    const c = new MatchClock(TIMELINE);
    c.start();
    const changes = c.advance(1000);
    expect(changes.map((x) => x.to?.id ?? null)).toEqual(['auto-pause', 'transition', 'shift1', 'shift2', 'shift3', 'shift4', 'endgame', 'post', null]);
    expect(c.finished).toBe(true);
    expect(c.mode).toBe('disabled');
  });

  it('timeUntil / remainingInMode', () => {
    const c = new MatchClock(TIMELINE);
    c.start();
    c.advance(5);
    expect(c.timeUntil('transition')).toBeCloseTo(18);
    expect(c.remainingInMode('teleop')).toBe(140);
    expect(c.mode).toBe('auto');
  });
});
