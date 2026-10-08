import type { Alliance } from '@engine/coords';
import type { MatchResults } from '@engine/core/season';
import type { Scoreboard } from '@engine/match/scoreboard';
import { PARK_POINTS, TOWER_POINTS } from './constants';
import type { DistrictOwnership } from './ownership';

export interface AggregateScore {
  autoOwnedBubbles: number; autoNeutralBubbles: number; autoFullDistricts: number;
  teleopOwnedBubbles: number; teleopNeutralBubbles: number; partialDistricts: number; fullDistricts: number;
  parks: number; lowClimbs: number; mediumClimbs: number; highClimbs: number;
}
/** Independent parity oracle for supplied calculator Sheet1 E14/J14/O14/J2. Excludes fouls and RP. */
export function calculatorScore(s: AggregateScore) {
  const auto = s.autoOwnedBubbles * 6 + s.autoNeutralBubbles * 2 + s.autoFullDistricts * 10;
  const teleop = s.teleopOwnedBubbles * 3 + s.teleopNeutralBubbles + s.partialDistricts * 10 + s.fullDistricts * 25;
  const endgame = s.parks * 5 + s.lowClimbs * 20 + s.mediumClimbs * 35 + s.highClimbs * 50;
  return { auto, teleop, endgame, total: auto + teleop + endgame };
}

export function towerPoints(level: number, parked: boolean, disqualified = false, forcedHigh = false): number {
  if (disqualified) return 0;
  if (forcedHigh) return 50;
  return TOWER_POINTS[Math.max(0, Math.min(3, Math.floor(level)))] || (parked ? PARK_POINTS : 0);
}

export function heroHeistResults(score: Scoreboard, ownership: DistrictOwnership, participants: Record<Alliance, number>): MatchResults {
  const winner = score.winner();
  const rp = { red: 0, blue: 0 };
  const rpDetail: Record<Alliance, string[]> = { red: [], blue: [] };
  for (const a of ['red', 'blue'] as const) {
    const bonuses: [boolean, string][] = [
      [participants[a] > 0 && score.counter(a, 'autoLeave') === participants[a], 'AUTO EXIT'],
      [ownership.partialHistory[a].size >= 8 || ownership.fullHistory[a].size >= 5, 'DISTRICTS'],
      [score.category(a, 'tower') >= 60, 'TOWER'],
    ];
    for (const [earned, name] of bonuses) if (earned) { rp[a]++; rpDetail[a].push(name); }
    if (winner === a) { rp[a] += 3; rpDetail[a].push('WIN +3'); }
    else if (winner === 'tie') { rp[a]++; rpDetail[a].push('TIE +1'); }
  }
  const row = (label: string, category: string) => ({ label, cats: [category], red: score.category('red', category), blue: score.category('blue', category) });
  return { winner, rp, rpDetail, rows: [row('AUTO bubbles', 'autoBubbles'), row('AUTO full ownership bonus', 'autoFull'), row('TELEOP bubbles', 'teleopBubbles'), row('Current district ownership', 'ownership'), row('Tower', 'tower'),
    { label: 'Opponent fouls', red: score.foulPointsFor('red'), blue: score.foulPointsFor('blue') },
    { label: 'TOTAL', red: score.total('red'), blue: score.total('blue'), emphasis: true },
    { label: 'Ranking points', ...rp, emphasis: true }] };
}
