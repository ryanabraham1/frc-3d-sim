# Cloudflare relay and direct multiplayer

The frontend is a static Vite build on Vercel. The host browser still runs physics, bots and scoring.
Cloudflare carries lobby management, ranked matchmaking, recovery checkpoints and WebRTC signaling.
Once a direct host/client data channel opens, driver commands and snapshots use that link. Other
players continue using the WebSocket relay in the same room. If negotiation fails or the direct link
closes, game traffic automatically uses the relay again. Lobby messages always stay on the relay.

## Deploy the relay

Use the Workers **Free** plan. The SQLite-backed Durable Object migration in
`cloudflare/wrangler.jsonc` is compatible with that plan; no paid plan or domain is required.

```sh
npm ci
npx wrangler login
npm run cloudflare:typecheck
npm run cloudflare:deploy
npm run cloudflare:smoke -- https://frc-3d-sim-relay.ryan-ryanabraham.workers.dev
```

The deployed client URL is:
`wss://frc-3d-sim-relay.ryan-ryanabraham.workers.dev/ws`.
`/healthz` reports aggregate room/connection counts, without exposing private room codes or tokens.

The Worker uses the same relay core and ranked service as the Node server. One coordinator is used
for this small community deployment so public discovery and ranked queues work across rooms. It
caps sockets at 200 globally and 24 per IP, and retains the original per-IP request limits. Room
state is in memory, as with the original Node relay: redeploying or a runtime restart can end rooms.
Standard accepted WebSockets keep the coordinator active while connected; this version does not
use WebSocket hibernation. After all sockets close, timers are stopped after the reconnect window.
Free-plan request/compute allowances still apply, especially when many players require fallback.

## Preserve ranked ratings

Copy the existing Render server values into Worker secrets using the interactive prompts:

```sh
npx wrangler secret put SUPABASE_URL --config cloudflare/wrangler.jsonc
npx wrangler secret put SUPABASE_SERVICE_KEY --config cloudflare/wrangler.jsonc
```

These are server-only secrets. Never set the service key as a Vercel frontend variable or prefix it
with `VITE_`. With both secrets set, the same Supabase REST store and existing ranked schema are
used. Without them, the original development in-memory store is used and ratings reset on restart.
No database migration is required.

## Deploy the frontend on Vercel

Use a Vite project, `npm run build`, and output directory `dist` (already in `vercel.json`). Set
`VITE_RELAY_URL=wss://frc-3d-sim-relay.ryan-ryanabraham.workers.dev/ws` for Production and Preview.
Redeploy after changing this value: Vite embeds it at build time. Share the Vercel production URL,
not the Worker URL. Frontend and relay releases are separate; updating one does not deploy the other.

## Local checks and fallback diagnostics

```sh
npm run cloudflare:dev
# In another terminal:
VITE_RELAY_URL=ws://localhost:8787/ws npm run dev
npm run cloudflare:smoke -- http://localhost:8787
```

The Multiplayer lobby shows direct/relay connections. Append `?relayOnly` to a player's URL to
force relay use and check a mixed room. Set `VITE_DIRECT_CONNECTIONS=false` at build time to disable
direct connections for a deployment. WebRTC uses public STUN for discovery; restricted networks
fall back to Cloudflare WebSockets, so a separate TURN service is not required. Only host/client
links are negotiated; clients cannot signal to other clients or peers in other rooms.

Driver command sequence numbers discard controls delayed by a switch between transports. Client
snapshot sequence numbers discard duplicate/old frames; missing deltas request a recovery keyframe.
A single ordered data channel keeps direct snapshots in order. Congested direct links skip stale
snapshots and recover through the existing keyframe protocol.

Verify with `direct-transport`, `net-client-recovery`, `relay`, `ranked-relay`, `lobby-online`,
`lobby-churn`, `host-recovery` and `netsync` tests, plus the Worker smoke test and two browser players.
