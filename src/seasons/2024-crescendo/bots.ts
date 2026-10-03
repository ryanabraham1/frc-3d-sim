import { aroundCircles, CycleBot } from '@engine/ai/cycleBot';
import { dist } from '@engine/ai/steering';
import type { SeasonContext } from '@engine/core/season';
import type { Robot } from '@engine/robot/robot';
import type { CrescendoRules } from './rules';
import * as C from './constants';

export function createCrescendoBot(ctx: SeasonContext, rules: CrescendoRules, r: Robot): CycleBot {
  const spot = C.side(r.alliance, 2.3 + (r.station - 1) * 0.4, C.SPEAKER_Y + (r.station - 2) * 0.5);
  const supply = { ...C.sourcePoint(r.alliance, 0.5, r.footprint.length / 2 + 0.02), yaw: C.sideYaw(C.sourceEnd(r.alliance), Math.atan2(C.SOURCE_NORMAL.y, C.SOURCE_NORMAL.x)) };
  const stages = (['blue', 'red'] as const).map((a) => ({ ...C.stageCenter(a), r: 1.7 + r.footprint.width / 2 }));
  const bot: CycleBot = new CycleBot(ctx, r, {
    accepts: (i, p) => !C.isHighNote(i) && ((r.alliance === 'blue' ? p.x < C.L / 2 + 0.4 : p.x > C.L / 2 - 0.4) || dist(p, supply) < 2) && !stages.some((s) => dist(s, p) < s.r),
    supply: () => supply,
    endgame: () => {
      if (ctx.clock.matchRemaining > 18 || !r.config.climber.maxLevel) return null;
      const chain = C.chainGeometry(r.alliance, r.station - 1);
      const goal = { ...chain.mid, x: chain.mid.x + Math.cos(chain.normal) * 0.2, y: chain.mid.y + Math.sin(chain.normal) * 0.2 };
      // Approach the chain from its outward side, clear of the core and the two legs.
      const outer = { x: goal.x + Math.cos(chain.normal) * 1, y: goal.y + Math.sin(chain.normal) * 1 };
      const destination = dist(r.pose, goal) < 1.1 ? goal : outer;
      const cmd = bot.driveTo(destination, chain.normal + Math.PI);
      if (rules.chainFor(r)) cmd.climb = 1;
      return cmd;
    },
    route: (goal) => ctx.clock.matchRemaining < 18 && bot.hard && dist(goal, C.stageCenter(r.alliance)) < 2 ? goal : aroundCircles(r.pose, goal, stages),
    score: () => {
      if (bot.hard && r.station === 1 && rules.bank[r.alliance] < 2 && !rules.amplified(r.alliance)) {
        const amp = C.ampCenter(r.alliance);
        const goal = { x: amp.x, y: C.W - Math.max(r.footprint.length, r.footprint.width) / 2 - 0.06 };
        const cmd = bot.driveTo(goal, Math.PI / 2);
        cmd.pass = dist(r.pose, goal) < 0.12 && rules.nearAmp(r);
        return cmd;
      }
      if (bot.hard && rules.bank[r.alliance] >= 2 && !rules.amplified(r.alliance) && ctx.robots.some((o) => o.alliance === r.alliance && o.held.length > 0 && dist(o.pose, spot) < 2)) rules.pressAmplify(r.alliance);
      const aim = C.speakerAim(r.alliance);
      const cmd = bot.driveTo(spot, Math.atan2(aim.y - r.pose.y, aim.x - r.pose.x));
      // Traffic can keep a robot away from its exact spot. Fire throughout the usable speaker approach.
      cmd.shoot = C.fromWall(r.alliance, r.pose.x) < (bot.hard ? 4 : 3.5) && Math.abs(r.pose.y - C.SPEAKER_Y) < (bot.hard ? 1.7 : 1.5);
      return cmd;
    },
  });
  return bot;
}
