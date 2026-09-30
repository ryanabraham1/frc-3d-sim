import type { GameSettings, SeasonDefinition } from '@engine/core/season';
import { SLOTS, slotAlliance, slotLabel, slotStation, type SlotId } from '@engine/net/protocol';
import type { LobbyController } from './lobby';
import './multiplayer.css';

/** Multiplayer page for the menu (create/join a room, then the lobby). Kept separate from menu.ts. */

const NAME_KEY = 'frc-sim-name';
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

function loadName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? '';
  } catch {
    return '';
  }
}
function saveName(n: string): void {
  try {
    localStorage.setItem(NAME_KEY, n);
  } catch {
    /* ignore */
  }
}

export interface MpPageCtx {
  s: GameSettings;
  season: SeasonDefinition;
  rerender(): void;
  /** Switch menu page (e.g. to edit the robot on the Single player page). */
  goto(page: 'play'): void;
}

export function multiplayerPage(lobby: LobbyController, ctx: MpPageCtx): { body: string; footer: string } {
  lobby.settings = ctx.s;
  const err = lobby.error ? `<div class="mp-error">${esc(lobby.error)}</div>` : '';

  if (lobby.status !== 'lobby' || !lobby.lobby) {
    if (lobby.serverState === 'unknown') queueMicrotask(() => void lobby.wake());
    const busy = lobby.status === 'connecting';
    const server = {
      unknown: '<span class="mp-dot"></span>Checking server…',
      waking: `<span class="mp-dot waking"></span>Waking up the multiplayer server… <span data-mp="wake-seconds">${lobby.wakeSeconds}s</span> <span class="dim">(free servers sleep when idle — about a minute)</span>`,
      online: '<span class="mp-dot on"></span>Server online',
      offline: '<span class="mp-dot off"></span>Server unreachable <button class="link" data-mp="retry">Retry</button>',
    }[lobby.serverState];
    return {
      body: `
      <div class="mp-grid">
        <section class="panel mp-card">
          <div class="panel-head"><span>Play online</span></div>
          <div class="mp-pad">
            ${err}
            <div class="mp-server">${server}</div>
            <label class="mp-field"><span>Your name</span><input data-mp="name" maxlength="24" placeholder="Driver name" value="${esc(loadName())}"/></label>
            <div class="mp-row">
              <button class="bbtn primary mp-grow" data-mp="create" ${busy ? 'disabled' : ''}>Create room</button>
            </div>
            <div class="mp-or"><span>or join a friend</span></div>
            <div class="mp-row">
              <input class="mp-code" data-mp="code" maxlength="4" placeholder="CODE" autocomplete="off" spellcheck="false"/>
              <button class="bbtn mp-grow" data-mp="join" ${busy ? 'disabled' : ''}>Join</button>
            </div>
            ${busy ? `<div class="mp-hint">${lobby.serverState === 'waking' ? 'Connecting as soon as the server is up…' : 'Connecting…'}</div>` : ''}
            <details class="mp-adv"><summary>Relay server</summary>
              <label class="mp-field"><span>WebSocket URL</span><input data-mp="url" value="${esc(lobby.relayUrl)}" spellcheck="false"/></label>
              <div class="mp-hint">Defaults to this site's own <code>/ws</code>. Everyone in a room must use the same relay.</div>
            </details>
          </div>
        </section>
        <section class="panel mp-card">
          <div class="panel-head"><span>How it works</span></div>
          <ol class="mp-steps">
            <li>One player <b>creates a room</b> and shares the 4-letter code.</li>
            <li>Everyone picks a <b>driver station</b> (or spectates). Up to 6 drivers, 3 per alliance.</li>
            <li>Your robot is the one set up on the <b>Single player</b> page — size, speed, launcher, climber and AUTO choice.</li>
            <li>The host's computer runs the match; keep that tab open.</li>
          </ol>
        </section>
      </div>`,
      footer: `<button class="bbtn" data-page="play"><kbd>Esc</kbd>Back</button><span class="spacer"></span>`,
    };
  }

  lobby.syncMine();
  const L = lobby.lobby;
  const me = lobby.me;
  const byslot = new Map<SlotId, (typeof L.players)[number]>();
  for (const p of L.players) if (p.slot) byslot.set(p.slot, p);
  const slotBtn = (slot: SlotId) => {
    const p = byslot.get(slot);
    const mine = p && p.peerId === me?.peerId;
    const a = slotAlliance(slot);
    if (p)
      return `<div class="mp-slot ${a} taken ${mine ? 'mine' : ''}"><span class="st">${slotStation(slot)}</span><div class="who"><b>${esc(p.name)}${p.host ? ' <i>host</i>' : ''}</b><span>Team ${p.team || '—'}</span></div>${mine ? '<span class="you">You</span>' : ''}</div>`;
    return `<button class="mp-slot ${a} open" data-slot="${slot}"><span class="st">${slotStation(slot)}</span><div class="who"><b>Open</b><span>Take ${slotLabel(slot)}</span></div></button>`;
  };
  const spectators = L.players.filter((p) => !p.slot);
  const r = ctx.s.robot;
  const routine = ctx.season.autoRoutines.find((x) => x.id === ctx.s.autoRoutine);
  const drivers = L.players.filter((p) => p.slot).length;

  const body = `
    ${err}
    <div class="mp-room">
      <div><div class="mp-room-label">Room code</div><div class="mp-room-code">${esc(L.room)}</div></div>
      <button class="bbtn" data-mp="copy">Copy code</button>
      <div class="mp-room-meta">${L.players.length} player${L.players.length === 1 ? '' : 's'} · ${drivers} driving${L.inMatch ? ' · <b>match in progress</b>' : ''}</div>
    </div>
    <div class="mp-grid">
      <section class="panel">
        <div class="panel-head"><span>Driver stations</span></div>
        <div class="mp-slots">
          <div class="mp-col">${SLOTS.filter((s) => s.startsWith('red')).map(slotBtn).join('')}</div>
          <div class="mp-col">${SLOTS.filter((s) => s.startsWith('blue')).map(slotBtn).join('')}</div>
        </div>
        <div class="mp-pad mp-spec">
          <div><b>Spectators</b> <span class="dim">${spectators.length ? spectators.map((p) => esc(p.name) + (p.host ? ' (host)' : '')).join(', ') : 'none'}</span></div>
          ${me?.slot ? `<button class="opt" data-slot="">Spectate instead</button>` : ''}
        </div>
      </section>
      <div class="col">
        <section class="panel">
          <div class="panel-head"><span>Your robot</span><button class="link" data-mp="edit">Edit on Single player page</button></div>
          <div class="mp-pad mp-robot">
            <div class="mp-team">${r.teamNumber}</div>
            <div>
              <div>${(r.maxSpeed / 0.3048).toFixed(1)} ft/s · ${r.hopperCapacity} ${esc(ctx.season.gamePiece.name)} · ${r.launcher.rate}/s · ${r.climber.maxLevel ? `climbs L${r.climber.maxLevel}` : 'no climber'}</div>
              <div class="dim">AUTO: ${ctx.s.manualAuto ? 'you drive' : esc(routine?.label ?? ctx.s.autoRoutine)}</div>
            </div>
          </div>
        </section>
        <section class="panel">
          <div class="panel-head"><span>Match options</span>${lobby.isHost ? '' : '<span class="dim" style="margin-left:auto">set by host</span>'}</div>
          <div class="mp-pad">
            <div class="group"><div class="label">Human players</div>
              <div class="seg">
                <button class="opt ${L.autoHumanPlayer ? 'on' : ''}" data-hp="1" ${lobby.isHost ? '' : 'disabled'}>Automatic</button>
                <button class="opt ${!L.autoHumanPlayer ? 'on' : ''}" data-hp="0" ${lobby.isHost ? '' : 'disabled'}>Drivers press H</button>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>`;

  const footer =
    `<button class="bbtn" data-mp="leave">${lobby.isHost ? 'Close room' : 'Leave room'}</button><span class="spacer"></span>` +
    (lobby.isHost
      ? `<span class="mp-hint">${lobby.canStart() ? '' : 'At least one player needs a driver station'}</span><button class="bbtn primary" data-mp="start" ${lobby.canStart() ? '' : 'disabled'}>Start match</button>`
      : `<span class="mp-hint">${L.inMatch ? 'Match in progress — you’ll join the next one' : 'Waiting for the host to start…'}</span>`);
  return { body, footer };
}

export function bindMultiplayer(el: HTMLElement, lobby: LobbyController, ctx: MpPageCtx): void {
  const q = <T extends HTMLElement>(k: string) => el.querySelector<T>(`[data-mp="${k}"]`);
  const name = () => {
    const n = (q<HTMLInputElement>('name')?.value ?? '').trim() || 'Player';
    saveName(n);
    return n;
  };
  const url = q<HTMLInputElement>('url');
  if (url)
    url.onchange = () => {
      lobby.relayUrl = url.value.trim();
      lobby.serverState = 'unknown';
      void lobby.wake(true);
    };
  const retry = q('retry');
  if (retry) retry.onclick = () => void lobby.wake(true);
  const create = q('create');
  if (create) create.onclick = () => void lobby.create(name());
  const code = q<HTMLInputElement>('code');
  const join = q('join');
  if (join && code) {
    code.oninput = () => (code.value = code.value.toUpperCase().replace(/[^A-Z]/g, ''));
    const go = () => {
      if (code.value.length !== 4) {
        lobby.error = 'Enter the 4-letter room code';
        ctx.rerender();
        return;
      }
      void lobby.join(code.value, name());
    };
    join.onclick = go;
    code.onkeydown = (e) => e.key === 'Enter' && go();
  }
  el.querySelectorAll<HTMLElement>('[data-slot]').forEach((b) => (b.onclick = () => lobby.pickSlot((b.dataset.slot || null) as SlotId | null)));
  el.querySelectorAll<HTMLElement>('[data-hp]').forEach((b) => (b.onclick = () => lobby.setAutoHumanPlayer(b.dataset.hp === '1')));
  const copy = q('copy');
  if (copy)
    copy.onclick = () => {
      void navigator.clipboard?.writeText(lobby.lobby?.room ?? '');
      copy.textContent = 'Copied';
    };
  const edit = q('edit');
  if (edit) edit.onclick = () => ctx.goto('play');
  const leave = q('leave');
  if (leave) leave.onclick = () => lobby.leave();
  const start = q('start');
  if (start) start.onclick = () => lobby.startMatch();
}
