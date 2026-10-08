import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer, type WebSocket } from 'ws';
import { MAX_FRAME_BYTES, RELAY_PATH } from '../src/engine/net/relayProtocol.ts';
import { createRelayCore, type Relay, type RelayOptions } from './relayCore.ts';
export type { Relay, RelayOptions, RelayLimits } from './relayCore.ts';

/** Node HTTP adapter; room and ranked logic is shared with the Cloudflare Worker. */
export function attachRelay(server: Server, opts: RelayOptions = {}): Relay {
  const path = opts.path ?? RELAY_PATH;
  const limits = { connections: 24, ...opts.limits };
  const connCount = new Map<string, number>();
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_FRAME_BYTES });
  const clientIp = (req: IncomingMessage): string => {
    if (opts.trustProxy) {
      const fwd = req.headers['x-forwarded-for'];
      const first = (Array.isArray(fwd) ? fwd[0] : fwd)?.split(',')[0]?.trim();
      if (first) return first;
    }
    return req.socket.remoteAddress ?? 'unknown';
  };

  const onUpgrade = (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const url = new URL(req.url ?? '/', 'http://x');
    if (url.pathname !== path) {
      // Not ours (e.g. Vite HMR) — leave it for other listeners unless we own the whole server.
      if (opts.rejectOtherPaths) socket.destroy();
      return;
    }
    const ip = clientIp(req);
    if (limits.connections > 0 && (connCount.get(ip) ?? 0) >= limits.connections) {
      socket.write('HTTP/1.1 429 Too Many Requests\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req, ip));
  };
  server.on('upgrade', onUpgrade);

  wss.on('connection', (ws: WebSocket, _req: IncomingMessage, ip: string) => {
    connCount.set(ip, (connCount.get(ip) ?? 0) + 1);
    ws.on('close', () => {
      const n = (connCount.get(ip) ?? 1) - 1;
      if (n > 0) connCount.set(ip, n); else connCount.delete(ip);
    });
  });
  const core = createRelayCore(wss, opts);
  return { ...core, close: () => { server.off('upgrade', onUpgrade); return core.close(); } };
}
