import type { Alliance } from '../coords';
import type { HudSlots, MatchResults, PlayerResults, ToastKind } from '../core/season';

export interface ModalButton {
  label: string;
  primary?: boolean;
  onClick: () => void;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** Generic in-game DOM overlay. Seasons render into the provided slots. */
export class Hud {
  readonly root: HTMLDivElement;
  readonly slots: HudSlots;
  private redScore: HTMLElement;
  private blueScore: HTMLElement;
  private timer: HTMLElement;
  private period: HTMLElement;
  private toasts: HTMLElement;
  private radioLog: HTMLElement;
  private banner: HTMLElement;
  private modal: HTMLElement;
  private help: HTMLElement;
  private info: HTMLElement;
  private fps: HTMLElement;
  private hint: HTMLElement;
  /** Frame-rate readout: dev builds, or `?fps` in the URL. */
  private readonly showFps = import.meta.env.DEV || /[?&]fps\b/.test(globalThis.location?.search ?? '');
  private bannerTimer = 0;
  private cache = new Map<HTMLElement, string>();

  constructor(container: HTMLElement, controls: [string, string][]) {
    this.root = document.createElement('div');
    this.root.className = 'hud';
    this.root.innerHTML = `
      <div class="hud-top">
        <div class="hud-head"><div class="hud-period" data-r="period">PRE-MATCH</div></div>
        <div class="hud-name blue">BLUE ALLIANCE</div>
        <div class="hud-score blue" data-r="bs">0</div>
        <div class="hud-center"><div class="hud-timer" data-r="timer">0:20</div></div>
        <div class="hud-score red" data-r="rs">0</div>
        <div class="hud-name red">RED ALLIANCE</div>
        <div class="hud-sub blue hud-slot" data-r="bslot"></div>
        <div class="hud-sub center hud-slot" data-r="cslot"></div>
        <div class="hud-sub red hud-slot" data-r="rslot"></div>
      </div>
      <div class="hud-banner" data-r="banner"></div>
      <div class="hud-toasts" data-r="toasts"></div>
      <div class="hud-radio" data-r="radio"></div>
      <div class="hud-player" data-r="player"></div>
      <div class="hud-info" data-r="info"></div>
      <div class="hud-help hidden" data-r="help"></div>
      <div class="hud-fps" data-r="fps"></div>
      <div class="hud-hint hidden" data-r="hint"></div>
      <div class="hud-modal hidden" data-r="modal"></div>
    `;
    container.appendChild(this.root);
    const q = (r: string) => this.root.querySelector(`[data-r="${r}"]`) as HTMLElement;
    this.redScore = q('rs');
    this.blueScore = q('bs');
    this.timer = q('timer');
    this.period = q('period');
    this.toasts = q('toasts');
    this.radioLog = q('radio');
    this.banner = q('banner');
    this.modal = q('modal');
    this.help = q('help');
    this.info = q('info');
    this.fps = q('fps');
    this.hint = q('hint');
    if (!this.showFps) this.fps.classList.add('hidden');
    this.slots = { red: q('rslot'), blue: q('bslot'), center: q('cslot'), player: q('player') };
    this.help.innerHTML =
      `<div class="hud-help-title">Controls</div>` +
      controls.map(([k, v]) => `<div class="hud-help-row"><kbd>${esc(k)}</kbd><span>${esc(v)}</span></div>`).join('');
  }

  /** Set text only when changed (avoids layout thrash). */
  setText(el: HTMLElement, text: string): void {
    if (this.cache.get(el) === text) return;
    this.cache.set(el, text);
    el.textContent = text;
  }

  setHtml(el: HTMLElement, html: string): void {
    if (this.cache.get(el) === html) return;
    this.cache.set(el, html);
    el.innerHTML = html;
  }

  setScores(red: number, blue: number): void {
    this.setText(this.redScore, String(red));
    this.setText(this.blueScore, String(blue));
  }

  setClock(periodLabel: string, time: string): void {
    this.setText(this.period, periodLabel);
    this.setText(this.timer, time);
  }

  setInfo(html: string): void {
    this.setHtml(this.info, html);
  }

  setFps(fps: number): void {
    if (this.showFps) this.setText(this.fps, `${Math.round(fps)} fps`);
  }

  /**
   * Match-start hint: a small chip with the key controls that fades out. The full controls panel never opens on its
   * own (it would cover the field while the match starts); players open it with `?`.
   */
  showIntro(seconds: number): () => void {
    this.hint.innerHTML = `<kbd>?</kbd> controls &nbsp;·&nbsp; <kbd>V</kbd> camera &nbsp;·&nbsp; <kbd>P</kbd> pause`;
    this.hint.classList.remove('hidden', 'fade');
    const fade = setTimeout(() => this.hint.classList.add('fade'), seconds * 1000);
    const hide = setTimeout(() => this.hint.classList.add('hidden'), seconds * 1000 + 700);
    return () => {
      clearTimeout(fade);
      clearTimeout(hide);
    };
  }

  showBanner(text: string, seconds = 2, cls = ''): void {
    this.banner.textContent = text;
    this.banner.className = `hud-banner show ${cls}`;
    this.bannerTimer = seconds;
  }

  /** With `key`, a toast already showing under that key is updated in place instead of stacking another one. */
  toast(msg: string, kind: ToastKind = 'info', alliance?: Alliance, key?: string): void {
    let el = key ? this.keyed.get(key) : undefined;
    if (!el || !el.isConnected) {
      el = document.createElement('div');
      this.toasts.prepend(el);
      if (key) this.keyed.set(key, el);
    }
    el.className = `hud-toast ${kind} ${alliance ?? ''}`;
    el.textContent = msg;
    while (this.toasts.children.length > 6) this.toasts.lastElementChild?.remove();
    const shown = el, stamp = (Number(shown.dataset.stamp ?? 0) + 1).toString();
    shown.dataset.stamp = stamp;
    setTimeout(() => { if (shown.dataset.stamp === stamp) shown.classList.add('fade'); }, 3200);
    setTimeout(() => { if (shown.dataset.stamp === stamp) shown.remove(); }, 3800);
  }
  private readonly keyed = new Map<string, HTMLElement>();

  /** An AI radio callout ("Blue 2: AMPLIFY in 3"), newest at the bottom; fades after a few seconds. */
  radio(from: string, text: string, alliance: Alliance): void {
    const el = document.createElement('div');
    el.className = `hud-radio-msg ${alliance}`;
    el.innerHTML = `<b>${esc(from)}</b> ${esc(text)}`;
    this.radioLog.append(el);
    while (this.radioLog.children.length > 5) this.radioLog.firstElementChild?.remove();
    setTimeout(() => el.classList.add('fade'), 5000);
    setTimeout(() => el.remove(), 5600);
  }

  toggleHelp(force?: boolean): void {
    this.help.classList.toggle('hidden', force === undefined ? undefined : !force);
  }

  update(dt: number): void {
    if (this.bannerTimer > 0) {
      this.bannerTimer -= dt;
      if (this.bannerTimer <= 0) this.banner.classList.remove('show');
    }
  }

  showModal(title: string, bodyHtml: string, buttons: ModalButton[]): void {
    this.modal.innerHTML = `<div class="hud-modal-card"><h2>${esc(title)}</h2><div class="hud-modal-body">${bodyHtml}</div><div class="hud-modal-buttons"></div></div>`;
    const bar = this.modal.querySelector('.hud-modal-buttons')!;
    for (const b of buttons) {
      const btn = document.createElement('button');
      btn.textContent = b.label;
      if (b.primary) btn.className = 'primary';
      btn.addEventListener('click', b.onClick);
      bar.appendChild(btn);
    }
    this.modal.classList.remove('hidden');
  }

  hideModal(): void {
    this.modal.classList.add('hidden');
  }

  get modalOpen(): boolean {
    return !this.modal.classList.contains('hidden');
  }

  static resultsHtml(r: MatchResults, scores: Record<Alliance, number>): string {
    const w = r.winner === 'tie' ? 'TIE' : `${r.winner.toUpperCase()} WINS`;
    const rows = r.rows
      .map((row) => `<tr class="${row.emphasis ? 'em' : ''}"><td class="red">${esc(String(row.red))}</td><th>${esc(row.label)}</th><td class="blue">${esc(String(row.blue))}</td></tr>`)
      .join('');
    const rp = (a: Alliance) => `<div class="rp ${a}"><b>${r.rp[a]} RP</b><div>${r.rpDetail[a].map(esc).join('<br>') || '—'}</div></div>`;
    return `
      <div class="results-winner ${r.winner}">${w}</div>
      <div class="results-scores"><span class="red">${scores.red}</span><span class="dash">–</span><span class="blue">${scores.blue}</span></div>
      <table class="results-table">${rows}</table>
      <div class="results-rp">${rp('red')}${rp('blue')}</div>
      ${Hud.playersHtml(r)}`;
  }

  /** Per-player breakdown: one card per robot, grouped by alliance. */
  static playersHtml(r: MatchResults): string {
    if (!r.players?.length) return '';
    const card = (p: PlayerResults) => {
      const rows = p.rows.map((x) => `<tr class="${x.value ? '' : 'zero'}"><th>${esc(x.label)}</th><td>${x.value}</td></tr>`).join('');
      const stats = p.stats.map((x) => `<tr><th>${esc(x.label)}</th><td>${esc(String(x.value))}</td></tr>`).join('');
      return `<div class="player-card ${p.alliance}">
        <div class="player-head"><span class="player-name">${esc(p.name)}</span><span class="player-team">#${p.team}</span><b class="player-total">${p.total}</b></div>
        <table class="player-table">${rows}</table>
        <table class="player-table stats">${stats}</table>
      </div>`;
    };
    const col = (a: Alliance) => {
      const mine = r.players!.filter((p) => p.alliance === a);
      if (!mine.length) return '';
      const rest = r.uncredited?.[a] ?? 0;
      return `<div class="players-col ${a}">${mine.map(card).join('')}${rest ? `<div class="players-rest">${rest} pts not credited to a player</div>` : ''}</div>`;
    };
    return `<h3 class="results-sub">Player breakdown</h3><div class="results-players">${col('red')}${col('blue')}</div>`;
  }

  dispose(): void {
    this.root.remove();
  }
}
