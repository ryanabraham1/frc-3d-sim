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
    const total = scores.red + scores.blue;
    const bluePct = total > 0 ? Math.round((scores.blue / total) * 100) : 50;
    const num = (v: string | number): number => (typeof v === 'number' ? v : /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : NaN);
    const rows = r.rows
      .map((row) => {
        const b = num(row.blue), rd = num(row.red);
        const both = Number.isFinite(b) && Number.isFinite(rd) && Math.abs(b) + Math.abs(rd) > 0;
        const bw = both ? Math.round((Math.abs(b) / (Math.abs(b) + Math.abs(rd))) * 100) : 0;
        const bar = both ? `<div class="res-bar"><i class="blue" style="width:${bw}%"></i><i class="red" style="width:${100 - bw}%"></i></div>` : '';
        const lead = both && b !== rd ? (b > rd ? 'lead-blue' : 'lead-red') : '';
        return `<div class="res-row ${row.emphasis ? 'em' : ''} ${lead}"><span class="blue">${esc(String(row.blue))}</span><div class="res-mid"><span class="res-label">${esc(row.label)}</span>${bar}</div><span class="red">${esc(String(row.red))}</span></div>`;
      })
      .join('');
    const rp = (a: Alliance) => `<div class="rp ${a}"><div class="rp-head"><span>${a.toUpperCase()}</span><b>${r.rp[a]} RP</b></div><div class="rp-detail">${r.rpDetail[a].map((d) => `<span class="chip">${esc(d)}</span>`).join('') || '<span class="chip dim">No bonus</span>'}</div></div>`;
    return `
      <div class="results-hero ${r.winner}">
        <div class="results-winner ${r.winner}">${w}</div>
        <div class="results-scores"><span class="blue">${scores.blue}</span><span class="dash">–</span><span class="red">${scores.red}</span></div>
        <div class="results-split" title="Share of total points"><i class="blue" style="width:${bluePct}%"></i><i class="red" style="width:${100 - bluePct}%"></i></div>
        <div class="results-names"><span class="blue">BLUE</span><span class="red">RED</span></div>
      </div>
      <div class="res-rows">${rows}</div>
      <div class="results-rp">${rp('blue')}${rp('red')}</div>
      ${Hud.playersHtml(r)}`;
  }

  /** Per-player breakdown: one card per robot, grouped by alliance, with share of the alliance's credited points. */
  static playersHtml(r: MatchResults): string {
    if (!r.players?.length) return '';
    const top = Math.max(...r.players.map((p) => p.total));
    const card = (p: PlayerResults) => {
      const allied = r.players!.filter((x) => x.alliance === p.alliance);
      const sum = allied.reduce((s, x) => s + x.total, 0) + (r.uncredited?.[p.alliance] ?? 0);
      const share = sum > 0 ? Math.round((p.total / sum) * 100) : 0;
      const peak = Math.max(1, ...p.rows.map((x) => x.value));
      const rows = p.rows
        .map((x) => `<div class="pc-row ${x.value ? '' : 'zero'}"><span>${esc(x.label)}</span><div class="pc-track"><i style="width:${Math.round((Math.max(0, x.value) / peak) * 100)}%"></i></div><b>${x.value}</b></div>`)
        .join('');
      const acc = p.stats.find((x) => x.label === 'Accuracy');
      const accPct = acc ? Number.parseInt(String(acc.value), 10) : NaN;
      const accHtml = Number.isFinite(accPct) ? `<div class="pc-acc"><span>Accuracy</span><div class="pc-track"><i style="width:${accPct}%"></i></div><b>${accPct}%</b></div>` : '';
      const chips = p.stats.filter((x) => x !== acc).map((x) => `<div class="pc-stat"><b>${esc(String(x.value))}</b><span>${esc(x.label)}</span></div>`).join('');
      const mvp = top > 0 && p.total === top ? '<span class="pc-mvp">TOP SCORER</span>' : '';
      return `<div class="player-card ${p.alliance}">
        <div class="player-head"><span class="player-name">${esc(p.name)}</span><span class="player-team">#${p.team}</span>${mvp}<b class="player-total">${p.total}</b></div>
        <div class="pc-share"><div class="pc-track"><i style="width:${share}%"></i></div><span>${share}% of ${p.alliance} credited points</span></div>
        <div class="pc-rows">${rows}</div>
        ${accHtml}
        <div class="pc-stats">${chips}</div>
      </div>`;
    };
    const col = (a: Alliance) => {
      const mine = r.players!.filter((p) => p.alliance === a);
      if (!mine.length) return '';
      const rest = r.uncredited?.[a] ?? 0;
      return `<div class="players-col ${a}">${mine.map(card).join('')}${rest ? `<div class="players-rest">${rest} pts not credited to a player</div>` : ''}</div>`;
    };
    return `<h3 class="results-sub">Player breakdown</h3><div class="results-players">${col('blue')}${col('red')}</div>`;
  }

  dispose(): void {
    this.root.remove();
  }
}
