import { describe,expect,it } from 'vitest';
import { CLASS_LIMITS,legalPreload,legalPossession } from '../src/seasons/wcp-hero-heist/constants';
import { heroClass,heroRobotPresets,normalizeHeroConfig,PLAYING_MASS_ALLOWANCE,preloads,storage,TIMELINE } from '../src/seasons/wcp-hero-heist/config';

describe('Hero Heist derived archetypes',()=>{
  it('has two distinct builds per class and legal dimensions/inventory/preloads',()=>{
    const presets=heroRobotPresets();expect(presets).toHaveLength(6);
    for(const hero of ['commander','mystic','gadgeteer'] as const)expect(presets.filter(p=>heroClass(p.config)===hero)).toHaveLength(2);
    for(const {config:c} of presets){
      const hero=heroClass(c),l=CLASS_LIMITS[hero],p=preloads(c);
      expect(c.height).toBeLessThanOrEqual(l.startHeight);expect(2*(c.frameLength+c.frameWidth)).toBeLessThanOrEqual(l.perimeter+.000001);expect(c.mass).toBeLessThanOrEqual(l.mass+PLAYING_MASS_ALLOWANCE);
      expect(legalPreload(hero,p.panels,p.bubbles)).toBe(true);expect(legalPossession(hero,p.panels,p.bubbles)).toBe(true);
      expect(c.launcher.enabled).toBe(hero!=='commander');expect(c.placement?.enabled).toBe(hero!=='mystic');
      expect(c.model).toBe(`hero-${c.options?.archetype}`);expect(normalizeHeroConfig(c)).toEqual(c);
    }
  });
  it('preserves the mechanisms that distinguish the presets',()=>{
    const by=Object.fromEntries(heroRobotPresets().map(p=>[p.id,p.config]));
    expect(storage(by['commander-simple']).panels).toBe(1);expect(by['commander-simple'].intake.ground).toBe(false);
    expect(storage(by['commander-roller']).panels).toBe(3);
    expect(storage(by['mystic-turret']).bubbles).toBe(6);expect(by['mystic-turret'].launcher.turret).toBe(true);
    expect(by['mystic-fixed'].launcher.minAngle).toBe(by['mystic-fixed'].launcher.maxAngle);
    expect(by['gadgeteer-flex'].options?.sharedTool).toBe(true);expect(preloads(by['gadgeteer-flex']).panels).toBe(0);
  });
  it('uses 135 enabled seconds with a 20-second endgame and 5-second final assessment',()=>{
    expect(TIMELINE.map(p=>p.duration)).toEqual([15,100,20,5]);
    expect(TIMELINE.filter(p=>p.mode!=='disabled').reduce((n,p)=>n+p.duration,0)).toBe(135);
  });
});
