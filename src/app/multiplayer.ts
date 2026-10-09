import { seasonLabel, type AiSkill, type GameSettings, type SeasonDefinition } from '@engine/core/season';
import { SLOTS, slotAlliance, slotLabel, slotStation, type SlotId } from '@engine/net/protocol';
import { footprint } from '@engine/robot/config';
import { footprintPoly } from '@engine/startPose';
import type { RoomListing, RoomVisibility } from '@engine/net/relayProtocol';
import { MAX_TITLE_LENGTH } from '@engine/net/relayProtocol';
import { nameProblem } from '@engine/net/nameFilter';
import type { LobbyController } from './lobby';
import { bindRanked, rankedDraftPage, rankedLandingPage, rankedWaitingPage } from './ranked';
import { bindHeadingControls, bindPlacementMap, headingControls, placementMap, placementProblems, playerSpot, rotateSpot, syncHeadingControls, type MineState, type PlacedRobot } from './placement';
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

const VIS_KEY = 'frc-sim-room-visibility';
function loadVisibility(): RoomVisibility | null {
  try {
    const v = localStorage.getItem(VIS_KEY);
    return v === 'public' || v === 'private' ? v : null;
  } catch {
    return null;
  }
}
function saveVisibility(v: RoomVisibility): void {
  try {
    localStorage.setItem(VIS_KEY, v);
  } catch {
    /* ignore */
  }
}

/** What the lobby browser shows: everything, rooms you can join, or matches you can watch. */
export type RoomFilter = 'all' | 'join' | 'watch';
let roomFilter: RoomFilter = 'all';

/**
 * The one list of public rooms: open lobbies to join and live matches (casual and ranked) to watch.
 * Also re-rendered in place when a fresh list arrives.
 */
export function roomListHtml(all: RoomListing[] | null, busy: boolean, filter: RoomFilter = roomFilter): string {
  if (all === null) return '<div class="rl-empty"><span class="mp-dot waking"></span>Looking for lobbies…</div>';
  // A ranked room only matters once it is live; before that it is a private draft.
  const visible = all.filter((r) => !r.ranked || r.state === 'match');
  const rooms = visible.filter((r) => (filter === 'join' ? r.state !== 'match' : filter === 'watch' ? r.state === 'match' : true));
  if (!rooms.length) {
    const msg = filter === 'watch' ? 'No matches are being played right now.' : filter === 'join' ? 'No open lobbies right now.<br/>Create one, or press <b>Quick play</b> to host and wait for others.' : 'No public lobbies or live matches right now.<br/>Create one, or press <b>Quick play</b> to host and wait for others.';
    return `<div class="rl-empty">${msg}</div>`;
  }
  // Open lobbies first, then live matches.
  rooms.sort((a, b) => Number(a.state === 'match') - Number(b.state === 'match'));
  return rooms
    .map((r) => {
      const full = r.players >= r.max;
      const live = r.state === 'match';
      const status = r.ranked ? '<span class="rl-badge live">Ranked · Live</span>' : r.state === 'lobby' ? '<span class="rl-badge open">Open</span>' : r.state === 'placing' ? '<span class="rl-badge">Starting</span>' : '<span class="rl-badge live">Live</span>';
      return `<div class="rl-row">
        <div class="rl-main"><b>${esc(r.title)}</b><span>${esc(r.host)}${r.season ? ' · ' + esc(r.season) : ''}${r.bots && !r.ranked ? ' · bots fill' : ''}</span></div>
        <div class="rl-count" title="Drivers seated / players in room"><b>${r.drivers}/${r.seats}</b> drivers<span>${r.players} in room</span></div>
        ${status}
        <button class="bbtn ${r.state === 'lobby' && !full ? 'primary' : ''}" data-join-room="${esc(r.code)}" ${busy || full ? 'disabled' : ''}>${full ? 'Full' : live ? 'Watch' : 'Join'}</button>
      </div>`;
    })
    .join('');
}

const filterChips = () =>
  `<div class="rl-filters" role="group" aria-label="Filter rooms">${(['all', 'join', 'watch'] as const).map((f) => `<button class="chip-btn ${roomFilter === f ? 'on' : ''}" data-room-filter="${f}">${f === 'all' ? 'All' : f === 'join' ? 'Open to join' : 'Live to watch'}</button>`).join('')}</div>`;

export interface MpPageCtx {
  s: GameSettings;
  season: SeasonDefinition;
  rerender(): void;
  /** Which tab is showing (Ranked and Multiplayer share this machinery). */
  page?: 'multiplayer' | 'ranked';
  /** Name of the robot the player will bring (shown in the lobby). */
  robotName?: string;
  /** Switch menu page (e.g. to change the robot in the Garage). */
  goto(page: 'garage' | 'home' | 'multiplayer' | 'ranked'): void;
}

let visibilityLoaded = false;

export function multiplayerPage(lobby: LobbyController, ctx: MpPageCtx): { body: string; footer: string } {
  lobby.settings = ctx.s;
  if (!visibilityLoaded) {
    visibilityLoaded = true;
    lobby.createVisibility = loadVisibility() ?? lobby.createVisibility;
  }
  const err = lobby.error ? `<div class="mp-error">${esc(lobby.error)}</div>` : '';

  // Ranked: matched players see the draft (then the shared placement screen); the landing page otherwise.
  if (lobby.status === 'lobby' && !lobby.lobby && lobby.client.room) return rankedWaitingPage();
  if (lobby.lobby?.ranked && lobby.status === 'lobby') {
    if (!lobby.lobby.placing && !lobby.lobby.inMatch) return rankedDraftPage(lobby, ctx);
  } else if (ctx.page === 'ranked' && lobby.status !== 'lobby') return rankedLandingPage(lobby, ctx);

  if (lobby.status !== 'lobby' || !lobby.lobby) {
    if (lobby.serverState === 'unknown') queueMicrotask(() => void lobby.wake());
    if (lobby.serverState === 'online') queueMicrotask(() => lobby.browse());
    const busy = lobby.status === 'connecting';
    const server = {
      unknown: '<span class="mp-dot"></span>Checking server…',
      waking: `<span class="mp-dot waking"></span>Connecting to the multiplayer server… <span data-mp="wake-seconds">${lobby.wakeSeconds}s</span>`,
      online: '<span class="mp-dot on"></span>Server online',
      offline: '<span class="mp-dot off"></span>Server unreachable <button class="link" data-mp="retry">Retry</button>',
    }[lobby.serverState];
    const vis = lobby.createVisibility;
    const invite = lobby.invite;
    return {
      body: `
      <div class="mp-grid">
        <section class="panel mp-card">
          <div class="panel-head"><span>Play online</span></div>
          <div class="mp-pad">
            ${err}
            ${invite ? `<div class="mp-invite">You were invited to room <b>${esc(invite)}</b>${loadName() ? ' — joining…' : ' — enter your name and press Join.'}</div>` : ''}
            <div class="mp-server">${server}</div>
            <label class="mp-field"><span>Your name</span><input data-mp="name" maxlength="24" placeholder="Driver name" value="${esc(loadName())}"/></label>
            <button class="bbtn primary mp-big" data-mp="quick" ${busy ? 'disabled' : ''}>Quick play<small>Join an open public lobby, or host one</small></button>
            <div class="mp-or"><span>host your own</span></div>
            <div class="seg mp-vis" role="group" aria-label="Room visibility">
              <button class="opt ${vis === 'private' ? 'on' : ''}" data-vis="private">Private<small>Code or link only</small></button>
              <button class="opt ${vis === 'public' ? 'on' : ''}" data-vis="public">Public<small>Listed for anyone</small></button>
            </div>
            <input class="mp-title" data-mp="title" maxlength="${MAX_TITLE_LENGTH}" placeholder="Room name (optional)" value="${esc(lobby.createTitle)}" aria-label="Room name"/>
            <button class="bbtn mp-grow" data-mp="create" ${busy ? 'disabled' : ''}>Create ${vis} room</button>
            <div class="mp-or"><span>or join with a code</span></div>
            <div class="mp-row">
              <input class="mp-code" data-mp="code" aria-label="Room code" maxlength="4" placeholder="CODE" autocomplete="off" autocapitalize="characters" spellcheck="false" value="${esc(invite ?? '')}"/>
              <button class="bbtn mp-grow" data-mp="join" ${busy ? 'disabled' : ''}>Join</button>
            </div>
            ${busy ? `<div class="mp-hint">${lobby.serverState === 'waking' ? 'Connecting as soon as the server is up…' : 'Connecting…'}</div>` : ''}
            <details class="mp-adv"><summary>Relay server</summary>
              <label class="mp-field"><span>WebSocket URL</span><input data-mp="url" value="${esc(lobby.relayUrl)}" spellcheck="false"/></label>
              <div class="mp-hint">Everyone in a room must use the same relay. Direct connections are attempted automatically.</div>
            </details>
          </div>
        </section>
        <div class="col">
          <section class="panel mp-card">
            <div class="panel-head"><span>Lobbies &amp; live matches</span><span class="dim" style="margin-left:auto">${lobby.serverState === 'online' ? 'updates live' : ''}</span></div>
            ${filterChips()}
            <div class="rl-list" data-mp="rooms">${lobby.serverState === 'online' ? roomListHtml(lobby.rooms, busy) : '<div class="rl-empty">Connect to the server to see open lobbies.</div>'}</div>
          </section>
          <section class="panel mp-card">
            <div class="panel-head"><span>How it works</span></div>
            <ol class="mp-steps">
              <li><b>Quick play</b> drops you into an open lobby, or hosts one if none exist.</li>
              <li><b>Private</b> rooms are for friends: share the 4-letter code or an invite link.</li>
              <li>Pick a <b>driver station</b>, or just watch: <b>Watch</b> any live match in the list, ranked or casual. Up to 6 drivers, 3 per alliance; bots fill the rest.</li>
              <li>A dropped connection resumes on its own. If the host leaves a casual room, a connected player takes over from the latest checkpoint.</li>
            </ol>
          </section>
        </div>
      </div>`,
      footer: `<button class="bbtn" data-page="home"><kbd>Esc</kbd>Back</button><span class="spacer"></span>`,
    };
  }

  lobby.syncMine();
  const L = lobby.lobby;
  const me = lobby.me;
  if (L.placing) return placementPage(lobby, ctx);
  const byslot = new Map<SlotId, (typeof L.players)[number]>();
  for (const p of L.players) if (p.slot) byslot.set(p.slot, p);
  const slotBtn = (slot: SlotId) => {
    const p = byslot.get(slot);
    const mine = p && p.peerId === me?.peerId;
    const a = slotAlliance(slot);
    if (p)
      return `<div class="mp-slot ${a} taken ${mine ? 'mine' : ''}"><span class="st">${slotStation(slot)}</span><div class="who"><b>${esc(p.name)}${p.host ? ' <i>host</i>' : ''}</b><span>Team ${p.team || '—'}</span></div>${mine ? '<span class="you">You</span>' : ''}</div>`;
    return `<button class="mp-slot ${a} open" data-slot="${slot}"><span class="st">${slotStation(slot)}</span><div class="who"><b>${L.fillBots ? 'Bot' : 'Open'}</b><span>${L.fillBots ? 'Take over' : 'Take'} ${slotLabel(slot)}</span></div></button>`;
  };
  const spectators = L.players.filter((p) => !p.slot);
  const r = ctx.s.robot;
  const drivers = L.players.filter((p) => p.slot).length;
  const isPublic = L.visibility === 'public';

  const body = `
    ${err}
    <div class="mp-hint" data-mp="transport">${lobby.isHost ? `${lobby.client.directPeerCount} direct connection${lobby.client.directPeerCount === 1 ? '' : 's'} · ${Math.max(0, L.players.length - 1 - lobby.client.directPeerCount)} through relay` : (lobby.client.directPeerCount ? 'Direct connection to host' : (lobby.client.directSupported ? 'Connected through relay' : 'Connected through relay · direct connections unavailable in this browser'))}</div>
    <div class="mp-room">
      <div><div class="mp-room-label">Room code · <span class="mp-vis-badge ${isPublic ? 'pub' : ''}">${isPublic ? 'Public' : 'Private'}</span></div><div class="mp-room-code">${esc(L.room)}</div></div>
      <div class="mp-room-actions">
        <button class="bbtn" data-mp="copy">Copy code</button>
        <button class="bbtn" data-mp="copy-link">Copy invite link</button>
      </div>
      <div class="mp-room-meta">${L.title ? `<b>${esc(L.title)}</b> · ` : ''}${esc(seasonLabel(ctx.season))} · ${L.players.length} player${L.players.length === 1 ? '' : 's'} · ${drivers} driving${L.inMatch ? ' · <b>match in progress</b>' : ''}</div>
    </div>
    ${lobby.reconnecting ? '<div class="mp-error">Connection lost — reconnecting…</div>' : lobby.hostAway ? '<div class="mp-error">The host lost connection — waiting for them to return…</div>' : ''}
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
      ${peoplePanel(lobby, L)}
      ${chatPanel(L)}
      <div class="col">
        <section class="panel">
          <div class="panel-head"><span>Your robot</span><button class="link" data-mp="edit">Change robot</button></div>
          <div class="mp-pad mp-robot">
            <div class="mp-team">${r.teamNumber}</div>
            <div>
              ${ctx.robotName ? `<div><b>${esc(ctx.robotName)}</b></div>` : ''}
              <div>${ctx.season.robotSummary ? esc(ctx.season.robotSummary(r)) : `${(r.maxSpeed / 0.3048).toFixed(1)} ft/s · ${r.hopperCapacity} ${esc(ctx.season.gamePiece.name)} · ${r.launcher.rate}/s · ${ctx.season.climberLabels?.[r.climber.maxLevel] ?? (r.climber.maxLevel ? `climbs L${r.climber.maxLevel}` : 'no climber')}`}</div>
              <div class="dim">You drive in AUTO too; bots run their routines.</div>
            </div>
          </div>
        </section>
        <section class="panel">
          <div class="panel-head"><span>Match options</span>${lobby.isHost ? '' : '<span class="dim" style="margin-left:auto">set by host</span>'}</div>
          <div class="mp-pad">
            ${lobby.isHost ? `<div class="group"><div class="label">Who can find this room</div>
              <div class="seg">
                <button class="opt ${!isPublic ? 'on' : ''}" data-room-vis="private">Private</button>
                <button class="opt ${isPublic ? 'on' : ''}" data-room-vis="public">Public</button>
              </div>
              <input class="mp-title" data-mp="room-title" maxlength="${MAX_TITLE_LENGTH}" placeholder="Room name shown in the public list" value="${esc(L.title ?? '')}" aria-label="Room name"/>
              <div class="mp-hint">${isPublic ? 'Listed in the public lobby browser. Anyone can join.' : 'Hidden from the list. Players need the code or your invite link.'}</div>
            </div>` : ''}
            <div class="group"><div class="label">Open driver stations</div>
              <div class="seg">
                <button class="opt ${L.fillBots ? 'on' : ''}" data-bots="1" ${lobby.isHost ? '' : 'disabled'}>Fill with bots</button>
                <button class="opt ${!L.fillBots ? 'on' : ''}" data-bots="0" ${lobby.isHost ? '' : 'disabled'}>Leave empty</button>
              </div>
              <div class="mp-hint">For duos against bots, choose two stations on the same alliance. Bots fill the other stations when the match starts.</div>
            </div>
            ${L.fillBots ? `<div class="group"><div class="label">Bot difficulty</div><div class="seg">${(['normal', 'hard', 'einstein'] as const).map(skill => `<button class="opt ${(L.botDifficulty ?? 'normal') === skill ? 'on' : ''}" data-bot-skill="${skill}" ${lobby.isHost ? '' : 'disabled'}>${skill[0].toUpperCase() + skill.slice(1)}</button>`).join('')}</div></div>` : ''}
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
    `<button class="bbtn" data-mp="leave">Leave room</button><span class="spacer"></span>` +
    (lobby.isHost
      ? `<span class="mp-hint">${lobby.canStart() ? '' : 'At least one player needs a driver station'}</span><button class="bbtn primary" data-mp="start" ${lobby.canStart() ? '' : 'disabled'}>Set starting positions</button>`
      : `<span class="mp-hint">${L.inMatch ? 'Match in progress — joining as a spectator…' : 'Waiting for the host to start…'}</span>`);
  return { body, footer };
}

function peoplePanel(lobby: LobbyController, L: NonNullable<LobbyController['lobby']>): string {
  const rows = L.players
    .map((p) => {
      const mine = p.peerId === lobby.me?.peerId;
      const seat = p.slot ? slotLabel(p.slot) : 'Spectating';
      const kick = lobby.isHost && !mine ? `<button class="link mp-kick" data-kick="${esc(p.peerId)}" title="Remove from room">Remove</button>` : '';
      return `<div class="mp-person"><b>${esc(p.name)}${p.host ? ' <i>host</i>' : ''}${mine ? ' <i>you</i>' : ''}</b><span>${seat}${p.team ? ' · Team ' + p.team : ''}</span>${kick}</div>`;
    })
    .join('');
  return `<section class="panel"><div class="panel-head"><span>Players (${L.players.length})</span></div><div class="mp-people">${rows}</div></section>`;
}

function chatPanel(L: NonNullable<LobbyController['lobby']>): string {
  const lines = (L.chat ?? [])
    .map((c) => (c.from ? `<div class="mp-line"><b class="${c.alliance ?? ''}">${esc(c.from)}</b> ${esc(c.text)}</div>` : `<div class="mp-line sys">${esc(c.text)}</div>`))
    .join('');
  return `<section class="panel"><div class="panel-head"><span>Chat</span></div>
    <div class="mp-chat-log" data-mp="chat-log">${lines || '<div class="mp-line sys">Say hi — coordinate stations and strategy here.</div>'}</div>
    <div class="mp-chat-send"><input data-mp="chat" maxlength="200" placeholder="Message the room" autocomplete="off" aria-label="Chat message"/><button class="bbtn" data-mp="chat-send">Send</button></div>
  </section>`;
}

// ───────────────────────────── placement phase ─────────────────────────────

/** Every seated driver's robot on the field map, mine draggable. */
function placementMapHtml(lobby: LobbyController, ctx: MpPageCtx): string {
  const L = lobby.lobby!;
  const problems = placementProblems(ctx.season, L.players);
  const robots: PlacedRobot[] = [];
  for (const p of L.players) {
    const spot = playerSpot(ctx.season, p);
    if (!spot || !p.slot) continue;
    const mine = p.peerId === lobby.me?.peerId;
    const d = p.dims ?? (mine ? footprint(ctx.s.robot) : { length: 0.9, width: 0.9 });
    robots.push({
      alliance: slotAlliance(p.slot),
      spot,
      length: d.length,
      width: d.width,
      label: String(p.team || slotStation(p.slot)),
      title: `${esc(p.name)} · ${slotLabel(p.slot)}`,
      mine,
      ready: p.ready,
      invalid: problems.has(p.peerId),
      intakeFront: mine ? ctx.s.robot.intake.groundSide === 'front' : undefined,
    });
  }
  return placementMap(ctx.season, robots, { zones: ['blue', 'red'] });
}

/** My robot's placement state (null for spectators): footprint, spot and the teammates it must not overlap. */
function mineState(lobby: LobbyController, ctx: MpPageCtx): MineState | null {
  const me = lobby.me;
  const spot = me && playerSpot(ctx.season, me);
  if (!me?.slot || !spot) return null;
  const d = me.dims ?? footprint(ctx.s.robot);
  const blockers = lobby.lobby!.players
    .filter((o) => o.slot && o !== me && slotAlliance(o.slot) === slotAlliance(me.slot!))
    .map((o) => footprintPoly(playerSpot(ctx.season, o)!, (o.dims ?? { length: 0.9, width: 0.9 }).length, (o.dims ?? { length: 0.9, width: 0.9 }).width));
  return { alliance: slotAlliance(me.slot), spot, length: d.length, width: d.width, blockers };
}

function placementPage(lobby: LobbyController, ctx: MpPageCtx): { body: string; footer: string } {
  const L = lobby.lobby!;
  const me = lobby.me;
  const problems = placementProblems(ctx.season, L.players);
  const mine = mineState(lobby, ctx);
  const drivers = L.players.filter((p) => p.slot);
  const readyCount = drivers.filter((p) => p.ready).length;
  const allReady = drivers.length > 0 && readyCount === drivers.length;
  const err = lobby.error ? `<div class="mp-error">${esc(lobby.error)}</div>` : '';
  const rows = SLOTS.map((slot) => {
    const p = drivers.find((x) => x.slot === slot);
    if (!p) return '';
    const bad = problems.get(p.peerId);
    const state = bad ? `<span class="pl-state bad">${esc(bad)}</span>` : p.ready ? '<span class="pl-state ok">✓ Locked in</span>' : '<span class="pl-state">Placing…</span>';
    return `<div class="pl-row ${slotAlliance(slot)} ${p.peerId === me?.peerId ? 'mine' : ''}"><span class="st">${slotStation(slot)}</span><div class="who"><b>${esc(p.name)}${p.peerId === me?.peerId ? ' (you)' : ''}</b><span>Team ${p.team || '—'} · ${slotLabel(slot)}</span></div>${state}</div>`;
  }).join('');
  const myProblem = me && problems.get(me.peerId);
  const lock = mine
    ? `<button class="bbtn ${me!.ready ? '' : 'primary'} pl-lock" data-mp="lock" ${!me!.ready && myProblem ? 'disabled' : ''}>${me!.ready ? 'Unlock to edit' : 'Lock in position'}</button>`
    : '<div class="mp-hint">You\'re spectating — watch the others place their robots.</div>';
  const body = `
    ${err}
    <div class="mp-grid place-grid">
      <section class="panel map-panel">
        <div class="panel-head"><span>Starting positions</span><span class="dim" style="margin-left:auto">${readyCount}/${drivers.length} locked in</span></div>
        <div class="map-wrap">${placementMapHtml(lobby, ctx)}</div>
        ${mine ? `<div class="place-wrap">${headingControls(mine.spot.yaw, '<button class="link" data-mp="preset">Station preset</button>')}</div>` : ''}
        <div class="map-legend"><span class="lg"><i class="sw"></i>Your robot</span><span class="lg"><i class="sw zone"></i>Legal start zone</span><span class="sp">${mine ? 'Drag your robot anywhere in the green zone, drag the knob on its nose to rotate (Shift = 15° steps).' : 'Drivers are choosing their starting positions.'}</span></div>
      </section>
      <div class="col">
        <section class="panel">
          <div class="panel-head"><span>Drivers</span></div>
          <div class="pl-list">${rows}</div>
          <div class="mp-pad">${lock}<div class="mp-hint">Drivers control their robots during AUTO. Lock in your starting position to begin.</div>${allReady ? '<div class="mp-hint pl-go">Everyone is locked in — starting…</div>' : ''}</div>
        </section>
      </div>
    </div>`;
  const ranked = !!L.ranked;
  const footer = ranked
    ? `<button class="bbtn" data-mp="leave">Leave match (counts as a loss)</button><span class="spacer"></span><span class="mp-hint">${allReady ? 'Starting…' : 'Starting positions lock in automatically when time runs out'}</span>`
    : lobby.isHost
    ? `<button class="bbtn" data-mp="cancel-place">Back to lobby</button><span class="spacer"></span><span class="mp-hint">${allReady ? '' : 'The match starts when every driver locks in'}</span><button class="bbtn primary" data-mp="start-now" ${allReady ? '' : 'disabled'}>Start match</button>`
    : `<button class="bbtn" data-mp="leave">Leave room</button><span class="spacer"></span><span class="mp-hint">${allReady ? 'Starting…' : 'Waiting for every driver to lock in…'}</span>`;
  return { body, footer };
}

function bindPlacement(el: HTMLElement, lobby: LobbyController, ctx: MpPageCtx): void {
  const wrap = el.querySelector<HTMLElement>('.map-wrap');
  if (!wrap) return;
  bindPlacementMap(wrap, ctx.season, {
    mine: () => mineState(lobby, ctx),
    set: (spot) => {
      lobby.previewSpot(spot);
      wrap.innerHTML = placementMapHtml(lobby, ctx);
      syncHeadingControls(el, spot.yaw);
    },
    // Moving unlocks you: your teammates must be able to rely on a locked-in position.
    commit: (spot) => lobby.place(spot, false),
  });
  bindHeadingControls(el, (yaw) => {
    const m = mineState(lobby, ctx);
    if (m) lobby.place(rotateSpot(ctx.season, m, yaw), false);
  });
  el.querySelector<HTMLElement>('[data-mp="lock"]')?.addEventListener('click', () => {
    const me = lobby.me;
    if (me) lobby.place(me.spot ?? null, !me.ready);
  });
  el.querySelector<HTMLElement>('[data-mp="preset"]')?.addEventListener('click', () => lobby.place(null, false));
}

export function bindMultiplayer(el: HTMLElement, lobby: LobbyController, ctx: MpPageCtx): void {
  bindRanked(el, lobby);
  const q = <T extends HTMLElement>(k: string) => el.querySelector<T>(`[data-mp="${k}"]`);
  const name = () => {
    const n = (q<HTMLInputElement>('name')?.value ?? '').trim() || 'Player';
    // A rejected name is not remembered; the lobby methods show the reason.
    if (!nameProblem(n)) saveName(n);
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
  const title = q<HTMLInputElement>('title');
  if (title) title.oninput = () => (lobby.createTitle = title.value);
  el.querySelectorAll<HTMLElement>('[data-vis]').forEach(
    (b) =>
      (b.onclick = () => {
        lobby.createVisibility = b.dataset.vis as RoomVisibility;
        saveVisibility(lobby.createVisibility);
        ctx.rerender();
      }),
  );
  const create = q('create');
  if (create) create.onclick = () => void lobby.create(name(), lobby.createVisibility, title?.value ?? '');
  const quick = q('quick');
  if (quick) quick.onclick = () => void lobby.quickPlay(name());
  const bindRooms = (box: HTMLElement) =>
    box.querySelectorAll<HTMLElement>('[data-join-room]').forEach((b) => (b.onclick = () => void lobby.join(b.dataset.joinRoom!, name())));
  el.querySelectorAll<HTMLElement>('[data-room-filter]').forEach((b) => (b.onclick = () => {
    roomFilter = b.dataset.roomFilter as RoomFilter;
    ctx.rerender();
  }));
  const roomsBox = q('rooms');
  if (roomsBox) {
    bindRooms(roomsBox);
    // A fresh list replaces just the rows, so typing in the form isn't disturbed.
    lobby.onRooms = (rooms) => {
      const box = el.querySelector<HTMLElement>('[data-mp="rooms"]');
      if (!box || !el.isConnected) return;
      box.innerHTML = roomListHtml(rooms, lobby.status === 'connecting');
      bindRooms(box);
    };
  }
  // Invite link (?join=CODE): join straight away when we already know the player's name.
  if (lobby.invite && lobby.status === 'idle' && loadName()) {
    const code = lobby.takeInvite()!;
    void lobby.join(code, loadName());
  }
  const code = q<HTMLInputElement>('code');
  const join = q('join');
  if (join && code) {
    const go = () => {
      const room = code.value.trim().toUpperCase();
      if (!/^[A-Z]{4}$/.test(room)) {
        lobby.error = 'Enter the 4-letter room code';
        ctx.rerender();
        return;
      }
      void lobby.join(room, name());
    };
    join.onclick = go;
    code.onkeydown = (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        go();
      }
    };
  }
  el.querySelectorAll<HTMLElement>('[data-slot]').forEach((b) => (b.onclick = () => lobby.pickSlot((b.dataset.slot || null) as SlotId | null)));
  el.querySelectorAll<HTMLElement>('[data-hp]').forEach((b) => (b.onclick = () => lobby.setAutoHumanPlayer(b.dataset.hp === '1')));
  el.querySelectorAll<HTMLElement>('[data-bots]').forEach(b => b.onclick = () => lobby.setBots(b.dataset.bots === '1'));
  el.querySelectorAll<HTMLElement>('[data-bot-skill]').forEach(b => b.onclick = () => lobby.setBots(true, b.dataset.botSkill as AiSkill));
  const copyTo = (btn: HTMLElement | null, text: () => string) => {
    if (btn)
      btn.onclick = () => {
        void navigator.clipboard?.writeText(text());
        btn.textContent = 'Copied';
      };
  };
  copyTo(q('copy'), () => lobby.lobby?.room ?? '');
  copyTo(q('copy-link'), () => lobby.inviteLink());
  el.querySelectorAll<HTMLElement>('[data-room-vis]').forEach((b) => (b.onclick = () => lobby.setVisibility(b.dataset.roomVis as RoomVisibility)));
  const roomTitle = q<HTMLInputElement>('room-title');
  if (roomTitle) roomTitle.onchange = () => lobby.setTitle(roomTitle.value);
  el.querySelectorAll<HTMLElement>('[data-kick]').forEach((b) => (b.onclick = () => lobby.kick(b.dataset.kick!)));
  const chat = q<HTMLInputElement>('chat');
  if (chat) {
    const say = () => {
      const text = chat.value.trim();
      if (!text) return;
      chat.value = '';
      lobby.sendChat(text);
    };
    chat.onkeydown = (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        say();
      }
    };
    q('chat-send')!.onclick = say;
  }
  const log = q('chat-log');
  if (log) log.scrollTop = log.scrollHeight;
  const edit = q('edit');
  if (edit) edit.onclick = () => ctx.goto('garage');
  const leave = q('leave');
  if (leave) leave.onclick = () => lobby.leave();
  const start = q('start');
  if (start) start.onclick = () => lobby.beginPlacement();
  const startNow = q('start-now');
  if (startNow) startNow.onclick = () => lobby.startMatch();
  const cancelPlace = q('cancel-place');
  if (cancelPlace) cancelPlace.onclick = () => lobby.cancelPlacement();
  if (lobby.lobby?.placing) {
    bindPlacement(el, lobby, ctx);
  }
}
