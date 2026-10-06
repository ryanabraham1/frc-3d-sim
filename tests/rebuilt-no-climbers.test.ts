import { expect, it } from 'vitest';
import { SEASONS } from '../src/seasons';
import { cloneConfig } from '../src/engine/robot/config';

const season = SEASONS.find(s => s.year === 2026)!;
it('every 2026 stock robot starts without a climber, including after normalization', () => {
  const configs = [season.robotDefaults, ...season.robotPresets!.map(p => p.config), ...season.teamRobots!.map(t => t.config)];
  for (const config of configs) {
    expect(config.climber.maxLevel, config.model).toBe(0);
    expect(season.normalizeRobotConfig!(cloneConfig(config)).climber.maxLevel, config.model).toBe(0);
  }
});
it('stock robots receive FUEL autos rather than tower climb autos', () => {
  for (const team of season.teamRobots!) {
    for (const station of [1, 2, 3]) {
      const routine = season.botAutoRoutine?.(station, team.config);
      expect(routine).not.toMatch(/climb/);
    }
  }
});
