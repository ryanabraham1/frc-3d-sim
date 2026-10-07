import { currentStep, draftDone, draftOptions, MODE_LABEL, MODE_SIZE, PLACEMENT_GAMES, RANKED_MODES, tierOf, teamOf, type RankedMode } from '@engine/net/ranked';
import { slotLabel, type SlotId } from '@engine/net/protocol';
import type { LobbyController } from './lobby';
import type { MpPageCtx } from './multiplayer';
import { rankedPool } from './rankedPool';

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

export function tierBadge(rating: number, games: number): string {
  const t = tierOf(rating, games);
  return t
    ? `<span class="rk-tier" style="--tier:${t.color}">${t.name}</span>`
    : `<span class="rk-tier unranked">Placement ${Math.min(games, PLACEMENT_GAMES)}/${PLACEMENT_GAMES}</span>`;
}

const fmtTime = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}`;

function leaderboardHtml(lobby: LobbyController): string {
  const rows = lobby.ranked.leaderboard;
  if (rows === null) return '<div class="rl-empty"><span class="mp-dot waking"></span>Loading leaderboard…</div>';
  if (!rows.length) return `<div class="rl-empty">Nobody has finished ${PLACEMENT_GAMES} ${MODE_LABEL[lobby.ranked.mode]} matches yet.<br/>Be the first on the board.</div>`;
  return `<table class="rk-board"><thead><tr><th>#</th><th>Player</th><th>Rating</th><th>W-L-D</th></tr></thead><tbody>${rows
    .map(
      (r, i) =>
        `<tr class="${r.me ? 'me' : ''}"><td>${i + 1}</td><td>${esc(r.name)}${r.me ? ' <i>you</i>' : ''}<br/>${tierBadge(r.rating, r.games)}</td><td><b>${r.rating}</b></td><td>${r.wins}-${r.losses}-${r.draws}</td></tr>`,
    )
    .join('')}</tbody></table>`;
}

function lastResultHtml(lobby: LobbyController): string {
  const r = lobby.ranked.lastResult;
  if (!r) return '';
  if (r.status === 'void') return `<div class="rk-result void"><b>Match voided</b><span>${esc(r.reason ?? 'No rating change.')}</span></div>`;
  const sign = r.delta > 0 ? '+' : '';
  const title = r.result === 'win' ? 'Victory' : r.result === 'draw' ? 'Draw' : r.result === 'abandon' ? 'You left the match' : r.result === 'none' ? 'Match ended' : 'Defeat';
  return `<div class="rk-result ${r.delta > 0 ? 'up' : r.delta < 0 ? 'down' : ''}"><b>${title}</b><span>${r.before} → <b>${r.after}</b> (${sign}${r.delta})${r.status === 'abandoned' && r.result !== 'abandon' ? ' · opponent left' : ''}</span></div>`;
}

export function rankedLandingPage(lobby: LobbyController, _ctx: MpPageCtx): { body: string; footer: string } {
  const R = lobby.ranked;
  const err = lobby.error ? `<div class="mp-error">${esc(lobby.error)}</div>` : '';
  if (lobby.serverState === 'unknown') queueMicrotask(() => void lobby.wake());
  if (lobby.serverState === 'online') queueMicrotask(() => lobby.browse());
  const mine = R.profile?.ratings[R.mode];
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
    : `<button class="bbtn primary mp-big" data-mp="find" ${busy || !online ? 'disabled' : ''}>Find ${MODE_LABEL[R.mode]} match<small>Matched by rating · draft your robot · placed on the ladder</small></button>`;
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
              const r = R.profile?.ratings[m];
              return `<button class="opt ${m === R.mode ? 'on' : ''}" data-rk-mode="${m}" ${R.searching ? 'disabled' : ''}>${MODE_LABEL[m]}<small>${r ? r.rating : '—'}</small></button>`;
            }).join('')}
          </div>
          <div class="rk-me">
            <div class="rk-rating">${mine ? mine.rating : '—'}</div>
            <div>${mine ? tierBadge(mine.rating, mine.games) : ''}<div class="dim">${mine ? `${mine.wins}W ${mine.losses}L ${mine.draws}D · peak ${mine.peak}` : 'Sign in by searching once'}</div></div>
          </div>
          ${lastResultHtml(lobby)}
          ${search}
        </div>
      </section>
      <div class="col">
        <section class="panel mp-card">
          <div class="panel-head"><span>${MODE_LABEL[R.mode]} leaderboard</span></div>
          <div class="rl-list" data-mp="leaderboard">${online ? leaderboardHtml(lobby) : '<div class="rl-empty">Connect to see the leaderboard.</div>'}</div>
        </section>
        <section class="panel mp-card">
          <div class="panel-head"><span>How ranked works</span></div>
          <ol class="mp-steps">
            <li>You’re matched with players near your rating; the search widens the longer you wait. Teams are balanced.</li>
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
      <div class="who"><b>${esc(p.name)}${p.peerId === me?.peerId ? ' (you)' : ''}</b><span>${slotLabel(slot)} · ${p.rating ?? '—'} ${p.games !== undefined && p.games < PLACEMENT_GAMES ? '(placing)' : ''}</span></div>
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
    const summary = (ctx.season.robotSummary ? ctx.season.robotSummary(e.config) : '') || e.description.split(/(?<=\.)\s/)[0];
    return `<button class="rk-card ${ban ? 'banned' : ''} ${taken ? 'taken' : ''} ${clickable ? 'go' : ''} ${clickable && step?.kind === 'ban' ? 'banning' : ''}" data-draft="${esc(id)}" ${clickable ? '' : 'disabled'} title="${esc(e.description)}">
      <span class="rk-card-tag">${esc(e.tag)}</span><b>${esc(e.label)}</b><span class="rk-card-sum">${esc(summary)}</span>${state ? `<span class="rk-card-state">${esc(state)}</span>` : ''}
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
        localStorage.setItem(NAME_KEY, name);
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
