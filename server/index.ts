/**
 * Production server: serves the built static site (dist/) and the multiplayer relay at /ws on one port.
 *   npm run build && npm run serve          → http://localhost:8787
 * Env: PORT (default 8787), HOST (default 0.0.0.0), DIST (default ./dist),
 * TRUST_PROXY (1 = read the client IP from X-Forwarded-For; defaults on when running on Render).
 * Runs directly with Node ≥ 22.18 / 23.6 (built-in TypeScript type stripping) — no build step.
 */
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';
import { brotliCompressSync, constants as zlibConstants, gzipSync } from 'node:zlib';
import { attachRelay } from './relay.ts';
import { createMatchLogStore, matchLogHandler } from './matchLogs.ts';

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

const trustProxy = (process.env.TRUST_PROXY ?? (process.env.RENDER ? '1' : '0')) === '1';
const matchLogs = matchLogHandler(createMatchLogStore(), { trustProxy, log: (m) => console.log(`[match-logs] ${m}`) });

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  if (url.pathname === '/healthz') {
    // CORS so a site hosted elsewhere (e.g. Vercel) can wake/check this relay.
    res.writeHead(200, { 'content-type': 'text/plain', 'access-control-allow-origin': '*', 'cache-control': 'no-store' });
    res.end(`ok rooms=${relay.roomCount()} public=${relay.publicRoomCount()}`);
    return;
  }
  if (url.pathname === '/api/match-logs') {
    matchLogs(req, res);
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
  const stat = statSync(file);
  const hashed = ext !== '.html' && /^\/assets\/[^/]+-[\w-]{8,}\.(js|css)$/.test(url.pathname);
  // Hashed build files never change. Models/audio/textures keep their names, so let browsers reuse them for an hour and
  // refresh in the background after that; HTML must always be current. Everything else revalidates with an ETag (304).
  const cacheControl = hashed
    ? 'public, max-age=31536000, immutable'
    : ext === '.html' ? 'no-store'
    : /^\/(models|assets|audio)\//.test(url.pathname) ? 'public, max-age=3600, stale-while-revalidate=604800'
    : 'no-cache';
  const etag = `W/"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`;
  const headers: Record<string, string | number> = { 'content-type': MIME[ext] ?? 'application/octet-stream', 'cache-control': cacheControl, etag, vary: 'accept-encoding' };
  if (ext !== '.html' && req.headers['if-none-match'] === etag) {
    res.writeHead(304, headers);
    res.end();
    return;
  }
  const accept = String(req.headers['accept-encoding'] ?? '');
  const enc = COMPRESSIBLE.has(ext) ? (/\bbr\b/.test(accept) ? 'br' : /\bgzip\b/.test(accept) ? 'gzip' : '') : '';
  if (enc) {
    // Compress once per file version and keep it in memory: the 4.6 MB Rapier chunk shrinks by ~2/3 and costs no CPU per request.
    const key = `${enc}:${file}:${etag}`;
    let body = compressed.get(key);
    if (!body) {
      const raw = readFileSync(file);
      body = enc === 'br' ? brotliCompressSync(raw, { params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 5, [zlibConstants.BROTLI_PARAM_SIZE_HINT]: raw.length } }) : gzipSync(raw, { level: 6 });
      compressed.set(key, body);
    }
    res.writeHead(200, { ...headers, 'content-encoding': enc, 'content-length': body.length });
    res.end(body);
    return;
  }
  res.writeHead(200, { ...headers, 'content-length': stat.size });
  createReadStream(file).pipe(res);
});

/** Text-like files worth compressing (GLBs are already meshopt-compressed; images are already compressed). */
const COMPRESSIBLE = new Set(['.html', '.js', '.css', '.json', '.svg', '.wasm']);
const compressed = new Map<string, Buffer>();

const relay = attachRelay(server, { rejectOtherPaths: true, trustProxy, log: (m) => console.log(`[relay] ${m}`) });

server.listen(PORT, HOST, () => {
  console.log(`[serve] http://localhost:${PORT}  (relay at ws://localhost:${PORT}/ws)`);
});
