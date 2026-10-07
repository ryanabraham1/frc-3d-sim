import { expect, it } from 'vitest';
import { normalizeSkill } from '../src/engine/core/season';
import { aiOrders, SKILL } from '../src/engine/ai/team';
import { defaultSettings } from '../src/app/menu';
import { SEASONS } from '../src/seasons';

it('Easy and Elite no longer exist: saved Easy plays as Normal and saved Elite as Hard', () => {
  expect(normalizeSkill('easy')).toBe('normal');
  expect(normalizeSkill('elite')).toBe('hard');
  expect(normalizeSkill('einstein')).toBe('einstein');
  expect(normalizeSkill('bogus')).toBe('normal');
  expect(normalizeSkill(undefined)).toBeUndefined();
  expect(Object.keys(SKILL).sort()).toEqual(['einstein', 'hard', 'normal']);
  const s = { ...defaultSettings(SEASONS[0]), aiDifficulty: 'elite' as never, aiAlly: { skill: 'easy' as never } };
  expect(aiOrders(s, 'red').skill).toBe('hard');
  expect(aiOrders(s, s.alliance).skill).toBe('normal');
});
