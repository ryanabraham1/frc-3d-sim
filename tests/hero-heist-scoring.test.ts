import { describe, expect, it } from 'vitest';
import { Scoreboard } from '../src/engine/match/scoreboard';
import { legalPossession, legalPreload, pieceIdentity } from '../src/seasons/wcp-hero-heist/constants';
import { applyPiece, DistrictOwnership, ownershipPoints, type Ownership } from '../src/seasons/wcp-hero-heist/ownership';
import { calculatorScore, heroHeistResults, towerPoints } from '../src/seasons/wcp-hero-heist/scoring';

describe('Hero Heist source scoring', () => {
  for (const color of ['red','blue'] as const) {
    const other = color === 'red' ? 'blue' : 'red';
    it(`${color}: scores bubbles before ownership changes at every strength`, () => {
      for (const phase of ['auto','teleop'] as const) for (const strength of [0,1,2,3,4]) {
        const own: Ownership = { support: strength ? color : null, strength };
        const enemy: Ownership = { support: strength ? other : null, strength };
        const a = applyPiece(own, color, 'bubble', phase);
        expect(a.fame).toBe(strength >= 2 ? phase === 'auto' ? 6 : 3 : phase === 'auto' ? 2 : 1);
        expect(a.state.strength).toBe(strength >= 2 ? strength : strength + 1);
        const b = applyPiece(enemy, color, 'bubble', phase);
        expect(b.fame).toBe(strength >= 2 ? 0 : phase === 'auto' ? 2 : 1);
        expect(b.state.strength).toBe(strength ? strength - 1 : 1);
        expect(b.state.support).toBe(strength === 1 ? null : strength ? other : color);
      }
    });
    it(`${color}: panels strip without overflowing and ownership is reversible`, () => {
      const o = new DistrictOwnership();
      o.districts[0] = { support: other, strength: 3 };
      expect(o.points(other)).toBe(10);
      expect(o.accept(0, color, 'panel','teleop')).toEqual({ fame:0, bonus:0 });
      expect(o.districts[0]).toEqual({ support:null, strength:0 });
      expect(o.points(other)).toBe(0);
      o.accept(0,color,'panel','teleop'); expect(o.points(color)).toBe(10);
      o.accept(0,color,'panel','teleop'); expect(o.points(color)).toBe(25);
      o.accept(0,color,'panel','teleop'); expect(o.points(color)).toBe(25);
      for (const strength of [1,2,3,4]) expect(applyPiece({support:other,strength},color,'panel','auto')).toEqual({fame:0,state:{support:null,strength:0}});
    });
    it(`${color}: cannot farm AUTO bonuses and retains district history after loss`, () => {
      const o = new DistrictOwnership();
      o.accept(0,color,'panel','auto');
      expect(o.accept(0,color,'panel','auto').bonus).toBe(10);
      o.accept(0,other,'panel','auto');
      o.accept(0,color,'panel','auto');
      expect(o.accept(0,color,'panel','auto').bonus).toBe(0);
      o.accept(0,other,'panel','teleop');
      expect(o.points(color)).toBe(0);
      expect([...o.partialHistory[color]]).toEqual([0]);
      expect([...o.fullHistory[color]]).toEqual([0]);
      const restored = new DistrictOwnership(); restored.restore(JSON.parse(JSON.stringify(o.snapshot())));
      expect(restored.snapshot()).toEqual(o.snapshot());
    });
  }
  it('matches the supplied spreadsheet aggregate fixture', () => {
    expect(calculatorScore({autoOwnedBubbles:3,autoNeutralBubbles:2,autoFullDistricts:1,teleopOwnedBubbles:5,teleopNeutralBubbles:4,partialDistricts:2,fullDistricts:1,parks:1,lowClimbs:0,mediumClimbs:1,highClimbs:1})).toEqual({auto:32,teleop:64,endgame:90,total:186});
    expect([0,1,2,3,4].map(strength=>ownershipPoints({support:strength?'red':null,strength}))).toEqual([0,0,10,10,25]);
  });
  it('awards RP at distinct history and tower boundaries, excluding empty AUTO', () => {
    const o = new DistrictOwnership(), score = new Scoreboard({minor:25,major:50});
    score.set('red','tower',59); score.inc('red','autoLeave',2);
    for (let i=0;i<7;i++) o.accept(i,'red','panel','teleop');
    expect(heroHeistResults(score,o,{red:3,blue:0}).rp).toEqual({red:3,blue:0});
    score.inc('red','autoLeave'); score.set('red','tower',60); o.accept(7,'red','panel','teleop');
    expect(heroHeistResults(score,o,{red:3,blue:0}).rp.red).toBe(6);
    o.partialHistory.red.clear(); o.fullHistory.red = new Set([0,1,2,3]);
    expect(heroHeistResults(score,o,{red:3,blue:0}).rp.red).toBe(5);
    o.fullHistory.red.add(4); expect(heroHeistResults(score,o,{red:3,blue:0}).rp.red).toBe(6);
    score.foul({t:0,alliance:'red',kind:'major',rule:'G11',robotId:0}); expect(score.total('blue')).toBe(50);
  });
  it('tower states do not stack and disqualification overrides a forced award', () => {
    expect([0,1,2,3].map(l=>towerPoints(l,true))).toEqual([5,20,35,50]);
    expect(towerPoints(0,false,false,true)).toBe(50);
    expect(towerPoints(3,true,true,true)).toBe(0);
  });
  it('enforces Gadgeteer conditional capacity and type-specific preloads', () => {
    for (let p=0;p<=4;p++) for (let b=0;b<=7;b++) {
      expect(legalPossession('gadgeteer',p,b)).toBe(p<=2 && b<=4 && !(p>1 && b>0) && !(b>3 && p>0));
      expect(legalPossession('commander',p,b)).toBe(p<=3 && b===0);
      expect(legalPossession('mystic',p,b)).toBe(p===0 && b<=6);
    }
    expect(legalPreload('gadgeteer',1,3)).toBe(true);
    expect(legalPreload('gadgeteer',2,0)).toBe(false);
    expect(legalPreload('mystic',0,4)).toBe(false);
    expect(legalPossession('gadgeteer',0,-1)).toBe(false);
    expect(legalPossession('mystic',0,1.5)).toBe(false);
  });
  it('has exactly the specified type/color inventory with stable IDs', () => {
    const counts: Record<string,number> = {};
    for (let i=0;i<84;i++) { const p=pieceIdentity(i), key=`${p.color}-${p.kind}`; counts[key]=(counts[key]??0)+1; }
    expect(counts).toEqual({'red-bubble':30,'blue-bubble':30,'red-panel':12,'blue-panel':12});
    expect(()=>pieceIdentity(84)).toThrow();
  });
});
