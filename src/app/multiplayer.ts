import { autoPlanner, bindAutoPlanner } from './autoPlanner';
import type { AiSkill, GameSettings, SeasonDefinition } from '@engine/core/season';
import { SLOTS, slotAlliance, slotLabel, slotStation, type SlotId } from '@engine/net/protocol';
import { footprint } from '@engine/robot/config';
import { footprintPoly } from '@engine/startPose';
import type { LobbyController } from './lobby';
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
              <input class="mp-code" data-mp="code" aria-label="Room code" maxlength="4" placeholder="CODE" autocomplete="off" autocapitalize="characters" spellcheck="false"/>
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
  const routine = ctx.season.autoRoutines.find((x) => x.id === ctx.s.autoRoutine);
  const drivers = L.players.filter((p) => p.slot).length;

  const body = `
    ${err}
    <div class="mp-room">
      <div><div class="mp-room-label">Room code</div><div class="mp-room-code">${esc(L.room)}</div></div>
      <button class="bbtn" data-mp="copy">Copy code</button>
      <div class="mp-room-meta">${ctx.season.year} ${esc(ctx.season.name)} · ${L.players.length} player${L.players.length === 1 ? '' : 's'} · ${drivers} driving${L.inMatch ? ' · <b>match in progress</b>' : ''}</div>
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
              <div>${ctx.season.robotSummary ? esc(ctx.season.robotSummary(r)) : `${(r.maxSpeed / 0.3048).toFixed(1)} ft/s · ${r.hopperCapacity} ${esc(ctx.season.gamePiece.name)} · ${r.launcher.rate}/s · ${ctx.season.climberLabels?.[r.climber.maxLevel] ?? (r.climber.maxLevel ? `climbs L${r.climber.maxLevel}` : 'no climber')}`}</div>
              <div class="dim">AUTO: ${ctx.s.autoRoutine === 'custom' ? 'Your planned auto' : esc(routine?.label ?? ctx.s.autoRoutine)}</div>
            </div>
          </div>
        </section>
        <section class="panel">
          <div class="panel-head"><span>Match options</span>${lobby.isHost ? '' : '<span class="dim" style="margin-left:auto">set by host</span>'}</div>
          <div class="mp-pad">
            <div class="group"><div class="label">Open driver stations</div>
              <div class="seg">
                <button class="opt ${L.fillBots ? 'on' : ''}" data-bots="1" ${lobby.isHost ? '' : 'disabled'}>Fill with bots</button>
                <button class="opt ${!L.fillBots ? 'on' : ''}" data-bots="0" ${lobby.isHost ? '' : 'disabled'}>Leave empty</button>
              </div>
              <div class="mp-hint">For duos against bots, choose two stations on the same alliance. Bots fill the other stations when the match starts.</div>
            </div>
            ${L.fillBots ? `<div class="group"><div class="label">Bot difficulty</div><div class="seg">${(['easy', 'normal', 'hard', 'elite', 'einstein'] as const).map(skill => `<button class="opt ${(L.botDifficulty ?? 'normal') === skill ? 'on' : ''}" data-bot-skill="${skill}" ${lobby.isHost ? '' : 'disabled'}>${skill[0].toUpperCase() + skill.slice(1)}</button>`).join('')}</div></div>` : ''}
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
      ? `<span class="mp-hint">${lobby.canStart() ? '' : 'At least one player needs a driver station'}</span><button class="bbtn primary" data-mp="start" ${lobby.canStart() ? '' : 'disabled'}>Plan autos &amp; positions</button>`
      : `<span class="mp-hint">${L.inMatch ? 'Match in progress — you’ll join the next one' : 'Waiting for the host to start…'}</span>`);
  return { body, footer };
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
    ? `<button class="bbtn ${me!.ready ? '' : 'primary'} pl-lock" data-mp="lock" ${!me!.ready && myProblem ? 'disabled' : ''}>${me!.ready ? 'Unlock to edit' : 'Lock in position & auto'}</button>`
    : '<div class="mp-hint">You\'re spectating — watch the others place their robots.</div>';
  const planner = me?.slot ? autoPlanner(ctx.season, ctx.s, { startSpot: me.spot, alliance: slotAlliance(me.slot), station: slotStation(me.slot), disabled: !!me.ready, teammates: L.players.filter(p => p.peerId !== me.peerId && p.slot && slotAlliance(p.slot) === slotAlliance(me.slot!) && p.autoPlan).map(p => ({ name: p.name, station: slotStation(p.slot!), plan: p.autoPlan! })) }) : '';
  const body = `
    ${err}
    <div class="mp-grid place-grid">
      <section class="panel map-panel">
        <div class="panel-head"><span>Positions &amp; private alliance autos</span><span class="dim" style="margin-left:auto">${readyCount}/${drivers.length} locked in</span></div>
        <div class="map-wrap">${placementMapHtml(lobby, ctx)}</div>
        ${mine ? `<div class="place-wrap">${headingControls(mine.spot.yaw, '<button class="link" data-mp="preset">Station preset</button>')}</div>` : ''}
        <div class="map-legend"><span class="lg"><i class="sw"></i>Your robot</span><span class="lg"><i class="sw zone"></i>Legal start zone</span><span class="sp">${mine ? 'Drag your robot anywhere in the green zone, drag the knob on its nose to rotate (Shift = 15° steps).' : 'Drivers are choosing their starting positions.'}</span></div>
      </section>
      <div class="col">
        <section class="panel">
          <div class="panel-head"><span>Drivers</span></div>
          <div class="pl-list">${rows}</div>
          <div class="mp-pad">${lock}<div class="mp-hint">Plan with your alliance below. Opponents cannot see your routes. AUTO runs without driver control.</div>${allReady ? '<div class="mp-hint pl-go">Everyone is locked in — starting…</div>' : ''}</div>
        </section>
      </div>
    </div>${planner}`;
  const footer = lobby.isHost
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
  if (start) start.onclick = () => lobby.beginPlacement();
  const startNow = q('start-now');
  if (startNow) startNow.onclick = () => lobby.startMatch();
  const cancelPlace = q('cancel-place');
  if (cancelPlace) cancelPlace.onclick = () => lobby.cancelPlacement();
  if (lobby.lobby?.placing) {
    bindPlacement(el, lobby, ctx);
    const me = lobby.me;
    if (me?.slot) bindAutoPlanner(el, ctx.season, ctx.s, ctx.rerender, { alliance: slotAlliance(me.slot), startSpot: me.spot, station: slotStation(me.slot), disabled: !!me.ready, changed: () => lobby.syncMine(true), setStartYaw: yaw => { const m = mineState(lobby, ctx); if (m) lobby.place(rotateSpot(ctx.season, m, yaw), false); } });
  }
}
