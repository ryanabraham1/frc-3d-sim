/**
 * Production server: serves the built static site (dist/) and the multiplayer relay at /ws on one port.
 *   npm run build && npm run serve          → http://localhost:8787
 * Env: PORT (default 8787), HOST (default 0.0.0.0), DIST (default ./dist),
 * TRUST_PROXY (1 = read the client IP from X-Forwarded-For; defaults on when running on Render).
 * Runs directly with Node ≥ 22.18 / 23.6 (built-in TypeScript type stripping) — no build step.
 */
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';
import { attachRelay } from './relay.ts';

const PORT = Number(process.env.PORT ?? 8787);
const HOST = process.env.HOST ?? '0.0.0.0';
const DIST = resolve(process.env.DIST ?? 'dist');

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.wasm': 'application/wasm',
  '.glb': 'model/gltf-binary',
  '.woff2': 'font/woff2',
};

if (!existsSync(join(DIST, 'index.html'))) {
  console.warn(`[serve] ${DIST}/index.html not found — run "npm run build" first. Relay will still run.`);
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  if (url.pathname === '/healthz') {
    // CORS so a site hosted elsewhere (e.g. Vercel) can wake/check this relay.
    res.writeHead(200, { 'content-type': 'text/plain', 'access-control-allow-origin': '*', 'cache-control': 'no-store' });
    res.end(`ok rooms=${relay.roomCount()} public=${relay.publicRoomCount()}`);
    return;
  }
  let file = normalize(join(DIST, decodeURIComponent(url.pathname)));
  if (!file.startsWith(DIST)) {
    res.writeHead(403);
    res.end();
    return;
  }
  if (!existsSync(file) || statSync(file).isDirectory()) file = join(DIST, 'index.html');
  if (!existsSync(file)) {
    res.writeHead(404);
    res.end('Not found');
    return;
  }
  const ext = extname(file);
  res.writeHead(200, {
    'content-type': MIME[ext] ?? 'application/octet-stream',
    // Cache only content-hashed build assets forever. SPA fallbacks must always fetch current HTML.
    'cache-control': ext !== '.html' && /^\/assets\/[^/]+-[\w-]{8,}\.(js|css)$/.test(url.pathname)
      ? 'public, max-age=31536000, immutable'
      : ext === '.html' ? 'no-store' : 'no-cache, max-age=0, must-revalidate',
  });
  createReadStream(file).pipe(res);
});

const relay = attachRelay(server, { rejectOtherPaths: true, trustProxy: (process.env.TRUST_PROXY ?? (process.env.RENDER ? '1' : '0')) === '1', log: (m) => console.log(`[relay] ${m}`) });

server.listen(PORT, HOST, () => {
  console.log(`[serve] http://localhost:${PORT}  (relay at ws://localhost:${PORT}/ws)`);
});
