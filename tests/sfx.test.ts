import { expect, it } from 'vitest';
import { cueFor } from '../src/engine/audio/sfx';
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
