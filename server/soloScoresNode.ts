import type { IncomingMessage, ServerResponse } from 'node:http';
import { UploadLimiter } from './matchLogCore.ts';
import { createSoloScoreStore, handleSoloScoreRequest, type SoloScoreStore } from './soloScores.ts';

const MAX_REQUEST_BYTES = 512 * 1024;

/** Mounts /api/solo-scores on a Node http server or Vite's middleware stack. */
export function soloScoreHandler(store: SoloScoreStore = createSoloScoreStore(process.env), opts: { trustProxy?: boolean; log?: (msg: string) => void } = {}) {
  const limiter = new UploadLimiter();
  return (req: IncomingMessage, res: ServerResponse): void => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_REQUEST_BYTES) { res.writeHead(413).end(); req.destroy(); } else chunks.push(c);
    });
    req.on('end', () => void (async () => {
      const fwd = opts.trustProxy ? req.headers['x-forwarded-for'] : undefined;
      const ip = (Array.isArray(fwd) ? fwd[0] : fwd)?.split(',')[0]?.trim() || req.socket.remoteAddress || 'unknown';
      const secret = req.headers['x-solo-secret'];
      // Vite strips the mount path from req.url, so only the query is read from it.
      const url = `http://relay/api/solo-scores${(req.originalUrl ?? req.url ?? '').replace(/^[^?]*/, '')}`;
      const hasBody = req.method === 'POST' || req.method === 'PUT';
      const request = new Request(url, { method: req.method, headers: typeof secret === 'string' ? { 'x-solo-secret': secret } : {}, ...(hasBody ? { body: Buffer.concat(chunks) } : {}) });
      const out = await handleSoloScoreRequest(request, store, limiter, ip, opts.log);
      res.writeHead(out.status, Object.fromEntries(out.headers));
      res.end(await out.text());
    })());
  };
}

declare module 'node:http' {
  interface IncomingMessage { originalUrl?: string }
}
