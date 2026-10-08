import { keybinds, type ActionId } from './keybinds';

/**
 * Keyboard + gamepad → DriverInput (driver-perspective, normalized). The game converts this to a
 * field-frame RobotCommand using the active camera's reference yaw.
 */
export interface DriverInput {
  /** -1..1, + = away from driver / camera forward. */
  forward: number;
  /** -1..1, + = to the driver's left. */
  left: number;
  /** -1..1, + = counter-clockwise. */
  rotate: number;
  shoot: boolean;
  /** Feed/pass toward our own zone. */
  pass: boolean;
  intake: boolean;
  climb: boolean;
  descend: boolean;
  humanPlayer: boolean;
  /** Extra human-player buttons for seasons that declare them (2 = B / gamepad LB, 3 = N, 4 = M). 0 = none. */
  humanPlayerAlt: number;
  precision: boolean;
  // edge-triggered
  levelUp: boolean;
  levelDown: boolean;
  setLevel: number | null;
  /** Step the selected shot target (-1 / +1), or 0. */
  targetStep: number;
  /** Go back to automatic target selection. */
  targetAuto: boolean;
  cameraNext: boolean;
  /** Swing the chase camera between the intake side and the shooter side. */
  cameraFlip: boolean;
  pause: boolean;
  restart: boolean;
  toggleIntake: boolean;
  /** Raise / lower the shot blocker (robots with config.shotBlocker). */
  toggleBlocker: boolean;
  toggleHelp: boolean;
}

const DEADZONE = 0.12;
const dz = (v: number) => (Math.abs(v) < DEADZONE ? 0 : (v - Math.sign(v) * DEADZONE) / (1 - DEADZONE));

export class InputManager {
  private keys = new Set<string>();
  private pressed = new Set<string>();
  private prevPad = new Map<number, boolean>();
  private padEdges = new Set<number>();
  enabled = true;
  /** On-screen controls (touch devices) feed these: held actions, one-shot presses, and analog drive. */
  readonly virtual = {
    held: new Set<ActionId>(),
    pressed: new Set<ActionId>(),
    forward: 0,
    left: 0,
  };

  private readonly down = (e: KeyboardEvent) => {
    if (!this.enabled) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return;
    if (!this.keys.has(e.code)) this.pressed.add(e.code);
    this.keys.add(e.code);
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) e.preventDefault();
  };
  private readonly up = (e: KeyboardEvent) => {
    this.keys.delete(e.code);
  };
  private readonly blur = () => this.keys.clear();

  constructor() {
    window.addEventListener('keydown', this.down);
    window.addEventListener('keyup', this.up);
    window.addEventListener('blur', this.blur);
  }

  dispose(): void {
    window.removeEventListener('keydown', this.down);
    window.removeEventListener('keyup', this.up);
    window.removeEventListener('blur', this.blur);
  }

  /** Is any key bound to this action held? Bindings are read live, so menu changes apply immediately. */
  private k(action: ActionId): boolean {
    return this.virtual.held.has(action) || keybinds.codes(action).some((c) => this.keys.has(c));
  }
  private edge(action: ActionId): boolean {
    return this.virtual.pressed.has(action) || keybinds.codes(action).some((c) => this.pressed.has(c));
  }

  /** Read and consume edge events. Call once per rendered frame. */
  read(): DriverInput {
    let forward = (this.k('forward') ? 1 : 0) - (this.k('backward') ? 1 : 0);
    let left = (this.k('left') ? 1 : 0) - (this.k('right') ? 1 : 0);
    let rotate = (this.k('rotateLeft') ? 1 : 0) - (this.k('rotateRight') ? 1 : 0);
    let shoot = this.k('shoot');
    let pass = this.k('pass');
    let intake = this.k('intake');
    let climb = this.k('climb');
    let descend = this.k('descend');
    let humanPlayer = this.edge('humanPlayer');
    let humanPlayerAlt = this.edge('humanPlayerB') ? 2 : this.edge('humanPlayerN') ? 3 : this.edge('humanPlayerM') ? 4 : 0;
    const precision = this.k('precision');
    let levelUp = this.edge('levelUp');
    let levelDown = this.edge('levelDown');
    let targetStep = (this.edge('targetNext') ? 1 : 0) - (this.edge('targetPrev') ? 1 : 0);
    const targetAuto = this.edge('targetAuto');
    let setLevel: number | null = this.edge('level1') ? 1 : this.edge('level2') ? 2 : this.edge('level3') ? 3 : this.edge('level4') ? 4 : null;
    let cameraNext = this.edge('cameraNext');
    const cameraFlip = this.edge('cameraFlip');
    let pause = this.edge('pause');
    const restart = this.edge('restart');
    const toggleIntake = this.edge('toggleIntake');
    let toggleBlocker = this.edge('toggleBlocker');
    const toggleHelp = this.edge('toggleHelp');

    if (this.virtual.forward || this.virtual.left) {
      forward = this.virtual.forward;
      left = this.virtual.left;
    }

    // Gamepad (standard mapping): LS move, RS-x rotate, RT shoot, LT intake, A climb, B descend,
    // X human player, Y camera, D-pad up/down level, Start pause, L3 shot blocker.
    this.padEdges.clear();
    const pads = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : [];
    const pad = Array.from(pads).find((p) => p && p.connected) ?? null;
    if (pad) {
      const ax = (i: number) => dz(pad.axes[i] ?? 0);
      const btn = (i: number) => !!pad.buttons[i]?.pressed;
      const val = (i: number) => pad.buttons[i]?.value ?? 0;
      for (let i = 0; i < pad.buttons.length; i++) {
        const now = btn(i);
        if (now && !this.prevPad.get(i)) this.padEdges.add(i);
        this.prevPad.set(i, now);
      }
      const e = (i: number) => this.padEdges.has(i);
      if (ax(1) || ax(0)) {
        forward = -ax(1);
        left = -ax(0);
      }
      if (ax(2)) rotate = -ax(2);
      shoot ||= val(7) > 0.4;
      pass ||= btn(5);
      intake ||= val(6) > 0.4;
      climb ||= btn(0);
      descend ||= btn(1);
      humanPlayer ||= e(2);
      if (e(4)) humanPlayerAlt = 2;
      cameraNext ||= e(3);
      levelUp ||= e(12);
      levelDown ||= e(13);
      pause ||= e(9);
      toggleBlocker ||= e(10);
      if (e(11)) targetStep = 1;
      if (e(14)) setLevel = 1;
      if (e(15)) setLevel = 3;
    }
    this.pressed.clear();
    this.virtual.pressed.clear();
    return {
      forward,
      left,
      rotate,
      shoot,
      pass,
      intake,
      climb,
      descend,
      humanPlayer,
      humanPlayerAlt,
      precision,
      levelUp,
      levelDown,
      setLevel,
      targetStep,
      targetAuto,
      cameraNext,
      cameraFlip,
      pause,
      restart,
      toggleIntake,
      toggleBlocker,
      toggleHelp,
    };
  }
}

export const DEFAULT_CONTROLS_HELP: [string, string][] = [
  ['W A S D', 'Drive (relative to your view)'],
  ['Q / E  or  ← / →', 'Rotate'],
  ['Shift', 'Precision (slow) mode'],
  ['Space', 'Shoot at goal (hold)'],
  ['G', 'Feed / pass toward your alliance zone (hold)'],
  ['I', 'Toggle auto-intake · J = hold intake'],
  ['C / X', 'Climb / descend'],
  ['1 2 3  or  [ ]', 'Select climb level'],
  ['H', 'Human player: release chute'],
  ['V', 'Cycle camera'],
  ['T', 'Chase camera: look along the intake side / the shooter side'],
  ['Mouse drag / wheel', 'Orbit / zoom (Free orbit camera)'],
  ['P / Esc', 'Pause'],
  ['?', 'Toggle this help'],
  ['Gamepad', 'LS drive · RS rotate · RT shoot · RB feed · LT intake · A climb · B descend · X human player · Y camera · L3 shot blocker'],
];
