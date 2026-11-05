import type { SeasonDefinition } from '@engine/core/season';
import { boardRobotFor, boardRobots, type BoardRobot } from '@engine/ghost/board';
import type { GhostRace } from '@engine/ghost/ghostLayer';
import { cleanName } from '@engine/net/relayProtocol';
import { nameProblem } from '@engine/net/nameFilter';
import type { RobotConfig } from '@engine/robot/config';
import { icon } from './icons';
import { autoBestGhost, driverName, fetchBoard, fetchGhost, fetchSummary, flushBests, localBests, localGhost, renameDriver, setAutoBestGhost, type Board, type LocalBest, type RobotSummary, type RunOutcome } from './soloScores';

/** Leaderboard page (one board per real team robot) and the results-card outcome. See docs/LEADERBOARD.md. */

const MAX_GHOSTS = 3;
const LOCAL_ID = 'local';

export interface LeaderboardContext {
  season: SeasonDefinition;
  /** The robot in the Garage: its board opens first. */
  current: RobotConfig;
  secret(): string;
  rerender(): void;
  race(config: RobotConfig, ghosts: GhostRace[]): void;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const when = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

/** Page state survives re-renders; `seasonId` resets it when the season changes. */
const view = {
  seasonId: '',
  robotId: '',
  query: '',
  mine: false,
  summary: undefined as RobotSummary[] | null | undefined,
  locals: [] as LocalBest[],
  board: undefined as Board | null | undefined,
  boardKey: '',
  /** Picked ghosts: run id → the name shown over it. */
  picks: new Map<string, string>(),
  note: '',
  racing: false,
};

function refreshBoard(ctx: LeaderboardContext): void {
  const key = `${ctx.season.id}|${view.robotId}`;
  if (view.boardKey === key) return;
  view.boardKey = key;
  view.board = undefined;
  view.picks.clear();
  void fetchBoard(ctx.season.id, view.robotId, ctx.secret()).then((board) => {
    if (view.boardKey !== key) return;
    view.board = board;
    ctx.rerender();
  });
}

function open(ctx: LeaderboardContext): void {
  if (view.seasonId === ctx.season.id) return refreshBoard(ctx);
  view.seasonId = ctx.season.id;
  view.robotId = boardRobotFor(ctx.season, ctx.current)?.id ?? boardRobots(ctx.season)[0]?.id ?? '';
  view.query = '';
  view.summary = undefined;
  view.boardKey = '';
  refreshBoard(ctx);
  const season = ctx.season.id;
  // Runs set while the relay was out of reach go up first, so they show on the boards fetched next.
  void (async () => {
    view.locals = await localBests(season);
    await flushBests(season, ctx.secret());
    const summary = await fetchSummary(season);
    if (view.seasonId !== season) return;
    view.summary = summary;
    view.boardKey = '';
    refreshBoard(ctx);
    ctx.rerender();
  })();
}

/** The next time the page shows, fetch everything again. */
export function invalidateLeaderboard(): void {
  view.seasonId = '';
}

export function leaderboardPage(ctx: LeaderboardContext): { body: string; footer: string } {
  open(ctx);
  const summaryOf = (id: string) => view.summary?.find((s) => s.robot === id);
  const localOf = (id: string) => view.locals.find((b) => b.robot === id);
  // Highest score first; robots nobody has played keep their Garage order at the bottom.
  const best = (r: BoardRobot) => Math.max(summaryOf(r.id)?.top ?? -1, localOf(r.id)?.score ?? -1);
  const robots = boardRobots(ctx.season).sort((a, b) => best(b) - best(a));
  const selected = robots.find((r) => r.id === view.robotId) ?? robots[0];
  const row = (r: BoardRobot) => {
    const top = summaryOf(r.id), pb = localOf(r.id);
    const hidden = !shown(r, view.query, view.mine, !!pb);
    return `<button class="lb-robot ${r.id === view.robotId ? 'on' : ''}" data-lb-robot="${esc(r.id)}" ${hidden ? 'hidden' : ''}>
      <span class="lb-robot-name">${esc(r.label)}<small>${top ? `${esc(top.name)} · ${top.drivers} driver${top.drivers === 1 ? '' : 's'}` : 'No runs yet'}</small></span>
      <span class="lb-robot-score"><b>${top?.top ?? '—'}</b>${pb ? `<small>You ${pb.score}</small>` : ''}</span>
    </button>`;
  };
  if (!robots.length) return { body: `<section class="panel"><div class="lb-empty">${esc(ctx.season.name)} has no real team robots yet, so it has no leaderboards.</div></section>`, footer: '<button class="bbtn" data-page="home"><kbd>Esc</kbd>Back</button><span class="spacer"></span>' };
  const offline = view.summary === null;
  const body = `<div class="lb">
    <section class="panel lb-robots">
      <div class="lb-tools">
        <input class="team-search" type="search" data-lb-search placeholder="Search ${robots.length} robots" aria-label="Search robots" value="${esc(view.query)}" />
        <button class="chip-btn ${view.mine ? 'on' : ''}" data-lb-mine aria-pressed="${view.mine}">Only mine</button>
      </div>
      <div class="lb-robot-list">${robots.map(row).join('')}</div>
    </section>
    <section class="panel lb-board">
      <div class="panel-head"><span>${esc(selected?.label ?? '')}</span><span class="dim">${view.board ? `${view.board.total} driver${view.board.total === 1 ? '' : 's'}` : ''}</span></div>
      ${offline ? '<div class="config-note lb-note">The online leaderboard can’t be reached. Your own bests and ghosts still work, and new bests go up once it’s back.</div>' : ''}
      ${boardTable()}
      <div class="lb-foot">
        <label class="mp-field lb-name"><span>Your name</span><input data-lb-name maxlength="24" value="${esc(driverName())}" placeholder="Player" spellcheck="false" /></label>
        <button class="chip-btn ${autoBestGhost() ? 'on' : ''}" data-lb-auto aria-pressed="${autoBestGhost()}" title="In Solo practice with a stock robot">Race my best automatically</button>
      </div>
      ${view.note ? `<div class="lb-error" role="status">${esc(view.note)}</div>` : ''}
    </section>
  </div>`;
  const n = view.picks.size;
  const footer = `<button class="bbtn" data-page="home"><kbd>Esc</kbd>Back</button><span class="spacer"></span><button class="bbtn primary" data-lb-race ${!selected || view.racing ? 'disabled' : ''}>${icon.gamepad(18)} ${view.racing ? 'Loading ghosts…' : n ? `Race ${n} ghost${n === 1 ? '' : 's'}` : 'Play this robot'}</button>`;
  return { body, footer };
}

function shown(r: BoardRobot, query: string, mine: boolean, hasBest: boolean): boolean {
  return (!mine || hasBest) && r.label.toLowerCase().includes(query.trim().toLowerCase());
}

function boardTable(): string {
  const local = view.locals.find((b) => b.robot === view.robotId);
  const ghostBtn = (id: string, name: string) => {
    const on = view.picks.has(id);
    return `<button class="chip-btn lb-ghost ${on ? 'on' : ''}" data-lb-ghost="${esc(id)}" data-name="${esc(name)}" aria-pressed="${on}" ${!on && view.picks.size >= MAX_GHOSTS ? 'disabled' : ''}>Ghost</button>`;
  };
  const line = (rank: string, name: string, score: number, at: string, id: string, ghostName: string, mine: boolean) =>
    `<div class="lb-row ${mine ? 'mine' : ''}" role="row"><span class="lb-rank ${rank === '1' ? 'gold' : rank === '2' ? 'silver' : rank === '3' ? 'bronze' : ''}">${esc(rank)}</span><span class="lb-who">${esc(name)}${mine ? '<small>You</small>' : ''}</span><span class="lb-when">${when(at)}</span><b class="lb-score">${score}</b>${ghostBtn(id, ghostName)}</div>`;
  const b = view.board;
  if (b === undefined) return '<div class="lb-empty">Loading…</div>';
  const entries = b?.entries ?? [];
  const rows = entries.map((e, i) => line(String(i + 1), e.name, e.score, e.at, e.id, e.name, e.mine));
  // Below the visible list, or not sent yet: your own run still shows.
  if (b?.me && !entries.some((e) => e.mine)) rows.push(line(String(b.me.rank), 'Your best', b.me.score, b.me.at, b.me.id, 'Your best', true));
  else if (local && !entries.some((e) => e.mine)) rows.push(line('—', 'Your best', local.score, local.at, LOCAL_ID, 'Your best', true));
  if (!rows.length) return '<div class="lb-empty">Nobody has set a score on this robot yet. Be the first: press Play this robot.</div>';
  return `<div class="lb-table" role="table">${rows.join('')}</div>`;
}

async function loadGhosts(ctx: LeaderboardContext): Promise<GhostRace[] | null> {
  const races = await Promise.all([...view.picks].map(async ([id, name]) => {
    const run = id === LOCAL_ID ? await localGhost(ctx.season.id, view.robotId) : await fetchGhost(id);
    return run ? { name, run } : null;
  }));
  return races.every((r) => r) ? races as GhostRace[] : null;
}

export function bindLeaderboard(el: HTMLElement, ctx: LeaderboardContext): void {
  const all = (sel: string) => Array.from(el.querySelectorAll<HTMLElement>(sel));
  all('[data-lb-robot]').forEach((b) => (b.onclick = () => {
    view.robotId = b.dataset.lbRobot!;
    view.note = '';
    ctx.rerender();
  }));
  const search = el.querySelector<HTMLInputElement>('[data-lb-search]');
  const applyFilter = () => all('[data-lb-robot]').forEach((b) => {
    const r = boardRobots(ctx.season).find((x) => x.id === b.dataset.lbRobot);
    b.hidden = !r || !shown(r, view.query, view.mine, view.locals.some((l) => l.robot === r.id));
  });
  if (search) search.oninput = () => { view.query = search.value; applyFilter(); };
  all('[data-lb-mine]').forEach((b) => (b.onclick = () => { view.mine = !view.mine; ctx.rerender(); }));
  all('[data-lb-auto]').forEach((b) => (b.onclick = () => { setAutoBestGhost(!autoBestGhost()); ctx.rerender(); }));
  all('[data-lb-ghost]').forEach((b) => (b.onclick = () => {
    const id = b.dataset.lbGhost!;
    if (!view.picks.delete(id) && view.picks.size < MAX_GHOSTS) view.picks.set(id, b.dataset.name!);
    ctx.rerender();
  }));
  const name = el.querySelector<HTMLInputElement>('[data-lb-name]');
  if (name) name.onchange = () => {
    const problem = nameProblem(name.value);
    view.note = problem ?? '';
    if (!problem) {
      void renameDriver(name.value.trim(), ctx.secret()).then(() => { view.boardKey = ''; ctx.rerender(); });
      return;
    }
    ctx.rerender();
  };
  const race = el.querySelector<HTMLButtonElement>('[data-lb-race]');
  if (race) race.onclick = () => {
    const robot = boardRobots(ctx.season).find((r) => r.id === view.robotId);
    if (!robot || view.racing) return;
    view.racing = true;
    view.note = '';
    ctx.rerender();
    void loadGhosts(ctx).then((ghosts) => {
      view.racing = false;
      if (!ghosts) {
        view.note = 'Couldn’t load those ghosts. Check your connection and try again.';
        return ctx.rerender();
      }
      ctx.race(robot.config, ghosts);
    });
  };
}

/** The result of a leaderboard run, in the results card. */
export function showRunOutcome(slot: HTMLElement, robot: string, o: RunOutcome, secret: string): void {
  if (!slot.isConnected) return;
  const best = o.previous === null || o.score > o.previous;
  const headline = o.previous === null ? 'First score' : best ? `New best · +${o.score - o.previous}` : `${o.previous - o.score} off your best`;
  const place = o.rank === null ? 'Saved on this device' : `#${o.rank} of ${o.total}`;
  slot.innerHTML = `<div class="solo-run-card ${best ? 'best' : ''}"><div><small>${esc(robot)}</small><b>${esc(headline)}</b></div><div class="solo-run-place"><b>${o.score}</b><small>${esc(place)}</small></div></div>
    ${best && !driverName() ? '<label class="solo-run-name"><span>Name on the leaderboard</span><input maxlength="24" placeholder="Player" spellcheck="false" /></label>' : ''}`;
  const input = slot.querySelector('input');
  if (input) input.onchange = () => {
    const name = cleanName(input.value);
    if (nameProblem(input.value)) input.value = '';
    else void renameDriver(name, secret);
  };
}
