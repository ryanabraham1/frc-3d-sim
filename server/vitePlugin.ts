import type { Server } from 'node:http';
import type { Plugin } from 'vite';
import { attachRelay, type Relay } from './relay.ts';
import { createMatchLogStore, matchLogHandler } from './matchLogs.ts';

/** Mounts the multiplayer relay at /ws on the Vite dev and preview servers. */
export function relayPlugin(): Plugin {
  let relays: Relay[] = [];
  const health = (_req: unknown, res: { setHeader: (name: string, value: string) => void; end: (body: string) => void }) => {
    res.setHeader('content-type', 'text/plain');
    res.setHeader('cache-control', 'no-store');
    res.end(`ok rooms=${relays[0]?.roomCount() ?? 0}`);
  };
  const mount = (http: unknown) => {
    if (!http) return; // middleware mode — no http server to attach to
    relays.push(attachRelay(http as Server, { log: (m) => console.log(`[relay] ${m}`) }));
  };
  return {
    name: 'frc-sim-relay',
    configureServer(server) {
      mount(server.httpServer);
      server.middlewares.use('/healthz', health);
      // Match logs for imitation learning: data/demos/*.jsonl (Supabase when its env vars are set).
      server.middlewares.use('/api/match-logs', matchLogHandler(createMatchLogStore(), { log: (m) => console.log(`[match-logs] ${m}`) }));
    },
    configurePreviewServer(server) {
      mount(server.httpServer);
      server.middlewares.use('/healthz', health);
      server.middlewares.use('/api/match-logs', matchLogHandler(createMatchLogStore(), { log: (m) => console.log(`[match-logs] ${m}`) }));
    },
    async buildEnd() {
      await Promise.all(relays.map((r) => r.close()));
      relays = [];
    },
  };
}
