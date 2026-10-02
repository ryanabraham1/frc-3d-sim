/**
 * Browser smoke test for a season: screenshots the menu, rules page and field, then fast-forwards a full
 * match (scripted AUTO + idle TELEOP) in the real game and reports page errors and the final score.
 *
 * Setup (keeps Playwright out of the project's dependencies):
 *   mkdir -p /tmp/pw && cd /tmp/pw && npm init -y && npm install playwright-core
 *   npm run dev -- --port 5173 --strictPort        # in the repo, in the background
 *   NODE_PATH=/tmp/pw/node_modules node tools/browser-smoke.mjs 2024-crescendo /tmp/shots
 *
 * CHROME defaults to the cloud sandbox's pre-installed Chromium; override with CHROME=/path/to/chrome.
 */
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright-core');
const [seasonId = '2024-crescendo', out = './shots'] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const chrome = process.env.CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const url = process.env.URL ?? 'http://localhost:5173/';

const browser = await chromium.launch({ executablePath: chrome, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1400, height: 860 } });
const problems = [];
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
page.on('console', (m) => m.type() === 'error' && !m.text().includes('CERT') && problems.push(`console: ${m.text()}`));

await page.goto(url);
await page.waitForSelector('[data-k="season"]');
await page.selectOption('[data-k="season"]', seasonId);
await page.waitForTimeout(400);
await page.screenshot({ path: `${out}/menu.png` });
await page.click('[data-page="rules"]');
await page.screenshot({ path: `${out}/rules.png`, fullPage: true });
await page.click('[data-page="play"]');
// Use the first scripted AUTO routine instead of manual AUTO driving.
const routine = await page.$('[data-routine]');
if (routine) await routine.click();
await page.click('[data-toggle="manualAuto"]');
await page.click('[data-k="start"]');
await page.waitForFunction(() => !!window.game, null, { timeout: 60000 });
await page.waitForTimeout(2500);
for (const mode of ['driver', 'overhead', 'chase']) {
  await page.evaluate((m) => window.game.camera.setMode(m), mode);
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${out}/camera-${mode}.png` });
}
const idle = { forward: 0, left: 0, rotate: 0, shoot: false, pass: false, intake: false, climb: false, descend: false, humanPlayer: false, humanPlayerAlt: 0, precision: false, levelUp: false, levelDown: false, setLevel: null, cameraNext: false, cameraFlip: false, pause: false, restart: false, toggleIntake: false, toggleHelp: false };
const result = await page.evaluate((idle) => {
  const g = window.game;
  const dt = g.physics.dt;
  let autoScore = null;
  for (let i = 0; i < 400 / dt && !g.clock.finished; i++) {
    g.step(dt, idle);
    if (autoScore === null && g.clock.started && g.clock.mode === 'teleop') autoScore = { blue: g.score.total('blue'), red: g.score.total('red') };
  }
  return { finished: g.clock.finished, autoScore, final: { blue: g.score.total('blue'), red: g.score.total('red') }, fouls: g.score.fouls.map((f) => f.rule) };
}, idle);
await page.waitForTimeout(800);
await page.screenshot({ path: `${out}/results.png` });
console.log(JSON.stringify(result));
console.log(problems.length ? problems.join('\n') : 'no page errors');
await browser.close();
process.exit(problems.length ? 1 : 0);
