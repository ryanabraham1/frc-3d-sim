import { expect, it, vi } from 'vitest';
import { cueFor, Sfx } from '../src/engine/audio/sfx';
import { SEASONS } from '../src/seasons';

it('every season timeline maps to the FRC field cues: charge, AUTO buzzer, TELEOP bells, END GAME whistle, end buzzer', () => {
  for (const s of SEASONS) {
    const t = s.timeline;
    const cues = [cueFor(null, t[0]), ...t.slice(1).map((p, i) => cueFor(t[i], p)), cueFor(t[t.length - 1], null)];
    expect(cues[0]).toBe('start');
    expect(cues).toContain('autoEnd');
    expect(cues).toContain('teleop');
    expect(cues.filter((c) => c === 'teleop')).toHaveLength(1);
    expect(cues).toContain('endgame');
    expect(cues[cues.length - 1]).toBe('end');
  }
});


it('plays bundled field clips, preserves mute, and stops audio on disposal', async () => {
  const clips: { src: string; muted: boolean; currentTime: number; play: ReturnType<typeof vi.fn>; pause: ReturnType<typeof vi.fn> }[] = [];
  vi.stubGlobal('Audio', class {
    muted = false;
    currentTime = 0;
    play = vi.fn().mockResolvedValue(undefined);
    pause = vi.fn();
    removeAttribute = vi.fn();
    load = vi.fn();
    constructor(public src: string) { clips.push(this); }
  });
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: vi.fn() });
  try {
    const sfx = new Sfx();
    const expected = ['start', 'end', 'resume', 'shift_change', 'warning', 'end'];
    const cues = ['start', 'autoEnd', 'teleop', 'period', 'endgame', 'end'] as const;
    cues.forEach((cue, i) => {
      sfx.play(cue);
      expect(clips[i].src).toMatch(new RegExp(`/audio/frc/${expected[i]}\\.wav$`));
      expect(clips[i].play).toHaveBeenCalledOnce();
    });
    sfx.muted = true;
    expect(clips.every((clip) => clip.muted)).toBe(true);
    sfx.play('start');
    expect(clips[0].play).toHaveBeenCalledOnce();
    sfx.muted = false;
    sfx.dispose();
    expect(clips.every((clip) => clip.pause.mock.calls.length > 0)).toBe(true);
    sfx.play('start');
    expect(clips[0].play).toHaveBeenCalledOnce();
  } finally {
    vi.unstubAllGlobals();
  }
});
