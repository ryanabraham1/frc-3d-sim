import { describe, expect, it } from 'vitest';
import { autoTowerPoints, rankingPoints, teleopTowerPoints } from '../src/seasons/2026-rebuilt/scoring';
import { Scoreboard } from '../src/engine/match/scoreboard';

describe('TOWER points (Table 6-4)', () => {
  it('AUTO: 15 per robot at L1, max 2 robots', () => {
    expect(autoTowerPoints([1])).toBe(15);
    expect(autoTowerPoints([1, 1, 1])).toBe(30);
    expect(autoTowerPoints([0, 0])).toBe(0);
  });
  it('TELEOP: 10 / 20 / 30 per robot', () => {
    expect(teleopTowerPoints([1, 2, 3])).toBe(60);
    expect(teleopTowerPoints([0, 3])).toBe(30);
  });
});

describe('Ranking points (Tables 6-4, 6-5)', () => {
  it('thresholds at regional/district events', () => {
    const r = rankingPoints({ fuelActive: 100, towerPoints: 50, ownScore: 200, oppScore: 150 });
    expect(r.energized).toBe(true);
    expect(r.supercharged).toBe(false);
    expect(r.traversal).toBe(true);
    expect(r.total).toBe(3 + 1 + 1);
  });
  it('supercharged implies energized; tie gives 1', () => {
    const r = rankingPoints({ fuelActive: 360, towerPoints: 49, ownScore: 10, oppScore: 10 });
    expect(r.energized && r.supercharged).toBe(true);
    expect(r.traversal).toBe(false);
    expect(r.total).toBe(1 + 2);
  });
  it('championship thresholds are higher', () => {
    const r = rankingPoints({ fuelActive: 300, towerPoints: 0, ownScore: 0, oppScore: 1 }, 'cmp');
    expect(r.energized).toBe(false);
    expect(r.total).toBe(0);
  });
});

describe('Scoreboard fouls credit the opponent', () => {
  it('MINOR 5 / MAJOR 15', () => {
    const s = new Scoreboard({ minor: 5, major: 15 });
    s.add('red', 'fuelTeleop', 10);
    s.foul({ t: 1, alliance: 'red', kind: 'major', rule: 'G407', robotId: 0 });
    s.foul({ t: 2, alliance: 'red', kind: 'minor', rule: 'G405', robotId: 0 });
    expect(s.total('red')).toBe(10);
    expect(s.total('blue')).toBe(20);
    expect(s.winner()).toBe('blue');
  });
});
