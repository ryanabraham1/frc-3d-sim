/**
 * Rebindable keyboard controls. Every action has up to SLOTS physical keys (KeyboardEvent.code), so the
 * defaults keep their alternates (W / ↑, Space / K, …). Bindings persist in localStorage and are read
 * live by InputManager, so a change made in the menu applies to the next match.
 */
export type ActionId =
  | 'forward' | 'backward' | 'left' | 'right' | 'rotateLeft' | 'rotateRight' | 'precision'
  | 'shoot' | 'pass' | 'intake' | 'toggleIntake' | 'climb' | 'descend' | 'toggleBlocker'
  | 'humanPlayer' | 'humanPlayerB' | 'humanPlayerN' | 'humanPlayerM'
  | 'levelUp' | 'levelDown' | 'level1' | 'level2' | 'level3' | 'level4'
  | 'cameraNext' | 'cameraFlip' | 'pause' | 'restart' | 'toggleHelp';

export const SLOTS = 2;

export interface ActionDef {
  id: ActionId;
  label: string;
  group: string;
  defaults: string[];
}

const def = (id: ActionId, group: string, label: string, ...defaults: string[]): ActionDef => ({ id, group, label, defaults });

export const ACTIONS: ActionDef[] = [
  def('forward', 'Driving', 'Drive forward', 'KeyW', 'ArrowUp'),
  def('backward', 'Driving', 'Drive backward', 'KeyS', 'ArrowDown'),
  def('left', 'Driving', 'Strafe left', 'KeyA'),
  def('right', 'Driving', 'Strafe right', 'KeyD'),
  def('rotateLeft', 'Driving', 'Rotate left', 'KeyQ', 'ArrowLeft'),
  def('rotateRight', 'Driving', 'Rotate right', 'KeyE', 'ArrowRight'),
  def('precision', 'Driving', 'Precision (slow) mode', 'ShiftLeft', 'ShiftRight'),
  def('shoot', 'Robot', 'Shoot / score (hold)', 'Space', 'KeyK'),
  def('pass', 'Robot', 'Feed / pass (hold)', 'KeyG'),
  def('intake', 'Robot', 'Intake (hold)', 'KeyJ'),
  def('toggleIntake', 'Robot', 'Toggle auto-intake', 'KeyI'),
  def('climb', 'Robot', 'Climb', 'KeyC'),
  def('descend', 'Robot', 'Descend', 'KeyX'),
  def('toggleBlocker', 'Robot', 'Shot blocker / hopper up or down', 'KeyF'),
  def('levelUp', 'Robot', 'Level up', 'BracketRight'),
  def('levelDown', 'Robot', 'Level down', 'BracketLeft'),
  def('level1', 'Robot', 'Select level 1', 'Digit1'),
  def('level2', 'Robot', 'Select level 2', 'Digit2'),
  def('level3', 'Robot', 'Select level 3', 'Digit3'),
  def('level4', 'Robot', 'Select level 4', 'Digit4'),
  def('humanPlayer', 'Human player', 'Human player button 1 (chute drop)', 'KeyH'),
  def('humanPlayerB', 'Human player', 'Human player button 2', 'KeyB'),
  def('humanPlayerN', 'Human player', 'Human player button 3', 'KeyN'),
  def('humanPlayerM', 'Human player', 'Human player button 4', 'KeyM'),
  def('cameraNext', 'Match', 'Cycle camera', 'KeyV'),
  def('cameraFlip', 'Match', 'Flip chase camera (intake / shooter side)', 'KeyT'),
  def('pause', 'Match', 'Pause', 'Escape', 'KeyP'),
  def('restart', 'Match', 'Restart match', 'KeyR'),
  def('toggleHelp', 'Match', 'Toggle controls help', 'Slash', 'F1'),
];

const STORAGE_KEY = 'frc3d.keybinds.v1';

const pad = (codes: readonly string[]): string[] => Array.from({ length: SLOTS }, (_, i) => codes[i] ?? '');

/** Keys a player can't bind: Escape cancels capture, and the OS/browser owns the rest. */
export const RESERVED_CODES = new Set(['Escape', 'MetaLeft', 'MetaRight', 'ContextMenu', 'PrintScreen']);

export class Keybinds {
  private map = new Map<ActionId, string[]>();

  constructor(private readonly storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null = defaultStorage()) {
    this.load();
  }

  /** Physical keys currently bound to an action (empty slots omitted). */
  codes(id: ActionId): readonly string[] {
    return (this.map.get(id) ?? []).filter(Boolean);
  }

  /** Both slots, '' = unbound. */
  slots(id: ActionId): readonly string[] {
    return this.map.get(id) ?? pad([]);
  }

  /** The action a key is bound to, if any. */
  actionFor(code: string): ActionId | null {
    for (const a of ACTIONS) if (this.codes(a.id).includes(code)) return a.id;
    return null;
  }

  /**
   * Bind `code` to slot `slot` of an action. A key can only drive one action, so it is taken from
   * whichever action had it; that action is returned (and the displaced slot left unbound).
   * Pass '' to clear the slot.
   */
  set(id: ActionId, slot: number, code: string): ActionId | null {
    if (code && RESERVED_CODES.has(code) && code !== 'Escape') return null;
    let displaced: ActionId | null = null;
    if (code) {
      for (const a of ACTIONS) {
        const s = this.map.get(a.id)!;
        const i = s.indexOf(code);
        if (i >= 0 && !(a.id === id && i === slot)) {
          s[i] = '';
          if (a.id !== id) displaced = a.id;
        }
      }
    }
    this.map.get(id)![slot] = code;
    this.save();
    return displaced;
  }

  resetAction(id: ActionId): void {
    const d = ACTIONS.find((a) => a.id === id)!;
    // Taking defaults back from other actions keeps the one-key-one-action invariant.
    d.defaults.forEach((c, i) => this.set(id, i, c));
    for (let i = d.defaults.length; i < SLOTS; i++) this.set(id, i, '');
  }

  resetAll(): void {
    for (const a of ACTIONS) this.map.set(a.id, pad(a.defaults));
    this.save();
  }

  isCustomized(): boolean {
    return ACTIONS.some((a) => pad(a.defaults).join('|') !== this.slots(a.id).join('|'));
  }

  private load(): void {
    for (const a of ACTIONS) this.map.set(a.id, pad(a.defaults));
    try {
      const raw = this.storage?.getItem(STORAGE_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw) as Record<string, unknown>;
      const used = new Set<string>();
      for (const a of ACTIONS) {
        const v = saved[a.id];
        if (!Array.isArray(v)) continue; // new action since the save: keep its default
        const slots = pad(v.map((c) => (typeof c === 'string' ? c : '')));
        this.map.set(a.id, slots.map((c) => (c && !used.has(c) ? (used.add(c), c) : '')));
      }
      // A default key for a brand-new action may collide with a saved custom binding; the saved one wins.
      for (const a of ACTIONS) {
        if (Array.isArray(saved[a.id])) continue;
        this.map.set(a.id, pad(a.defaults).map((c) => (c && !used.has(c) ? (used.add(c), c) : '')));
      }
    } catch {
      /* corrupt or unavailable storage — use defaults */
    }
  }

  private save(): void {
    try {
      if (!this.isCustomized()) return void this.storage?.removeItem(STORAGE_KEY);
      this.storage?.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(this.map)));
    } catch {
      /* storage unavailable (private mode) — bindings last for this session */
    }
  }
}

function defaultStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** Shared by the menu editor and every InputManager. */
export const keybinds = new Keybinds();

const NAMED: Record<string, string> = {
  Space: 'Space', Escape: 'Esc', Enter: 'Enter', Tab: 'Tab', Backspace: '⌫', Delete: 'Del',
  ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
  ShiftLeft: 'L Shift', ShiftRight: 'R Shift', ControlLeft: 'L Ctrl', ControlRight: 'R Ctrl',
  AltLeft: 'L Alt', AltRight: 'R Alt', CapsLock: 'Caps',
  BracketLeft: '[', BracketRight: ']', Slash: '/', Backslash: '\\', Semicolon: ';', Quote: "'",
  Comma: ',', Period: '.', Minus: '-', Equal: '=', Backquote: '`',
};

/** Short label for a KeyboardEvent.code, e.g. KeyW → W, Digit1 → 1, NumpadAdd → Num +. */
export function codeLabel(code: string): string {
  if (!code) return '—';
  if (NAMED[code]) return NAMED[code];
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit\d$/.test(code)) return code.slice(5);
  if (code.startsWith('Numpad')) return `Num ${code.slice(6).replace('Add', '+').replace('Subtract', '-').replace('Multiply', '×').replace('Divide', '÷').replace('Decimal', '.')}`;
  return code;
}
