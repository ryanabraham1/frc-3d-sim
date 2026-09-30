import './app/styles.css';
import type { Game } from '@engine/core/game';
import type { GameSettings } from '@engine/core/season';
import { showMenu } from './app/menu';

const app = document.getElementById('app')!;
let game: Game | null = null;

function stopGame(): void {
  game?.dispose();
  game = null;
  app.innerHTML = '';
}

async function startGame(settings: GameSettings): Promise<void> {
  stopGame();
  app.innerHTML = '<div class="loading">LOADING FIELD + PHYSICS…</div>';
  // Physics (Rapier WASM) and the renderer load on demand so the menu appears instantly.
  const [{ loadRapier }, { Game }, { getSeason }] = await Promise.all([
    import('@engine/physics/world'),
    import('@engine/core/game'),
    import('@seasons/index'),
  ]);
  const R = await loadRapier();
  app.innerHTML = '';
  const stage = document.createElement('div');
  stage.className = 'stage';
  app.appendChild(stage);
  game = new Game(stage, R, getSeason(settings.seasonId), settings, {
    onExit: () => menu(),
    onRestart: (s) => void startGame(s),
  });
  game.start();
  // Handy for debugging in the console.
  (window as unknown as { game: Game }).game = game;
}

function menu(): void {
  stopGame();
  showMenu(app, (s) => void startGame(s));
}

menu();
