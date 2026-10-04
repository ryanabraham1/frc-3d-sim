import { aroundCircles, CycleBot } from '@engine/ai/cycleBot';
import { dist } from '@engine/ai/steering';
import type { SeasonContext } from '@engine/core/season';
import type { Robot } from '@engine/robot/robot';
import { wrapAngle } from '@engine/units';
import * as C from './constants';
import type { ReefscapeRules } from './rules';

const faceClaims = new WeakMap<SeasonContext, Map<number, { alliance: string; face: number; until: number }>>();

export function createReefscapeBot(ctx: SeasonContext, rules: ReefscapeRules, r: Robot): CycleBot {
  if (!faceClaims.has(ctx)) faceClaims.set(ctx, new Map());
  const claims = faceClaims.get(ctx)!;
  const st = C.stations(r.alliance)[r.station % 2];
  const dockDistance = r.footprint.length / 2 + 0.02;
  const supply = { x: st.x + Math.cos(st.yaw) * dockDistance, y: st.y + Math.sin(st.yaw) * dockDistance, yaw: st.yaw };
  const reef = { ...C.reefCenter(r.alliance), r: C.REEF_APOTHEM / Math.cos(Math.PI / 6) + Math.max(r.footprint.length, r.footprint.width) / 2 + 0.1 };
  const bot: CycleBot = new CycleBot(ctx, r, {
    accepts: (i, p) => i < C.CORAL_COUNT && (r.alliance === 'blue' ? p.x < C.FIELD_LENGTH / 2 : p.x > C.FIELD_LENGTH / 2),
    supply: () => { claims.delete(r.id); return supply; },
    route: (goal) => dist(goal, reef) < reef.r + 0.1 ? goal : aroundCircles(r.pose, goal, [reef]),
    endgame: () => {
      if (ctx.clock.matchRemaining > 18 || !r.config.climber.maxLevel) return null;
      const goal = rules.climbApproach(r);
      if (!goal) return null;
      const cmd = bot.driveTo(goal, goal.yaw);
      if (dist(r.pose, goal) < 0.18) cmd.climb = r.config.climber.maxLevel;
      return cmd;
    },
    score: () => {
      if (!r.held.some((i) => i < C.CORAL_COUNT)) {
        // ALGAE: line up at the BARGE and outtake it into the NET from the raised elevator.
        const spot = rules.netPose(r);
        if (!spot) return bot.driveTo(supply);
        const cmd = bot.driveTo(spot, spot.yaw);
        cmd.shoot = dist(r.pose, spot) < (r.config.autoAlign ? 1.2 : 0.04) && Math.abs(wrapAngle(spot.yaw - r.pose.yaw)) < (r.config.autoAlign ? 0.6 : 0.03);
        return cmd;
      }
      // L1 remains available after the finite branches fill up.
      const max = r.config.placement?.maxLevel ?? 1;
      let level = max;
      const center = C.reefCenter(r.alliance);
      const availableFace = (face: number) => ![...claims].some(([id, claim]) => id !== r.id && claim.alliance === r.alliance && claim.face === face && claim.until > ctx.clock.elapsed);
      let face = C.nearestFace(r.alliance, r.pose);
      if (bot.hard || !availableFace(face)) {
        for (let candidateLevel = max; candidateLevel >= 1; candidateLevel--) {
          const faces = Array.from({ length: 6 }, (_, f) => f).filter((f) => availableFace(f) &&
            !rules.blocked(r.alliance, candidateLevel, f) && [0, 1].some((branch) => !rules.occupied(r.alliance, candidateLevel, f, branch)));
          if (!faces.length) continue;
          const approach = (f: number) => {
            const yaw = C.sideYaw(r.alliance, f * Math.PI / 3);
            return { x: center.x + Math.cos(yaw) * (reef.r + 0.25), y: center.y + Math.sin(yaw) * (reef.r + 0.25) };
          };
          faces.sort((a, b) => dist(r.pose, approach(a)) - dist(r.pose, approach(b)));
          face = faces[0];
          claims.set(r.id, { alliance: r.alliance, face, until: ctx.clock.elapsed + 1 });
          if (C.nearestFace(r.alliance, r.pose) !== face) return bot.driveTo(approach(face));
          level = candidateLevel;
          break;
        }
      }
      claims.set(r.id, { alliance: r.alliance, face, until: ctx.clock.elapsed + 1 });
      while (level > 1) {
        const t = rules.placementTarget(r, level);
        if (t && !rules.occupied(r.alliance, level, t.face, t.branch) && !rules.blocked(r.alliance, level, t.face)) break;
        level--;
      }
      const pose = rules.alignPose(r, level);
      if (!pose) return bot.driveTo(supply);
      const cmd = bot.driveTo(pose, pose.yaw);
      cmd.scoringLevel = level;
      cmd.shoot = dist(r.pose, pose) < 0.04 && Math.abs(wrapAngle(pose.yaw - r.pose.yaw)) < 0.03;
      return cmd;
    },
  });
  return bot;
}
