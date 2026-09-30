import './app/styles.css';
import type { Game } from '@engine/core/game';
import type { GameSettings } from '@engine/core/season';
import type { MatchSetup } from '@engine/net/protocol';
import { LobbyController } from './app/lobby';
import { showMenu } from './app/menu';

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

async function loadEngine() {
  // Physics (Rapier WASM) and the renderer load on demand so the menu appears instantly.
  const [{ loadRapier }, { Game }, { getSeason }] = await Promise.all([
    import('@engine/physics/world'),
    import('@engine/core/game'),
    import('@seasons/index'),
  ]);
  return { R: await loadRapier(), Game, getSeason };
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
  app.innerHTML = '<div class="loading">LOADING FIELD + PHYSICS…</div>';
  const { R, Game, getSeason } = await loadEngine();
  if (gen !== generation) return;
  game = new Game(mountStage(), R, getSeason(settings.seasonId), settings, {
    onExit: () => menu(),
    onRestart: (s) => void startGame(s),
  });
  game.start();
  // Handy for debugging in the console.
  (window as unknown as { game: Game }).game = game;
}

async function startNetGame(setup: MatchSetup, role: 'host' | 'client'): Promise<void> {
  stopGame();
  const gen = generation;
  app.innerHTML = '<div class="loading">LOADING FIELD + PHYSICS…</div>';
  const { R, Game, getSeason } = await loadEngine();
  if (gen !== generation) return;
  if (!lobby.client.connected) return menu('multiplayer');
  const settings = { ...lobby.settings!, seasonId: setup.seasonId, seed: setup.seed };
  game = new Game(
    mountStage(),
    R,
    getSeason(setup.seasonId),
    settings,
    {
      onExit: () => {
        lobby.leave();
        menu('multiplayer');
      },
      onRestart: () => {},
      onPlayAgain: () => lobby.startMatch(),
      onBackToLobby: () => lobby.backToLobby(),
    },
    { role, client: lobby.client, setup },
  );
  game.start();
  (window as unknown as { game: Game }).game = game;
}

function menu(page?: 'multiplayer'): void {
  stopGame();
  showMenu(app, (s) => void startGame(s), { lobby, page });
}

lobby.onStart = (setup, role) => void startNetGame(setup, role);
lobby.onToLobby = () => menu('multiplayer');
// While a match is running, the Game shows its own "Disconnected" dialog; the menu re-renders itself.

menu();
