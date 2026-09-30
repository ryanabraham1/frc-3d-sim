import type { Server } from 'node:http';
import type { Plugin } from 'vite';
import { attachRelay, type Relay } from './relay.ts';

/** Mounts the multiplayer relay at /ws on the Vite dev and preview servers. */
export function relayPlugin(): Plugin {
  let relays: Relay[] = [];
  const mount = (http: unknown) => {
    if (!http) return; // middleware mode — no http server to attach to
    relays.push(attachRelay(http as Server, { log: (m) => console.log(`[relay] ${m}`) }));
  };
  return {
    name: 'frc-sim-relay',
    configureServer(server) {
      mount(server.httpServer);
    },
    configurePreviewServer(server) {
      mount(server.httpServer);
    },
    async buildEnd() {
      await Promise.all(relays.map((r) => r.close()));
      relays = [];
    },
  };
}
