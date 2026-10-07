import type { AiSkill, GameSettings, SeasonDefinition } from '../core/season';
import { slotId, type MatchSetup } from '../net/protocol';
import { cloneConfig, footprint } from '../robot/config';
import { checkStartSpot, fieldToSpot, footprintPoly, polysOverlap, spotToField } from '../startPose';
import { aiOrders } from './team';
import { aiRobotChoices } from './robots';

/**
 * AI robots drive the same robots players get: no skill-based speed or accuracy edge. Skill is how they play
 * (pace, planning, defense on the driver), not better hardware. Kept as tables so tests and benchmarks share them.
 */
export const AI_SPEED: Record<AiSkill, number> = { normal: 1, hard: 1, einstein: 1 };
export const AI_AIM: Record<AiSkill, number> = { normal: 1, hard: 1, einstein: 1 };

/** Fill unoccupied driver stations without changing any human robot or network peer. */
export function fillBotStations(setup: MatchSetup, s: GameSettings, season: SeasonDefinition): void {
  if (s.aiOpponents !== false && season.createBotPilot) {
    for (const alliance of ['blue', 'red'] as const) {
      for (let station = 1; station <= 3; station++) {
        if (setup.robots.some((r) => r.slot === slotId(alliance, station))) continue;
        const orders = aiOrders(s, alliance);
        const difficulty = orders.skill;
        // A real team's robot or a generic archetype: the player's pick for that station, else the season's lineup.
        const choices = aiRobotChoices(season);
        const wanted = orders.archetypes[station];
        const archetype = choices.find((p) => p.id === wanted) ?? choices.find((p) => p.id === season.botArchetype?.(difficulty, station, orders.roles[station], alliance === s.alliance));
        const config = cloneConfig(archetype?.config ?? season.botRobotConfig?.(difficulty, orders.roles[station]) ?? season.robotDefaults);
        config.maxSpeed *= AI_SPEED[difficulty];
        config.launcher.spread *= AI_AIM[difficulty];
        config.launcher.speedError *= AI_AIM[difficulty];
        // Real robots keep their team number unless it's already on the field.
        const real = archetype?.team;
        config.teamNumber = real && !setup.robots.some((o) => o.config.teamNumber === real) ? real : 9000 + setup.robots.length;
        const dims = { length: season.fieldLength, width: season.fieldWidth, symmetry: season.mapSymmetry };
        const botFootprint = footprint(config);
        let start = season.startPose(alliance, station);
        const overlaps = (pose: typeof start) => setup.robots.some((other) => {
          const otherFootprint = footprint(other.config);
          return polysOverlap(footprintPoly(pose, botFootprint.length + 0.1, botFootprint.width + 0.1),
            footprintPoly(other.start ?? season.startPose(other.alliance, other.station), otherFootprint.length, otherFootprint.width));
        });
        if (overlaps(start) && season.startArea) {
          const spot = fieldToSpot(dims, alliance, start);
          for (let y = season.startArea.rect.y0; y <= season.startArea.rect.y1; y += 0.15) {
            const candidate = { ...spot, y };
            const pose = spotToField(dims, alliance, candidate);
            if (checkStartSpot(season.startArea, candidate, botFootprint.length, botFootprint.width).ok && !overlaps(pose)) { start = pose; break; }
          }
        }
        setup.robots.push({
          id: setup.robots.length, slot: slotId(alliance, station), alliance, station, config,
          autoRoutine: season.botAutoRoutine?.(station, config) ?? season.autoRoutines[0]?.id ?? 'none', manualAuto: false,
          bot: true, start, peerId: '', name: `AI ${alliance === 'blue' ? 'Blue' : 'Red'} ${station}`,
        });
      }
    }
    // AUTO routines are planned per alliance once every robot is known: who climbs depends on who CAN climb.
    if (season.botAutoRoutine) {
      for (const rs of setup.robots) {
        if (!rs.bot) continue;
        const bots = setup.robots.filter((o) => o.alliance === rs.alliance && o.bot).map((o) => ({ station: o.station, config: o.config }));
        rs.autoRoutine = season.botAutoRoutine(rs.station, rs.config, bots);
      }
    }
  }
}
