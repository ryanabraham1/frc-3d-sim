import type { Alliance } from '@engine/coords';
import type { MatchResults } from '@engine/core/season';
import type { Scoreboard } from '@engine/match/scoreboard';
import { CORAL_AUTO, CORAL_TELEOP } from './constants';

export const coralPoints = (level: number, auto: boolean) => (auto ? CORAL_AUTO : CORAL_TELEOP)[level];
export function reefscapeResults(score: Scoreboard, robotCounts: Record<Alliance, number>, forcedBarge: Record<Alliance, boolean> = { blue: false, red: false }): MatchResults {
  const winner = score.winner();
  const coop = score.counter('blue', 'processor') >= 2 && score.counter('red', 'processor') >= 2;
  const rp = { blue: 0, red: 0 };
  const rpDetail: Record<Alliance, string[]> = { blue: [], red: [] };
  for (const a of ['blue', 'red'] as const) {
    const bonuses: [boolean, string][] = [
      [robotCounts[a] > 0 && score.counter(a, 'leave') === robotCounts[a] && score.counter(a, 'autoCoral') > 0, 'AUTO'],
      [[1, 2, 3, 4].filter((l) => score.counter(a, `coralL${l}`) >= 7).length >= (coop ? 3 : 4), 'CORAL'],
      [score.category(a, 'barge') >= 16 || forcedBarge[a], 'BARGE'],
    ];
    for (const [earned, label] of bonuses) if (earned) { rp[a]++; rpDetail[a].push(label); }
    if (winner === a) { rp[a] += 3; rpDetail[a].push('WIN +3'); }
    else if (winner === 'tie') { rp[a]++; rpDetail[a].push('TIE +1'); }
  }
  const row = (label: string, category: string) => ({ label, blue: score.category('blue', category), red: score.category('red', category) });
  return {
    winner, rp, rpDetail,
    rows: [row('AUTO leave', 'leave'), row('AUTO coral', 'autoCoral'), row('TELEOP coral', 'teleopCoral'), row('Algae · processor', 'processor'), row('Algae · net', 'net'), row('Park / cages', 'barge'),
      { label: 'Opponent fouls', blue: score.foulPointsFor('blue'), red: score.foulPointsFor('red') },
      { label: 'TOTAL', blue: score.total('blue'), red: score.total('red'), emphasis: true },
      { label: 'Coopertition points', blue: coop ? 1 : 0, red: coop ? 1 : 0 },
      { label: 'Ranking points', blue: rp.blue, red: rp.red, emphasis: true }],
  };
}
