import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { HeadlessSim } from '../src/engine/testing/headless';
import { IDLE_COMMAND } from '../src/engine/robot/robot';
import { cloneConfig } from '../src/engine/robot/config';
import { Scoreboard } from '../src/engine/match/scoreboard';
import { buildPlayerResults } from '../src/engine/match/playerResults';
import { Hud } from '../src/engine/hud/hud';
import type { MatchResults } from '../src/engine/core/season';
import { crescendo2024 as season } from '../src/seasons/2024-crescendo';
import * as C from '../src/seasons/2024-crescendo/constants';

const FOULS = { minor: 2, major: 5 };

describe('per-player results', () => {
  it('credits robots by category and reports what no robot earned', () => {
    const s = new Scoreboard(FOULS);
    s.add('red', 'speaker', 2, 1, 0);
    s.add('red', 'speaker', 2, 2, 0);
    s.add('red', 'amp', 1, 3, 1);
    s.add('red', 'speaker', 2, 4); // nobody credited
    s.tally(0, 'shots', 4);
    s.tally(0, 'scored', 2);
    s.foul({ t: 5, alliance: 'red', kind: 'major', rule: 'G404', robotId: 1 });
    const res: MatchResults = {
      winner: 'red', rp: { red: 0, blue: 0 }, rpDetail: { red: [], blue: [] },
      rows: [{ label: 'speaker', cats: ['speaker'], red: 6, blue: 0 }, { label: 'amp', cats: ['amp'], red: 1, blue: 0 }, { label: 'TOTAL', red: 7, blue: 0 }],
    };
    const { players, uncredited } = buildPlayerResults(res, s, [
      { id: 0, alliance: 'red', name: 'Ann', team: 111 },
      { id: 1, alliance: 'red', name: 'Bo', team: 222 },
    ], FOULS);
    expect(players[0].total).toBe(4);
    expect(players[0].rows).toEqual([{ label: 'speaker', value: 4 }, { label: 'amp', value: 0 }]);
    expect(players[0].stats).toContainEqual({ label: 'Accuracy', value: '50%' });
    expect(players[1].total).toBe(1);
    expect(players[1].stats).toContainEqual({ label: 'Fouls (minor / major)', value: '0 / 1' });
    expect(players[1].stats).toContainEqual({ label: 'Foul points given', value: 5 });
    expect(uncredited).toEqual({ red: 2, blue: 0 });
    // The modal renders both players and the uncredited note.
    const html = Hud.resultsHtml({ ...res, players, uncredited }, { red: 7, blue: 0 });
    expect(html).toContain('Player breakdown');
    expect(html).toContain('Ann');
    expect(html).toContain('2 pts not credited');
  });

  it('per-robot credit survives a multiplayer snapshot', () => {
    const a = new Scoreboard();
    a.add('blue', 'speaker', 2, 0, 3);
    a.tally(3, 'shots', 5);
    const b = new Scoreboard();
    b.restore(JSON.parse(JSON.stringify(a.snapshot())));
    expect(b.robotCategory(3, 'speaker')).toBe(2);
    expect(b.robotCounter(3, 'shots')).toBe(5);
    b.restore(new Scoreboard().snapshot());
    expect(b.robotCategory(3, 'speaker')).toBe(0);
  });
});

describe('player credit in a real match', () => {
  let sim: HeadlessSim | undefined;
  beforeAll(async () => {
    await RAPIER.init();
  });
  afterEach(() => sim?.dispose());

  it('a SPEAKER shot is credited to the robot that took it', () => {
    const spot = season.testing!.scoringSpots('blue')[5];
    sim = new HeadlessSim(season, RAPIER, { robot: cloneConfig(season.robotDefaults), alliance: 'blue', pose: spot });
    sim.rules.onPeriodChange(sim.ctx.clock.start());
    sim.pool.hold(C.FIELD_NOTES, sim.robot.id);
    sim.robot.held.push(C.FIELD_NOTES);
    for (let n = 0; n < Math.round(2.5 / sim.physics.dt); n++) {
      for (const ch of sim.ctx.clock.advance(sim.physics.dt)) sim.rules.onPeriodChange(ch);
      sim.step({ ...IDLE_COMMAND, shoot: true });
    }
    const sc = sim.ctx.score;
    expect(sc.category('blue', 'autoSpeaker')).toBe(5);
    expect(sc.robotCategory(sim.robot.id, 'autoSpeaker')).toBe(5);
    expect(sc.robotCounter(sim.robot.id, 'scored')).toBe(1);
    expect(sc.robotCounter(sim.robot.id, 'shots')).toBeGreaterThanOrEqual(1);
    const res = sim.rules.results();
    const { players, uncredited } = buildPlayerResults(res, sc, [{ id: sim.robot.id, alliance: 'blue', name: 'You', team: 1 }], season.foulValues);
    expect(players[0].total).toBe(5);
    expect(uncredited.blue).toBe(0);
  });
});
