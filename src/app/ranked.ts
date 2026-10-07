import { currentStep, draftDone, draftOptions, MODE_LABEL, MODE_SIZE, PLACEMENT_GAMES, RANKED_MODES, rankFor, teamOf, visibleRank, type RankedMode } from '@engine/net/ranked';
import { nameProblem } from '@engine/net/nameFilter';
import { slotLabel, type SlotId } from '@engine/net/protocol';
import type { LobbyController } from './lobby';
import type { MpPageCtx } from './multiplayer';
import { emblemSvg, rankChip } from './rankEmblem';
import { getSeason } from '@seasons/index';
import { RANKED_SEASON_ID } from '@engine/net/ranked';
import { rankedPool } from './rankedPool';

/** Draft thumbnails already rendered (id → data URL), so a redraw of the page doesn't blank them. */
const thumbCache = new Map<string, string>();

/**
 * Render every draftable robot's 3D thumbnail in the background (serialized on one GL context, cached). Called when a
 * search starts, so the cards are ready by the time the draft opens.
 */
export function prefetchDraftThumbs(): void {
  const season = getSeason(RANKED_SEASON_ID);
  void import('./robotPreview').then((m) => {
    for (const e of rankedPool(season)) {
      if (thumbCache.has(e.id)) continue;
      void m.robotThumb(season, e.config, 'blue').then((url) => thumbCache.set(e.id, url)).catch(() => undefined);
    }
  });
}

const tierBadge = (rating: number, games: number): string => rankChip(rating, games);

/** Ranked pages for the menu: landing (rating, queue, leaderboard), the ban/pick draft, and "match found". */

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const NAME_KEY = 'frc-sim-name';
function savedName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? '';
  } catch {
    return '';
  }
}

const fmtTime = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}`;

const MEDAL = ['🥇', '🥈', '🥉'];

function leaderboardHtml(lobby: LobbyController): string {
  const rows = lobby.ranked.leaderboard;
  if (rows === null) return '<div class="rl-empty"><span class="mp-dot waking"></span>Loading leaderboard…</div>';
  if (!rows.length) return `<div class="rl-empty">Nobody has played a ranked match yet.<br/>Be the first on the board.</div>`;
  const podium = rows
    .slice(0, 3)
    .map((r, i) => `<div class="rk-pod p${i + 1} ${r.me ? 'me' : ''}"><span class="medal">${MEDAL[i]}</span><b>${esc(r.name)}</b><span class="rk-pod-rating">${r.rating}</span>${tierBadge(r.rating, r.games)}</div>`)
    .join('');
  const rest = rows.slice(3);
  const you = lobby.ranked.standing;
  const youOnBoard = rows.some((r) => r.me);
  return `<div class="rk-podium">${podium}</div>${
    rest.length
      ? `<table class="rk-board"><thead><tr><th>#</th><th>Player</th><th>Rating</th><th>W-L-D</th></tr></thead><tbody>${rest
          .map((r, i) => `<tr class="${r.me ? 'me' : ''}"><td>${i + 4}</td><td>${esc(r.name)}${r.me ? ' <i>you</i>' : ''}<br/>${tierBadge(r.rating, r.games)}</td><td><b>${r.rating}</b></td><td>${r.wins}-${r.losses}-${r.draws}</td></tr>`)
          .join('')}</tbody></table>`
      : ''
  }${you && !youOnBoard ? `<div class="rk-you">Your rank: <b>#${you.rank}</b> of ${you.total} · ${you.rating}</div>` : ''}`;
}

function lastResultHtml(lobby: LobbyController): string {
  const r = lobby.ranked.lastResult;
  if (!r) return '';
  if (r.status === 'void') return `<div class="rk-result void"><b>Match voided</b><span>${esc(r.reason ?? 'No rating change.')}</span></div>`;
  const sign = r.delta > 0 ? '+' : '';
  const title = r.result === 'win' ? 'Victory' : r.result === 'draw' ? 'Draw' : r.result === 'abandon' ? 'You left the match' : r.result === 'none' ? 'Match ended' : 'Defeat';
  const points = `${r.before} → <b>${r.after}</b> (${sign}${r.delta})${r.status === 'abandoned' && r.result !== 'abandon' ? ' · opponent left' : ''}`;
  const { rankBefore: from, rankAfter: to } = r;
  // Rank movement gets its own celebration (or a gentler note for a demotion).
  let move: 'up' | 'down' | 'placed' | null = null;
  if (to && !from) move = 'placed';
  else if (to && from && to.ordinal > from.ordinal) move = 'up';
  else if (to && from && to.ordinal < from.ordinal) move = 'down';
  const card = `<div class="rk-result ${r.delta > 0 ? 'up' : r.delta < 0 ? 'down' : ''}"><b>${title}</b><span>${points}</span></div>`;
  if (!move || !to) return card;
  const heading = move === 'up' ? 'Rank up!' : move === 'placed' ? 'Placement complete' : 'Rank down';
  const line = move === 'placed' ? `You placed <b>${to.label}</b>` : `${from!.label} → <b>${to.label}</b>`;
  const burst = move === 'down' ? '' : `<div class="rk-burst" style="--tier:${to.tier.color}">${Array.from({ length: 14 }, (_, i) => `<i style="--a:${i * (360 / 14)}deg;--d:${i % 2 ? 54 : 74}px"></i>`).join('')}</div>`;
  return `${card}<div class="rk-rankup ${move}" style="--tier:${to.tier.color}">${burst}${emblemSvg(to, { size: 92, pop: true })}<div><b>${heading}</b><span>${line}</span></div></div>`;
}

/** All-time record for the season, the leaderboard position, and the record in each mode. */
function statsPanelHtml(lobby: LobbyController): string {
  const profile = lobby.ranked.profile;
  if (!profile) return '<div class="rl-empty"><span class="mp-dot waking"></span>Loading your stats…</div>';
  const r = profile.rating;
  if (!r.games) return '<div class="rl-empty">No ranked matches yet.<br/>Your record and place on the leaderboard show up here after your first one.</div>';
  const pct = (w: number, g: number) => (g ? `${Math.round((w / g) * 100)}%` : '—');
  const peakRank = visibleRank(r.peak, r.games);
  const st = profile.standing;
  const rows = RANKED_MODES.map((m) => {
    const x = r.modes[m];
    if (!x.games) return `<tr class="idle"><td>${MODE_LABEL[m]}</td><td colspan="3" class="dim">Not played</td></tr>`;
    return `<tr><td>${MODE_LABEL[m]}</td><td>${x.games}</td><td>${x.wins}-${x.losses}-${x.draws}</td><td>${pct(x.wins, x.games)}</td></tr>`;
  }).join('');
  return `<div class="rk-stats">
    <div class="rk-stat wide"><b>${st ? `#${st.rank}` : '—'}</b><span>${st ? `of ${st.total} on the leaderboard` : 'finish placement to join the leaderboard'}</span></div>
    <div class="rk-stat"><b>${r.games}</b><span>matches</span></div>
    <div class="rk-stat"><b>${r.wins}</b><span>wins</span></div>
    <div class="rk-stat"><b>${r.losses}</b><span>losses</span></div>
    <div class="rk-stat"><b>${pct(r.wins, r.games)}</b><span>win rate</span></div>
    <div class="rk-stat wide"><b>${r.peak}</b><span>peak rating${peakRank ? ` · ${esc(peakRank.label)}` : ''}</span></div>
  </div>
  <table class="rk-board rk-modes-table"><thead><tr><th>Mode</th><th>Played</th><th>W-L-D</th><th>Win%</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function meCardHtml(lobby: LobbyController): string {
  const R = lobby.ranked;
  const mine = R.profile?.rating;
  if (!mine) return '<div class="rk-me"><div class="dim">Search once to get on the ladder.</div></div>';
  const rank = visibleRank(mine.rating, mine.games);
  const info = rank ?? rankFor(mine.rating);
  const bar = rank
    ? `<div class="rk-bar" style="--tier:${rank.tier.color};--p:${rank.progress}"><i></i></div><div class="rk-bar-text">${rank.next ? `${rank.points}/50 · next <b>${esc(rank.next)}</b>` : `Apex · +${rank.points} over the line`}</div>`
    : `<div class="rk-bar placing" style="--p:${mine.games / PLACEMENT_GAMES}"><i></i></div><div class="rk-bar-text">Play ${PLACEMENT_GAMES - mine.games} more match${PLACEMENT_GAMES - mine.games === 1 ? '' : 'es'} to reveal your rank</div>`;
  return `<div class="rk-me" style="--tier:${info.tier.color}">
    ${emblemSvg(rank, { size: 104 })}
    <div class="rk-me-info"><div class="rk-rank-name">${rank ? esc(rank.label) : 'Unranked'}</div><div class="rk-rating">${mine.rating}<small>rating</small></div>${bar}<div class="dim">${mine.wins}W ${mine.losses}L ${mine.draws}D · peak ${mine.peak}</div></div>
  </div>`;
}

export function rankedLandingPage(lobby: LobbyController, _ctx: MpPageCtx): { body: string; footer: string } {
  const R = lobby.ranked;
  const err = lobby.error ? `<div class="mp-error">${esc(lobby.error)}</div>` : '';
  if (lobby.serverState === 'unknown') queueMicrotask(() => void lobby.wake());
  if (lobby.serverState === 'online') queueMicrotask(() => lobby.browse());
  const busy = lobby.status === 'connecting';
  const online = lobby.serverState === 'online';
  const server = {
    unknown: '<span class="mp-dot"></span>Checking server…',
    waking: `<span class="mp-dot waking"></span>Waking up the server… <span data-mp="wake-seconds">${lobby.wakeSeconds}s</span>`,
    online: '<span class="mp-dot on"></span>Server online',
    offline: '<span class="mp-dot off"></span>Server unreachable <button class="link" data-mp="retry">Retry</button>',
  }[lobby.serverState];
  const need = MODE_SIZE[R.mode] * 2;
  const search = R.searching
    ? `<div class="rk-search"><span class="mp-dot waking"></span><div><b>Searching ${MODE_LABEL[R.mode]}…</b><span><span data-mp="search-timer">0:00</span> · <span data-mp="queue-count">${R.waiting}</span> in queue (need ${need})</span></div></div>
       <button class="bbtn mp-grow" data-mp="cancel-search">Cancel search</button>`
    : `<button class="bbtn primary mp-big" data-mp="find" ${busy || !online ? 'disabled' : ''}>Find ${MODE_LABEL[R.mode]} match<small>One rating across every mode · draft your robot</small></button>`;
  return {
    body: `
    <div class="mp-grid" data-mp="ranked-page">
      <section class="panel mp-card">
        <div class="panel-head"><span>Ranked</span></div>
        <div class="mp-pad">
          ${err}
          <div class="mp-server">${server}</div>
          ${R.profile && !R.profile.persistent ? '<div class="mp-hint">This server isn’t saving ratings yet — they reset when it restarts.</div>' : ''}
          <label class="mp-field"><span>Your name</span><input data-mp="name" maxlength="24" placeholder="Driver name" value="${esc(savedName() || lobby.playerName)}" ${R.searching ? 'disabled' : ''}/></label>
          <div class="seg rk-modes" role="group" aria-label="Ranked mode">
            ${RANKED_MODES.map((m) => {
              const played = R.profile?.rating.modes[m].games;
              return `<button class="opt ${m === R.mode ? 'on' : ''}" data-rk-mode="${m}" ${R.searching ? 'disabled' : ''}>${MODE_LABEL[m]}<small>${played ? `${played} played` : 'queue'}</small></button>`;
            }).join('')}
          </div>
          ${meCardHtml(lobby)}
          ${lastResultHtml(lobby)}
          ${search}
        </div>
      </section>
      <div class="col">
        <section class="panel mp-card">
          <div class="panel-head"><span>Your all-time stats</span></div>
          <div class="rl-list" data-mp="stats">${online ? statsPanelHtml(lobby) : '<div class="rl-empty">Connect to see your stats.</div>'}</div>
        </section>
        <section class="panel mp-card">
          <div class="panel-head"><span>${getSeason(RANKED_SEASON_ID).year} leaderboard</span></div>
          <div class="rl-list" data-mp="leaderboard">${online ? leaderboardHtml(lobby) : '<div class="rl-empty">Connect to see the leaderboard.</div>'}</div>
        </section>
        <section class="panel mp-card">
          <div class="panel-head"><span>How ranked works</span></div>
          <ol class="mp-steps">
            <li>One rating and one leaderboard per year, whichever mode you queue. You’re matched near your rating; the search widens the longer you wait, and teams are balanced.</li>
            <li>In team modes the change is shared by skill: if you carry a weaker teammate and lose, you lose less; they lose more.</li>
            <li>Both sides <b>ban</b> robots, then <b>pick</b> theirs in snake order. A robot can only be picked once per alliance.</li>
            <li>Choose your starting position, then play. Everyone reports the result; the rating moves only if they agree.</li>
            <li><b>Leaving a match counts as a loss.</b> A dropped connection has 30 seconds to come back.</li>
          </ol>
        </section>
      </div>
    </div>`,
    footer: `<button class="bbtn" data-page="play"><kbd>Esc</kbd>Back</button><span class="spacer"></span>`,
  };
}

export function rankedWaitingPage(): { body: string; footer: string } {
  return {
    body: '<div class="rk-found"><span class="mp-dot waking"></span><h2>Match found</h2><p>Setting up the draft…</p></div>',
    footer: '<button class="bbtn" data-mp="leave">Leave match</button><span class="spacer"></span>',
  };
}

export function rankedDraftPage(lobby: LobbyController, ctx: MpPageCtx): { body: string; footer: string } {
  const L = lobby.lobby!;
  const R = L.ranked!;
  const d = R.draft;
  const me = lobby.me;
  const step = currentStep(d);
  const pool = rankedPool(ctx.season);
  const byId = new Map(pool.map((e) => [e.id, e]));
  const myTurn = !!step && !!me?.slot && step.slot === me.slot;
  const options = new Set(myTurn && me?.slot ? draftOptions(d, me.slot) : []);
  const err = lobby.error ? `<div class="mp-error">${esc(lobby.error)}</div>` : '';
  const who = (slot: SlotId) => L.players.find((p) => p.slot === slot);
  const turnName = step ? `${who(step.slot)?.name ?? slotLabel(step.slot)} (${slotLabel(step.slot)})` : '';
  const banner = draftDone(d)
    ? 'Draft complete'
    : myTurn
      ? `Your turn — ${step!.kind === 'ban' ? 'ban a robot' : 'pick your robot'}`
      : `${esc(turnName)} is ${step!.kind === 'ban' ? 'banning' : 'picking'}…`;

  const seatRow = (slot: SlotId) => {
    const p = who(slot);
    if (!p) return '';
    const pick = d.picks.find((x) => x.slot === slot);
    const ban = d.bans.filter((x) => x.slot === slot).map((x) => byId.get(x.id)?.label ?? x.id);
    const active = step?.slot === slot;
    return `<div class="rk-seat ${teamOf(slot)} ${active ? 'active' : ''} ${p.peerId === me?.peerId ? 'mine' : ''}">
      <div class="who"><b>${esc(p.name)}${p.peerId === me?.peerId ? ' (you)' : ''}</b><span>${slotLabel(slot)} · ${p.rating !== undefined ? rankChip(p.rating, p.games ?? 0, 18) : '—'}</span></div>
      <div class="picks">${pick ? `<span class="chip pick">${esc(byId.get(pick.id)?.label ?? pick.id)}</span>` : active && step?.kind === 'pick' ? '<span class="chip">picking…</span>' : ''}${ban.map((b) => `<span class="chip ban">✕ ${esc(b)}</span>`).join('')}</div>
    </div>`;
  };
  const teamCol = (team: 'red' | 'blue') =>
    `<div class="rk-team ${team}"><h3>${team === 'red' ? 'Red' : 'Blue'} alliance</h3>${(['1', '2', '3'] as const).slice(0, MODE_SIZE[d.mode]).map((n) => seatRow(`${team}${n}` as SlotId)).join('')}</div>`;

  const card = (id: string) => {
    const e = byId.get(id);
    if (!e) return '';
    const ban = d.bans.find((b) => b.id === id);
    const mineTeam = me?.slot ? teamOf(me.slot) : null;
    const taken = !ban && mineTeam && d.picks.some((p) => p.id === id && teamOf(p.slot) === mineTeam);
    const clickable = myTurn && options.has(id);
    const state = ban ? `Banned by ${slotLabel(ban.slot)}` : taken ? 'On your team' : '';
    const cached = thumbCache.get(id);
    return `<button class="rk-card ${ban ? 'banned' : ''} ${taken ? 'taken' : ''} ${clickable ? 'go' : ''} ${clickable && step?.kind === 'ban' ? 'banning' : ''}" data-draft="${esc(id)}" ${clickable ? '' : 'disabled'}>
      <span class="rk-card-img"><img alt="" data-draft-thumb="${esc(id)}" ${cached ? `src="${cached}"` : ''}/></span>
      <span class="rk-card-tag">${esc(e.tag)}</span><b>${esc(e.label)}</b>${state ? `<span class="rk-card-state">${esc(state)}</span>` : ''}
    </button>`;
  };

  return {
    body: `
    ${err}
    ${lobby.reconnecting ? '<div class="mp-error">Connection lost — reconnecting…</div>' : lobby.hostAway ? '<div class="mp-error">The host lost connection — waiting for them to return…</div>' : ''}
    <div class="rk-draft" data-mp="ranked-draft">
      <div class="rk-turn ${myTurn ? 'mine' : ''}">
        <div><div class="mp-room-label">${MODE_LABEL[R.mode]} ranked · ${step ? (step.kind === 'ban' ? 'Ban phase' : 'Pick phase') : 'Done'}</div><div class="rk-banner">${banner}</div></div>
        <div class="rk-clock"><span data-mp="turn-timer" data-ms="${R.turnMs}">${Math.ceil(R.turnMs / 1000)}</span>s</div>
      </div>
      <div class="rk-teams">${teamCol('red')}${teamCol('blue')}</div>
      <div class="rk-pool">${d.pool.map(card).join('')}</div>
    </div>`,
    footer: `<button class="bbtn" data-mp="leave">Leave match (counts as a loss)</button><span class="spacer"></span><span class="mp-hint">Turns time out automatically.</span>`,
  };
}

export function bindRanked(el: HTMLElement, lobby: LobbyController): void {
  el.querySelectorAll<HTMLElement>('[data-rk-mode]').forEach((b) => (b.onclick = () => lobby.setRankedMode(b.dataset.rkMode as RankedMode)));
  const nameInput = el.querySelector<HTMLInputElement>('[data-mp="name"]');
  if (nameInput) nameInput.oninput = () => (lobby.playerName = nameInput.value.trim());
  const find = el.querySelector<HTMLElement>('[data-mp="find"]');
  if (find)
    find.onclick = () => {
      const name = (nameInput?.value ?? '').trim() || 'Player';
      try {
        if (!nameProblem(name)) localStorage.setItem(NAME_KEY, name);
      } catch {
        /* ignore */
      }
      void lobby.findMatch(name);
    };
  const cancel = el.querySelector<HTMLElement>('[data-mp="cancel-search"]');
  if (cancel) cancel.onclick = () => lobby.cancelSearch();

  // Live counters that must not trigger a full re-render.
  const searchTimer = el.querySelector<HTMLElement>('[data-mp="search-timer"]');
  if (searchTimer) {
    const tick = () => {
      if (!searchTimer.isConnected) return clearInterval(id);
      searchTimer.textContent = fmtTime(Date.now() - lobby.ranked.searchStartedAt);
    };
    const id = setInterval(tick, 500);
    tick();
  }

  el.querySelectorAll<HTMLElement>('[data-draft]').forEach((b) => (b.onclick = () => lobby.draft(b.dataset.draft!)));
  // Fill in any thumbnail that isn't cached yet as it finishes rendering.
  const missing = Array.from(el.querySelectorAll<HTMLImageElement>('img[data-draft-thumb]')).filter((img) => !img.getAttribute('src'));
  if (missing.length) {
    const season = getSeason(RANKED_SEASON_ID);
    const pool = new Map(rankedPool(season).map((e) => [e.id, e]));
    void import('./robotPreview').then((m) => {
      for (const img of missing) {
        const e = pool.get(img.dataset.draftThumb ?? '');
        if (!e) continue;
        void m.robotThumb(season, e.config, 'blue').then((url) => {
          thumbCache.set(e.id, url);
          if (img.isConnected) img.src = url;
        }).catch(() => undefined);
      }
    });
  }
  const clock = el.querySelector<HTMLElement>('[data-mp="turn-timer"]');
  if (clock) {
    const start = performance.now();
    const total = Number(clock.dataset.ms) || 0;
    const tick = () => {
      if (!clock.isConnected) return clearInterval(id);
      clock.textContent = String(Math.max(0, Math.ceil((total - (performance.now() - start)) / 1000)));
    };
    const id = setInterval(tick, 250);
  }
}
