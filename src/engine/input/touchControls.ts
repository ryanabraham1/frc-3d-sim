import type { InputManager } from './input';
import type { ActionId } from './keybinds';

/** Primary pointer is a finger (iPhone, iPad, Android); `?touch` in the URL forces the overlay for testing. */
export function isTouchDevice(): boolean {
  if (typeof window === 'undefined') return false;
  if (/[?&]touch\b/.test(window.location?.search ?? '')) return true;
  return !!window.matchMedia?.('(pointer: coarse)').matches && (navigator.maxTouchPoints ?? 0) > 0;
}

export interface TouchOptions {
  humanPlayerButtons: number;
  /** Number of climb / scoring levels (level buttons shown when > 1). */
  levels: number;
  blocker: () => boolean;
  climber: () => boolean;
}

interface ButtonDef {
  label: string;
  /** Held while touched, or fired once per tap. */
  mode: 'hold' | 'tap';
  action: ActionId;
  size?: 'big' | 'small';
  /** CSS position, e.g. `right:20px;bottom:28px`. Safe-area insets are added by the helpers below. */
  pos: string;
  show?: () => boolean;
}

const R = (n: number) => `calc(${n}px + env(safe-area-inset-right))`;
const B = (n: number) => `calc(${n}px + env(safe-area-inset-bottom))`;
const T = (n: number) => `calc(${n}px + env(safe-area-inset-top))`;
const STICK_RADIUS = 56;

/**
 * On-screen controls feeding InputManager.virtual: a floating drive stick on the left, rotate buttons,
 * and action buttons on the right. Everything is multi-touch (pointer events with capture per control).
 */
export class TouchControls {
  private readonly root = document.createElement('div');
  private readonly cleanups: (() => void)[] = [];
  private readonly refreshers: (() => void)[] = [];
  private timer = 0;

  constructor(container: HTMLElement, private readonly input: InputManager, opts: TouchOptions) {
    this.root.className = 'touch';
    container.appendChild(this.root);
    document.body.classList.add('touch-ui');
    this.buildStick();

    const defs: ButtonDef[] = [
      { label: 'SHOOT', mode: 'hold', action: 'shoot', size: 'big', pos: `right:${R(20)};bottom:${B(24)}` },
      { label: 'INTAKE', mode: 'hold', action: 'intake', size: 'big', pos: `right:${R(116)};bottom:${B(24)}` },
      { label: 'PASS', mode: 'hold', action: 'pass', pos: `right:${R(20)};bottom:${B(120)}` },
      { label: 'CLIMB', mode: 'hold', action: 'climb', pos: `right:${R(80)};bottom:${B(120)}`, show: opts.climber },
      { label: 'DOWN', mode: 'hold', action: 'descend', pos: `right:${R(140)};bottom:${B(120)}`, show: opts.climber },
      { label: 'AUTO', mode: 'tap', action: 'toggleIntake', size: 'small', pos: `right:${R(20)};bottom:${B(176)}` },
      { label: 'LVL+', mode: 'tap', action: 'levelUp', size: 'small', pos: `right:${R(68)};bottom:${B(176)}`, show: () => opts.levels > 1 },
      { label: 'LVL−', mode: 'tap', action: 'levelDown', size: 'small', pos: `right:${R(116)};bottom:${B(176)}`, show: () => opts.levels > 1 },
      { label: 'BLOCK', mode: 'tap', action: 'toggleBlocker', size: 'small', pos: `right:${R(164)};bottom:${B(176)}`, show: opts.blocker },
      { label: '⟲', mode: 'hold', action: 'rotateLeft', pos: `left:calc(50% - 64px);bottom:${B(24)}` },
      { label: '⟳', mode: 'hold', action: 'rotateRight', pos: `left:calc(50% + 12px);bottom:${B(24)}` },
      { label: 'SLOW', mode: 'hold', action: 'precision', size: 'small', pos: `left:calc(50% - 21px);bottom:${B(84)}` },
      { label: 'PAUSE', mode: 'tap', action: 'pause', size: 'small', pos: `right:${R(110)};top:${T(10)}` },
      { label: 'CAM', mode: 'tap', action: 'cameraNext', size: 'small', pos: `right:${R(60)};top:${T(10)}` },
      { label: 'FLIP', mode: 'tap', action: 'cameraFlip', size: 'small', pos: `right:${R(10)};top:${T(10)}` },
    ];
    const hpActions: ActionId[] = ['humanPlayer', 'humanPlayerB', 'humanPlayerN', 'humanPlayerM'];
    for (let i = 0; i < Math.min(opts.humanPlayerButtons, 4); i++) {
      defs.push({ label: `HP${opts.humanPlayerButtons > 1 ? i + 1 : ''}`, mode: 'tap', action: hpActions[i], size: 'small', pos: `right:${R(20 + i * 48)};bottom:${B(228)}` });
    }
    for (const d of defs) this.buildButton(d);
    this.refresh();
    this.timer = window.setInterval(() => this.refresh(), 1000);
  }

  private refresh(): void {
    for (const r of this.refreshers) r();
  }

  private buildStick(): void {
    const zone = document.createElement('div');
    zone.className = 'touch-zone';
    const stick = document.createElement('div');
    stick.className = 'touch-stick';
    stick.style.display = 'none';
    const knob = document.createElement('div');
    knob.className = 'touch-knob';
    stick.appendChild(knob);
    zone.appendChild(stick);
    this.root.appendChild(zone);

    let id = -1;
    let ox = 0;
    let oy = 0;
    const v = this.input.virtual;
    const end = () => {
      id = -1;
      v.forward = 0;
      v.left = 0;
      stick.style.display = 'none';
    };
    const move = (e: PointerEvent) => {
      let dx = e.clientX - ox;
      let dy = e.clientY - oy;
      const len = Math.hypot(dx, dy);
      if (len > STICK_RADIUS) {
        dx = (dx / len) * STICK_RADIUS;
        dy = (dy / len) * STICK_RADIUS;
      }
      knob.style.transform = `translate(${dx}px,${dy}px)`;
      const mag = Math.min(1, len / STICK_RADIUS);
      const k = mag < 0.15 ? 0 : (mag - 0.15) / 0.85 / (len || 1);
      v.forward = -(e.clientY - oy) * k;
      v.left = -(e.clientX - ox) * k;
      const m = Math.hypot(v.forward, v.left);
      if (m > 1) {
        v.forward /= m;
        v.left /= m;
      }
    };
    zone.addEventListener('pointerdown', (e) => {
      if (id !== -1) return;
      e.preventDefault();
      id = e.pointerId;
      zone.setPointerCapture(id);
      const r = zone.getBoundingClientRect();
      ox = e.clientX;
      oy = e.clientY;
      stick.style.left = `${ox - r.left}px`;
      stick.style.top = `${oy - r.top}px`;
      stick.style.display = 'block';
      stick.classList.add('active');
      knob.style.transform = '';
      move(e);
    });
    zone.addEventListener('pointermove', (e) => e.pointerId === id && move(e));
    for (const t of ['pointerup', 'pointercancel'] as const) zone.addEventListener(t, (e) => e.pointerId === id && end());
    this.cleanups.push(end);
  }

  private buildButton(d: ButtonDef): void {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = `touch-btn${d.size ? ` ${d.size}` : ''}`;
    el.style.cssText = d.pos;
    el.textContent = d.label;
    const v = this.input.virtual;
    let id = -1;
    const release = () => {
      if (id === -1) return;
      id = -1;
      v.held.delete(d.action);
      el.classList.remove('on');
    };
    el.addEventListener('pointerdown', (e) => {
      if (id !== -1) return;
      e.preventDefault();
      id = e.pointerId;
      el.setPointerCapture(id);
      el.classList.add('on');
      if (d.mode === 'hold') v.held.add(d.action);
      else v.pressed.add(d.action);
      navigator.vibrate?.(8);
    });
    for (const t of ['pointerup', 'pointercancel'] as const) {
      el.addEventListener(t, (e) => {
        if (e.pointerId === id) release();
      });
    }
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    this.root.appendChild(el);
    this.cleanups.push(release);
    if (d.show) {
      const show = d.show;
      this.refreshers.push(() => {
        el.style.display = show() ? '' : 'none';
      });
    }
  }

  dispose(): void {
    clearInterval(this.timer);
    for (const c of this.cleanups) c();
    this.root.remove();
    document.body.classList.remove('touch-ui');
  }
}
