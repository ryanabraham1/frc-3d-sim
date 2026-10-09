import './app/styles.css';
import type { Game, GameRecovery } from '@engine/core/game';
import type { GameSettings } from '@engine/core/season';
import type { MatchSetup } from '@engine/net/protocol';
import { LobbyController } from './app/lobby';
import { showMenu } from './app/menu';
import { prepareCadModels } from '@engine/robot/cadModels';

// Back/Forward can restore an old running bundle without making an HTTP request.
// A fresh navigation checks the current HTML and loads the latest hashed game files.
window.addEventListener('pageshow', (event) => {
  if (event.persisted) window.location.reload();
});

const app = document.getElementById('app')!;
let game: Game | null = null;
/** Bumped on every start/stop so a slow load can't install a stale match. */
let generation = 0;
/** The multiplayer lobby lives across menu ↔ match. */
const lobby = new LobbyController();

function stopGame(): void {
  generation++;
  game?.dispose();
  game = null;
  app.innerHTML = '';
}

/** Rapier (WASM), the renderer/game and the season registry: the heavy chunks a match needs, fetched once and shared. */
type EngineModules = { R: Awaited<ReturnType<typeof import('@engine/physics/world').loadRapier>>; Game: typeof import('@engine/core/game').Game; localSetup: typeof import('@engine/core/game').localSetup; getSeason: typeof import('@seasons/index').getSeason };
let engineModules: Promise<EngineModules> | null = null;
function loadEngineModules(): Promise<EngineModules> {
  const p: Promise<EngineModules> = Promise.all([
    import('@engine/physics/world'),
    import('@engine/core/game'),
    import('@seasons/index'),
  ]).then(async ([world, game, seasons]) => ({ R: await world.loadRapier(), Game: game.Game, localSetup: game.localSetup, getSeason: seasons.getSeason }));
  engineModules ??= p;
  p.catch(() => { if (engineModules === p) engineModules = null; });
  return engineModules;
}

/** Fetch the engine in the background while the player is on the menu, so pressing Play doesn't wait for ~6 MB of code + WASM. */
function warmEngine(): void {
  const conn = (navigator as unknown as { connection?: { saveData?: boolean } }).connection;
  if (conn?.saveData) return;
  const idle = (window as unknown as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => void }).requestIdleCallback;
  const run = () => void loadEngineModules().catch(() => {});
  if (idle) idle(run, { timeout: 4000 });
  else setTimeout(run, 1500);
}

/** Longest the match start waits on the network before giving up and offering a retry. */
const ENGINE_LOAD_TIMEOUT_MS = 45_000;
/** Longest the match start waits on robot CAD downloads (slow ones fall back to procedural models and are cached for later). */
const CAD_LOAD_TIMEOUT_MS = 12_000;

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`${what} timed out`)), ms); });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}

function showLoading(text: string): HTMLElement {
  app.innerHTML = '';
  const el = document.createElement('div');
  el.className = 'loading';
  el.textContent = text;
  app.appendChild(el);
  return el;
}

function showLoadError(err: unknown, retry: () => void): void {
  console.error('Match load failed', err);
  app.innerHTML = '';
  const el = document.createElement('div');
  el.className = 'loading failed';
  const msg = document.createElement('div');
  msg.textContent = 'COULDN\u2019T LOAD THE FIELD. CHECK YOUR CONNECTION AND TRY AGAIN.';
  const row = document.createElement('div');
  row.style.cssText = 'display:flex;gap:10px;justify-content:center';
  const again = document.createElement('button');
  again.className = 'primary';
  again.textContent = 'Retry';
  again.onclick = retry;
  const back = document.createElement('button');
  back.textContent = 'Back to menu';
  back.onclick = () => menu(lobby.lobby ? (lobby.lobby.ranked ? 'ranked' : 'multiplayer') : undefined);
  row.append(again, back);
  el.append(msg, row);
  app.appendChild(el);
}

/** `setup` is the match's robot lineup when known (network); otherwise it is derived from the settings. */
async function loadEngine(settings: GameSettings, setup: MatchSetup | undefined, status: (text: string) => void) {
  // Physics (Rapier WASM) and the renderer load on demand so the menu appears instantly.
  status('LOADING PHYSICS\u2026');
  const { R, Game, localSetup, getSeason } = await withTimeout(loadEngineModules(), ENGINE_LOAD_TIMEOUT_MS, 'Engine load');
  // Only fetch/decode the CAD models of robots actually in this match (the full set is ~130 MB).
  const lineup = setup ?? localSetup(settings, getSeason(settings.seasonId));
  status('LOADING ROBOTS\u2026');
  await prepareCadModels(lineup.robots.map((r) => r.config.model), {
    timeoutMs: CAD_LOAD_TIMEOUT_MS,
    onProgress: (done, total) => { if (total > 1) status(`LOADING ROBOTS ${done}/${total}\u2026`); },
  });
  return { R, Game, getSeason };
}

function mountStage(): HTMLElement {
  app.innerHTML = '';
  const stage = document.createElement('div');
  stage.className = 'stage';
  app.appendChild(stage);
  return stage;
}

async function startGame(settings: GameSettings): Promise<void> {
  stopGame();
  if (lobby.client.connected) lobby.leave();
  const gen = generation;
  const loading = showLoading('LOADING FIELD + PHYSICS\u2026');
  let engine: Awaited<ReturnType<typeof loadEngine>>;
  try {
    engine = await loadEngine(settings, undefined, (t) => { loading.textContent = t; });
  } catch (err) {
    if (gen === generation) showLoadError(err, () => void startGame(settings));
    return;
  }
  if (gen !== generation) return;
  const { R, Game, getSeason } = engine;
  game = new Game(mountStage(), R, getSeason(settings.seasonId), settings, {
    onExit: () => menu(),
    onRestart: (s) => void startGame(s),
  });
  game.start();
  // Handy for debugging in the console.
  (window as unknown as { game: Game }).game = game;
}

async function startNetGame(setup: MatchSetup, role: 'host' | 'client', recovery?: GameRecovery): Promise<void> {
  stopGame();
  const gen = generation;
  const loading = showLoading('LOADING FIELD + PHYSICS\u2026');
  const settings = { ...lobby.settings!, seasonId: setup.seasonId, seed: setup.seed };
  const ranked = !!lobby.lobby?.ranked;
  let engine: Awaited<ReturnType<typeof loadEngine>>;
  try {
    engine = await loadEngine(settings, setup, (t) => { loading.textContent = t; });
  } catch (err) {
    if (gen === generation) showLoadError(err, () => void startNetGame(setup, role, recovery));
    return;
  }
  if (gen !== generation) return;
  const { R, Game, getSeason } = engine;
  if (!lobby.client.connected) return menu('multiplayer');
  game = new Game(
    mountStage(),
    R,
    getSeason(setup.seasonId),
    settings,
    {
      onExit: () => {
        lobby.leave();
        menu(ranked ? 'ranked' : 'multiplayer');
      },
      onRestart: () => {},
      ...(ranked ? {} : { onPlayAgain: () => { lobby.backToLobby(); lobby.beginPlacement(); }, onBackToLobby: () => lobby.backToLobby() }),
      onResults: (res, scores) => lobby.reportResult(res.winner, scores.red, scores.blue),
    },
    { role, client: lobby.client, setup, recovering: !!recovery, onCheckpoint: state => lobby.updateRecovery(state) },
  );
  if (recovery) game.restoreRecovery(recovery);
  game.start();
  (window as unknown as { game: Game }).game = game;
}

function menu(page?: 'multiplayer' | 'ranked'): void {
  stopGame();
  showMenu(app, (s) => void startGame(s), { lobby, page });
}

lobby.onStart = (setup, role) => void startNetGame(setup, role);
lobby.onRecover = (setup, role, recovery) => void startNetGame(setup, role, recovery);
lobby.onToLobby = () => menu(lobby.lobby?.ranked ? 'ranked' : 'multiplayer');
// While a match is running, the Game shows its own "Disconnected" dialog; the menu re-renders itself.

// An invite link (?join=CODE) lands straight on the Multiplayer page and joins.
menu(lobby.invite ? 'multiplayer' : undefined);
warmEngine();
