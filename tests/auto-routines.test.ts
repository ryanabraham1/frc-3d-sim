import { expect, it } from 'vitest';
import { defaultSettings } from '../src/app/menu';
import { localSetup } from '../src/engine/core/game';
import { SEASONS } from '../src/seasons';

const season = SEASONS.find((s) => s.id === '2026-rebuilt')!;
const CLIMB = new Set(['depot-climb', 'shoot-climb']);

it('2026 AI alliances give the AUTO climb only to robots that can climb, at most two each', () => {
  for (const skill of ['normal', 'hard', 'einstein'] as const) {
    const setup = localSetup({ ...defaultSettings(season), aiDifficulty: skill, aiAlly: { skill } }, season);
    for (const alliance of ['blue', 'red'] as const) {
      const bots = setup.robots.filter((r) => r.alliance === alliance && r.id !== 0);
      for (const b of bots) {
        if (b.config.climber.maxLevel === 0) expect(CLIMB.has(b.autoRoutine!), `${skill} ${alliance}${b.station} ${b.config.model}`).toBe(false);
      }
      expect(bots.filter((b) => CLIMB.has(b.autoRoutine!)).length).toBeLessThanOrEqual(2);
      // A climber is never left collecting while a climb slot is free.
      const climbers = bots.filter((b) => b.config.climber.maxLevel > 0);
      expect(bots.filter((b) => CLIMB.has(b.autoRoutine!)).length).toBe(Math.min(2, climbers.length));
    }
  }
});
