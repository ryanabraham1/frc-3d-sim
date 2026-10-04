import { describe, expect, it } from 'vitest';
import { ACTIONS, codeLabel, Keybinds, SLOTS } from '@engine/input/keybinds';

const memory = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), m };
};

describe('keybinds', () => {
  it('defaults keep the classic layout and never bind a key twice', () => {
    const kb = new Keybinds(memory());
    expect(kb.codes('forward')).toEqual(['KeyW', 'ArrowUp']);
    expect(kb.codes('shoot')).toEqual(['Space', 'KeyK']);
    expect(kb.isCustomized()).toBe(false);
    const all = ACTIONS.flatMap((a) => kb.codes(a.id));
    expect(new Set(all).size).toBe(all.length);
    expect(ACTIONS.every((a) => a.defaults.length <= SLOTS)).toBe(true);
  });

  it('rebinding takes the key from the action that had it', () => {
    const kb = new Keybinds(memory());
    expect(kb.set('pass', 0, 'Space')).toBe('shoot');
    expect(kb.codes('pass')).toEqual(['Space']);
    expect(kb.codes('shoot')).toEqual(['KeyK']);
    expect(kb.actionFor('Space')).toBe('pass');
    expect(kb.actionFor('KeyG')).toBeNull();
  });

  it('rebinding a slot to its own key, or clearing it, is harmless', () => {
    const kb = new Keybinds(memory());
    expect(kb.set('forward', 0, 'KeyW')).toBeNull();
    expect(kb.codes('forward')).toEqual(['KeyW', 'ArrowUp']);
    kb.set('forward', 1, '');
    expect(kb.codes('forward')).toEqual(['KeyW']);
  });

  it('persists, reloads, and resets', () => {
    const store = memory();
    const a = new Keybinds(store);
    a.set('climb', 0, 'KeyU');
    const b = new Keybinds(store);
    expect(b.codes('climb')).toEqual(['KeyU']);
    expect(b.isCustomized()).toBe(true);
    b.resetAll();
    expect(store.m.size).toBe(0);
    expect(new Keybinds(store).codes('climb')).toEqual(['KeyC']);
  });

  it('resetAction restores defaults even if another action took the key', () => {
    const kb = new Keybinds(memory());
    kb.set('pass', 0, 'KeyJ'); // steals intake's key
    expect(kb.codes('intake')).toEqual([]);
    kb.resetAction('intake');
    expect(kb.codes('intake')).toEqual(['KeyJ']);
    expect(kb.codes('pass')).toEqual([]);
  });

  it('ignores corrupt storage and keeps defaults for actions added after the save', () => {
    const bad = memory();
    bad.setItem('frc3d.keybinds.v1', '{nope');
    expect(new Keybinds(bad).codes('shoot')).toEqual(['Space', 'KeyK']);
    const old = memory();
    old.setItem('frc3d.keybinds.v1', JSON.stringify({ shoot: ['KeyZ', ''] }));
    const kb = new Keybinds(old);
    expect(kb.codes('shoot')).toEqual(['KeyZ']);
    expect(kb.codes('forward')).toEqual(['KeyW', 'ArrowUp']);
  });

  it('labels keys for display', () => {
    expect(['KeyW', 'Digit3', 'ArrowLeft', 'Space', 'BracketLeft', 'NumpadAdd', ''].map(codeLabel)).toEqual(['W', '3', '←', 'Space', '[', 'Num +', '—']);
  });
});
