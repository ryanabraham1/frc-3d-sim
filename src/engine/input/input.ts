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
  cameraNext: boolean;
  /** Swing the chase camera between the intake side and the shooter side. */
  cameraFlip: boolean;
  pause: boolean;
  restart: boolean;
  toggleIntake: boolean;
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

  private k(code: string): boolean {
    return this.keys.has(code);
  }
  private edge(code: string): boolean {
    return this.pressed.has(code);
  }

  /** Read and consume edge events. Call once per rendered frame. */
  read(): DriverInput {
    let forward = (this.k('KeyW') || this.k('ArrowUp') ? 1 : 0) - (this.k('KeyS') || this.k('ArrowDown') ? 1 : 0);
    let left = (this.k('KeyA') ? 1 : 0) - (this.k('KeyD') ? 1 : 0);
    let rotate = (this.k('KeyQ') || this.k('ArrowLeft') ? 1 : 0) - (this.k('KeyE') || this.k('ArrowRight') ? 1 : 0);
    let shoot = this.k('Space') || this.k('KeyK');
    let pass = this.k('KeyG');
    let intake = this.k('KeyJ');
    let climb = this.k('KeyC');
    let descend = this.k('KeyX');
    let humanPlayer = this.edge('KeyH');
    let humanPlayerAlt = this.edge('KeyB') ? 2 : this.edge('KeyN') ? 3 : this.edge('KeyM') ? 4 : 0;
    const precision = this.k('ShiftLeft') || this.k('ShiftRight');
    let levelUp = this.edge('BracketRight');
    let levelDown = this.edge('BracketLeft');
    let setLevel: number | null = this.edge('Digit1') ? 1 : this.edge('Digit2') ? 2 : this.edge('Digit3') ? 3 : this.edge('Digit4') ? 4 : null;
    let cameraNext = this.edge('KeyV');
    const cameraFlip = this.edge('KeyT');
    let pause = this.edge('Escape') || this.edge('KeyP');
    const restart = this.edge('KeyR');
    const toggleIntake = this.edge('KeyI');
    const toggleHelp = this.edge('Slash') || this.edge('F1');

    // Gamepad (standard mapping): LS move, RS-x rotate, RT shoot, LT intake, A climb, B descend,
    // X human player, Y camera, D-pad up/down level, Start pause.
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
      if (e(14)) setLevel = 1;
      if (e(15)) setLevel = 3;
    }
    this.pressed.clear();
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
      cameraNext,
      cameraFlip,
      pause,
      restart,
      toggleIntake,
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
  ['Mouse drag / wheel', 'Orbit / zoom (Follow camera)'],
  ['P / Esc', 'Pause'],
  ['?', 'Toggle this help'],
  ['Gamepad', 'LS drive · RS rotate · RT shoot · RB feed · LT intake · A climb · B descend · X human player · Y camera'],
];
