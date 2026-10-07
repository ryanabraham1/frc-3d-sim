## Playing duos against bots

Create a room and share its code with your friend. Choose two driver stations on the same alliance. Leave **Fill with bots** enabled and choose the bot difficulty. When both drivers lock in their positions and autos, the host starts a full 3 vs 3 match: you, your friend, and one bot teammate against three bots. Humans can take any bot-marked station before the match starts. Choose **Leave empty** for a match with only human drivers. Bots run on the host and use the same season physics and rules as singleplayer; they do not join the room or count toward network readiness.

# Multiplayer — Implementation Plan & Hand-off Log

> **Hand-off doc.** If you are an agent picking this up: read §1–§4 for the design, then go to
> §6 **Progress** and continue from the first unchecked item. Update §6/§7 as you land work.
> Master project plan: [../PLAN.md](../PLAN.md). Design constraint from the user: **no bot AI** —
> every robot on the field is driven by a human (or by its driver's chosen AUTO routine in AUTO).

---

## 1. Goal

Up to 6 human players (red 1–3, blue 1–3) plus spectators play one match together in the browser.
One player creates a room and shares a 4-letter code; others join with the code, pick a driver
station, bring their own robot config, and the host starts the match.

## 2. Architecture (decided)

```
 ┌────────── host browser ──────────┐        ┌──── relay (Node + ws) ────┐        ┌──── client browser ────┐
 │ Game(role='host')                │  JSON  │ rooms, peer ids, fan-out  │  JSON  │ Game(role='client')    │
 │  full Rapier sim + season rules  │◄──────►│ binary host→all clients   │◄──────►│  no physics stepping;  │
 │  HostSync: remote cmds → robots, │ binary │ JSON client→host          │ binary │  ClientSync applies    │
 │  30 Hz snapshots → relay         │───────►│                           │───────►│  interpolated snapshots│
 └──────────────────────────────────┘        └───────────────────────────┘        └────────────────────────┘
```

| Decision | Choice | Why |
|---|---|---|
| Authority | **Host's browser** runs the one true simulation (existing `Game` + Rapier + season rules). | Zero engine duplication; no headless/Node port of rendering-coupled code; season modules need no net code beyond a tiny state hook. |
| Transport | **WebSocket relay** (`ws` package). Tiny, game-agnostic: rooms + fan-out. | Vercel can't hold sockets; WebRTC still needs signaling + TURN. A relay is ~200 lines and runs anywhere. |
| Where the relay runs | (a) **dev**: Vite plugin mounts it at `/ws` on the dev/preview server → `npm run dev` just works (LAN: `--host`). (b) **prod**: `npm run serve` = one Node process serving `dist/` + `/ws` (Render/Railway/Fly/any VPS). (c) static site elsewhere (Vercel) + `VITE_RELAY_URL=wss://relay.example.com/ws`. | One code path for all three. |
| Client sim | Clients **don't step physics**. They render snapshots with ~100 ms interpolation. Own robot: optional prediction (stage M8). | Simple + correct first; prediction is an add-on. |
| Commands | Client sends its `RobotCommand` (already field-frame, camera-relative conversion done locally) ~30 Hz + on button change. Host holds last command per robot. | `RobotCommand` was designed as the multiplayer seam. |
| Snapshots | Binary, 30 Hz (every 3rd 90 Hz step): all robots (pose, turret, held, climb) + only **moved** FUEL (int16 mm) + a JSON "meta" tail (clock, game state, piece state changes, score/rules when changed). Keyframe (everything) on start and when a client reports `ready`. | ~1–2 KB/snapshot → ~50 KB/s per client. Relay is reliable+ordered so deltas are safe. |
| Host timing | Host sim is driven by a **Web Worker ticker** (not rAF) so the match keeps running if the host tab is in the background; rendering stays on rAF. | rAF stops in hidden tabs → would freeze everyone. |
| Lobby | Host-authoritative lobby state (players, slots, options) broadcast on change. Robot configs travel with `lobby-set`. | Host already the authority. |
| Season contract | Add optional `SeasonRules.netState()/applyNetState()`, `SeasonContext.humanPlayerIsAuto(a)`, and a `robot` arg to `ctx.toast` (targeted toasts). | Minimal, year-agnostic. Future seasons implement the two state hooks. |
| Singleplayer | Unchanged behaviour: `role='local'`, rAF loop, one robot. | Don't regress. |

### 2.1 Relay protocol (`src/engine/net/relayProtocol.ts`, server `server/relay.ts`)

Text frames are JSON envelopes; binary frames are opaque.

| Dir | Message |
|---|---|
| C→S | `{op:'create', name, meta?}` → `{op:'created', room, peerId, token}` (sender becomes host; `meta.visibility` defaults to private) |
| C→S | `{op:'join', room, name}` → `{op:'joined', room, peerId, hostId, token}` or `{op:'error', message}`; host gets `{op:'peer-joined', peerId, name}` |
| C→S | `{op:'rejoin', room, token}` → `{op:'joined', …, resumed:true}`; resumes a dropped connection (same peer id) within 30 s. Host gets `peer-back`, clients get `host-back` |
| C→S | `{op:'list'}` → `{op:'rooms', rooms:[{code,title,host,season,players,max,drivers,seats,state,bots}]}` — public rooms only |
| C→S | host: `{op:'meta', meta}` (visibility, title, season, drivers, state, bots) keeps the list accurate; `{op:'kick', peerId}` removes a peer (banned by IP for the room's lifetime) |
| C→S | `{op:'send', data, to?}` — from a client always goes to host; from host goes to `to` or all clients. Receiver gets `{op:'msg', from, data}` |
| C→S | binary — host only → forwarded to all clients |
| S→C | `{op:'peer-left', peerId}` (to host); `{op:'room-closed', reason}` (to clients when host leaves) |
| S→C | `{op:'peer-lost', peerId}` (to host) / `{op:'host-lost'}` (to clients): a socket dropped, the seat is held for the grace period; `peer-left` / `room-closed` follow only if it doesn't come back |

Limits: 12 peers/room, 256 KB max frame, ping/pong keep-alive every 20 s, codes = 4 letters (no I/O).
Per IP: 24 sockets, 8 room creations/min, 20 failed joins/min (stops code guessing). Set `TRUST_PROXY=1` behind a proxy so the
real client IP is used (on by default on Render). A deliberate leave closes with code 4000 and frees the seat at once; any other
close (network drop, sleep) is a drop and gets the 30 s grace.

### 2.2 Game protocol (`src/engine/net/protocol.ts`)

Client→host `data`: `lobby-set {name, slot, robot, autoRoutine, manualAuto}` · `ready` · `cmd {c:[vx,vy,omega,flags,climb], s:seq}` · `hp` (human player button) · `resync` (missed a snapshot → host sends a keyframe).
Host→client `data`: `lobby {lobby}` · `start {setup}` · `toast {msg,kind,alliance}` · `to-lobby` · `closed`.
Binary snapshot (little-endian):
```
u8 kind=2 | u32 seq | f64 simTime | u8 nRobots | per robot: u8 id f32 x y z yaw turretYaw u8 held u8 flags u8 climbPhase u8 climbLevel i8 climbSlot u8 climbProgress*255 u16 lastCmdSeq
| u16 nPieces | per piece: u16 idx i16 x y z (mm, world) | u32 metaLen | meta JSON (utf-8)
meta = { st: gameState, cd: countdown, clock, pieces?: [[idx,state,owner,tag]...], rotations?: [[idx,x,y,z,w]...],
         score?, rules? (keyframe: full), rulesPatch? (changed top-level keys only), results?, key? }
```

### 2.3 Match setup (`MatchSetup`)
`{ seasonId, seed, autoHumanPlayer, robots: [{ id, slot, alliance, station, config, autoRoutine, manualAuto, peerId, name }] }`
Robot ids = index in `robots` (sorted red1…blue3). Built by the host from the lobby; singleplayer builds a
1-robot setup from `GameSettings`.

## 3. Game flow

1. **Menu → Multiplayer page**: name + *Create room* or *Join* (code). Relay URL is advanced/optional.
2. **Lobby**: 6 station buttons + Spectate; your robot = the robot configured on the Play page; AUTO routine
   choice; host has *Auto human players* toggle + **Start match** (needs ≥1 driver).
3. **Start**: host broadcasts `start{setup}` and builds `Game(role='host')` in state `waiting`; every
   client builds `Game(role='client')` and sends `ready`; host starts the 3 s countdown when all are ready
   (or after 15 s). Keyframe snapshot is sent on each `ready`.
4. **Match**: clients send commands; host steps, applies remote commands, sends snapshots + toasts.
   Host `P` pauses everyone; client `P` opens a local *Leave match* dialog only.
5. **End**: host shows results with *Play again* (same lobby, seed+1) / *Back to lobby* / *Close room*;
   clients see results + "waiting for host" + *Leave*.
6. **Disconnects**: client leaves → its robot goes idle (toast). Host leaves → relay closes room →
   clients get a "host left" modal → menu.

## 4. File map (new/changed)

| File | Role |
|---|---|
| `server/relay.ts` | Room/peer logic, attaches to any Node `http.Server` (`attachRelay`) |
| `server/index.ts` | Standalone prod server: static `dist/` + `/ws` (`npm run serve`) |
| `server/vitePlugin.ts` | Mounts the relay on Vite dev/preview servers |
| `src/engine/net/relayProtocol.ts` | Envelope types shared by server + client |
| `src/engine/net/protocol.ts` | Game messages, `MatchSetup`, lobby types, snapshot codec, cmd packing |
| `src/engine/net/netClient.ts` | Browser WebSocket wrapper (create/join/send/events) |
| `src/engine/net/hostSync.ts` | Host side: remote commands, snapshot building (dirty tracking), toasts |
| `src/engine/net/clientSync.ts` | Client side: snapshot apply, interpolation, command throttling |
| `src/engine/net/ticker.ts` | Worker-based background-safe ticker |
| `src/engine/net/adapter.ts` | **Removed** (old placeholder seam) |
| `src/engine/core/game.ts` | Roles local/host/client, multi-robot setup, split tick/draw |
| `src/engine/core/season.ts` | `netState/applyNetState`, `humanPlayerIsAuto`, targeted toast |
| `src/engine/match/clock.ts`, `scoreboard.ts` | `snapshot()/restore()` |
| `src/engine/robot/robot.ts` | `netState()/applyNet()` for replicas |
| `src/engine/gamepiece/pool.ts` | change tracking (`dirty`), `applyNet*` for replicas |
| `src/seasons/2026-rebuilt/rules.ts` | state hooks, per-alliance auto HP, targeted climb hint |
| `src/app/lobby.ts` | `LobbyController`: NetClient + host lobby logic + start/return events |
| `src/app/menu.ts` | Multiplayer nav page |
| `src/main.ts` | Owns the LobbyController across menu ↔ game |
| `tests/net*.test.ts` | codec, clock/score roundtrip, relay integration |

## 5. Verification recipe
- `npm test`, `npm run typecheck`, `npm run build`.
- `npm run dev` → tab A: Multiplayer → Create room (take Blue 2) → tab B: Join code (take Red 1) →
  A: Start. Both tabs should show both robots; driving in B moves the red robot in A; scores/clock match.
- In the Claude Browser pane: open two tabs (`tabs_create`), drive via `window.game` in each.
- `npm run build && npm run serve` → same test on http://localhost:8787.

## 6. Progress

Legend: `[x]` done · `[~]` partial · `[ ]` todo

- [x] **M0** Plan written (this file)
- [x] **M1** Relay server: `server/relay.ts`, `server/index.ts`, `server/vitePlugin.ts`, `npm run serve`, tests (`tests/relay.test.ts`, 3 passing)
- [x] **M2** Protocol + serialization: `protocol.ts` codec, clock/scoreboard/pool/robot/rules state hooks, tests (`tests/net.test.ts`)
- [x] **M3** `NetClient` (browser WebSocket wrapper) + `ticker.ts`
- [x] **M4** Game refactor: `MatchSetup`, roles, `HostSync`, `ClientSync`, waiting/ready, pause/results/disconnect handling (typechecks; browser-verify in M7)
- [x] **M5** Season contract changes + REBUILT rules hooks (targeted toasts, per-alliance auto HP)
- [x] **M6** Lobby: `LobbyController` (`src/app/lobby.ts`) + Multiplayer page (`src/app/multiplayer.ts/.css`, hooked into `menu.ts` via `showMenu(..., {lobby, page})` + a *Multiplayer* bottom-bar tab) + main.ts wiring (play again / back to lobby)
- [x] **M7** Browser verification with two tabs (host + client), fix issues
- [x] **M8** Own-robot client prediction with server reconciliation (`src/engine/net/prediction.ts`, `tests/prediction.test.ts`)
- [x] **M9** Docs: README, PLAN.md, FRAMEWORK.md, memory; `render.yaml`; final test/typecheck/build

## 2.5 Lobbies, discovery and reconnect

- **Public vs private.** A room is private (code or invite link only) or public (listed in the *Public lobbies* browser).
  The host can flip it any time in Match options and name the room. The list shows host, game, drivers seated, players and
  whether the room is open, starting or in a match; the page polls it every 4 s over an idle relay socket that Create/Join then
  reuse (no extra connect delay). `LobbyState.visibility/title/chat` are the lobby's copy; the host pushes `meta` to the relay
  whenever they change (`LobbyController.pushMeta`).
- **Quick play** joins the fullest open public lobby, or hosts a new public one when there is none.
- **Invite links.** `?join=CODE` opens the Multiplayer page and joins (once a name is saved; otherwise it prefills the code).
  *Copy invite link* in the lobby builds one.
- **Reconnect.** `NetClient` resumes a dropped socket with its token for ~28 s (backoff 0.4 → 3 s). During the gap the host's robot
  for that driver idles, the relay buffers nothing, and on return the host sends a keyframe and the lobby. A host blip keeps the
  room and the running sim; clients see "host lost connection". Closing the tab (`pagehide`) is a deliberate leave.
- **Lobby chat + moderation.** Host-relayed chat (last 40 lines, 200 chars, 400 ms per-player rate limit) and host *Remove*.
- Tests: `tests/relay.test.ts` (listing, meta, rejoin, kick, rate limits) and `tests/lobby-online.test.ts` (the real
  `LobbyController` + `NetClient` against a real relay).

## 2.4 Performance & lag (4+ players)

Measured on 2026 REBUILT with 4 robots plowing through ~450 FUEL: the host spends ~5 ms per 90 Hz step
(~3.7 ms is Rapier), i.e. about half a core on a fast CPU before it renders anything. What keeps a match
responsive:

| Where | What | Why |
|---|---|---|
| Client | Input, commands and prediction run on the worker `Ticker` (120 Hz), not rAF. | A slow rendered frame used to delay commands and key releases by whole frames ("can't move"). |
| Client | Prediction RTT: samples capped at 1 s; the estimate falls fast, rises slowly. | The first ack arrives while the host is still loading (seconds). The old EMA kept a multi-second RTT for a long time, so prediction compared the host pose with where you were seconds ago and dragged the robot back. |
| Client | Interpolation delay adapts to arrival jitter (50–350 ms, eased). Robots extrapolate ≤ 100 ms past the newest snapshot. | Low delay on good links; no freeze-then-jump on a late packet. |
| Client | A sequence gap requests a keyframe and retries ≤ 1/s until recovery; piece/rules deltas wait for that keyframe. | A dropped recovery frame no longer leaves replica state incomplete indefinitely. |
| Client | Prediction reconciles only the newest pose in a received burst. | Queued poses cannot repeatedly pull the robot backward before local physics advances. |
| Relay | Drops host binary frames for a peer with > `MAX_BINARY_BACKLOG` (16 KiB) queued. | Limits stale snapshot backlog on a slow link. |
| Host | Skips a snapshot while > 16 KiB is queued on its socket. Deltas carry over. | Everything queued there is latency for every client. |
| Multiplayer | The worker allows one outstanding tick; host catch-up steps send one fresh snapshot per tick. | Avoids timer and snapshot bursts after a main-thread stall. |
| Host | Renders less often (30 / 20 fps) when the simulation needs > 30% / 50% of wall time (`netStats().hostSimLoad`). | The host's simulation is everyone's game; its own view comes second. |
| Host | Snapshots skip sleeping pieces once their resting pose went out. Tube orientation is sent only when it changes (1e-4). Rules state is diffed per top-level key. | 2025 snapshots were 830 B avg (every CORAL rotation + all placements, because the cages swing), now ~190 B. |
| Relay | Clock rounded to ms and sent ~10 Hz (every 3rd snapshot, plus on any period change). | Less traffic through a free-tier relay. |
| All | Intake zone computed once per robot per step; the piece loop is skipped when nobody intakes. `GamePiecePool.syncVisuals` skips resting pieces. | Hundreds of Rapier reads and matrix updates per frame saved. |
| All | Pixel ratio capped at 1.5. Dynamic resolution steps down to 0.75 when fps < 45 and back up when > 57. The FPS meter uses real elapsed time. | GPU headroom on laptops. The clamped meter reported 2 fps as 10. |

Debug: append `?perf&fps` for the CPU/network panel, or inspect `game.netStats()`. See [performance diagnostics](PERFORMANCE.md).

## 7a. Known limitations / next steps
- **Host is a player's browser.** If the host closes the tab the room ends. Next step: a headless host
  (Node + Rapier; needs a DOM-free `Game` split — see `src/engine/testing/headless.ts` from the shot-fix
  session as a starting point) so the relay can own the simulation.
- Clients don't simulate game pieces; the own-robot prediction ignores FUEL contact (small corrections
  when plowing through balls). Other robots render ~100 ms in the past.
- A client that closes the tab (or is away past the grace period) cannot rejoin a running match; it rejoins for the next one.
  A brief network drop does resume mid-match.
- Private room codes are 4 letters; the per-IP failed-join limit makes guessing impractical but there is no password. Chat is
  lobby-only (not in the match HUD) and unmoderated beyond host *Remove*.
- Relay protocol has no version field — bump `SNAPSHOT_KIND` / add one if the wire format changes.

## 7. Log
- 2026-09-29: Plan written. Existing seams: `RobotCommand`, `robots[]`, placeholder `net/adapter.ts`.
- 2026-09-29: M1 done. `ws` added as dependency (+ `@types/ws`, `@types/node`). tsconfig now includes `server/`
  and `allowImportingTsExtensions` (server files import with `.ts` so Node 22.18+/25 runs them directly via
  type stripping — keep server code to *erasable* TS only: no enums/namespaces/parameter properties).
  `npm run serve` verified (`/healthz`). NOTE for agents on Windows: use `PYTHONUTF8=1` if editing files via
  Python — default cp1252 silently breaks replacements containing `—`.
- 2026-09-29: M2 done (52 tests pass). Season contract: `SeasonContext.humanPlayerIsAuto(a)`, `toast(msg, kind,
  alliance, robot?)`, optional `SeasonRules.netState/applyNetState` (REBUILT: first-inactive, grace, chute doors).
  Another Claude session concurrently restyled `src/app/menu.ts` (commit 283329c) — keep multiplayer UI in its own
  files and only add a small entry point to the menu.
- 2026-09-29: M3–M5 done. `Game(container, R, season, settings, callbacks, net?)` — `net = {role, client, setup}`.
  Host sim runs from `Ticker` (worker) + rAF draw; client replica robots are kinematic, pieces never enabled.
  `localSetup(settings)` builds the singleplayer MatchSetup. `window.game.netStats()` for bandwidth.
  Removed `src/engine/net/adapter.ts`. NOTE: `tests/passing.test.ts` (2 solver tests) failing at this moment is
  the *other* session's in-progress shot-accuracy fix in robot.ts `solveShot/launch` — not multiplayer.
- User asked (mid-task): when done, tell them which **free service** deployment needs (see §8).
- 2026-09-29: M6 done (typechecks). Next: M7 browser test. Launch config `mp-dev` (port 5180) added to
  `.claude/launch.json` because the other session's dev server uses 5173.
- 2026-09-29: M7 verified in the Browser pane with two tabs on `mp-dev` (5180): create/join, slot pick, start →
  ready handshake → countdown, client W+Space moved its red robot on the host and scored 8 FUEL (score, HUD,
  hub state replicated), host pause/resume → client modal, results → client results, Play again, Back to lobby,
  client leave (host toast "disconnected — robot idle", cmd cleared), host Close room → client "host left" modal.
  Bandwidth ≈ 12 KB/s per client during AUTO. Gotchas: the pane is usually *hidden*, so rAF doesn't run — call
  `game.draw(performance.now())` / `game.tick(...)` manually on the client; host sim keeps running via the worker
  Ticker. The other session's edits trigger Vite full reloads (kills test rooms) — just recreate the room.
  Fixed: joining with a taken station now auto-falls back to a free one (notice explains).
- 2026-09-29: M8 done. `Predictor`: client steps its own (dynamic) robot locally each tick against field colliders,
  records pose history; each snapshot compares the host pose with our pose one RTT ago (RTT measured via the
  `cmdSeq` echo), removes 30% of the error from current pose + history (snap if >1 m / >1 rad). Inactive while
  climbing/disabled/not running (then interpolated like other robots). Dev aid: `?netlag=200` URL param on a
  client adds simulated RTT. Verified at 253 ms RTT: robot responds 44 ms after keypress, 0 extra snaps, final pose
  identical to host. Fixed lobby race: routine `lobby-set` syncs omit `slot` (only explicit picks/initial join move
  a player). Added `robot.projectile` line in Game (requested by the shot-fix session). 67 tests pass.
- 2026-09-29: M9 done. Verified production path (`npm run build` + `npm run serve` on :8787): lobby, spectator
  join (overhead camera, "Spectating" HUD), match streaming. Fixed: stale "WAITING FOR PLAYERS" banner when a
  client's first drawn state is already running; empty player HUD box for spectators (`.hud-player:empty`).
  Singleplayer regression-checked (drive + shoot + G407 still work). Docs updated. `render.yaml` added.

## Season selection

Rooms support both 2026 REBUILT and 2025 REEFSCAPE. The host chooses the season with the menu
dropdown; non-host selectors follow the room and are disabled while joined. Returning to the lobby
allows a host to switch years and start again. Season changes reset incompatible robot/AUTO settings
to that year's defaults while preserving each player's team number.

REEFSCAPE sends the selected reef level with driver commands. The host runs placement, harvesting,
processor/net sensors and climbs; snapshots include CORAL placement records, elevator height, reef
ALGAE availability and tube rotations alongside the existing score, robot and clock data. Spectators
receive the same state. Five-element 2026 driver commands remain supported.

## 8. Deployment

Multiplayer needs a server that holds WebSockets open, so Vercel alone won't work.

**Recommended for an instant-loading page: separate static site + Render web service.** Render's free
web service supports WebSockets, sleeps after 15 minutes without inbound traffic, and takes about a
minute to wake. Its static site stays available while the web service sleeps.

1. Push this repo to GitHub. Deploy the relay on Render: New → Blueprint → select this repo (`render.yaml`). Note its URL,
   `https://<service>.onrender.com`. The blueprint also serves the site, but use the static URL below
   as the public link.
2. Render → New → Static Site → select the same repo. Build command: `npm ci && npm run build`;
   publish directory: `dist`.
3. On the static site's environment settings, set
   `VITE_RELAY_URL=wss://<service>.onrender.com/ws`, using the actual web service hostname. Redeploy
   the static site after setting it, because Vite embeds this value during the build.
4. Share the **static site URL**. The page opens immediately. The Multiplayer page wakes the relay via
   its WebSocket endpoint and shows the elapsed wait. Players can enter a name or join code while it wakes. Creating
   a new room and getting its share code require the relay to be online.

Vercel can host the static site instead, with the same build command, `dist` output, and
`VITE_RELAY_URL` setting. Keep Render as the WebSocket relay.

The simple single-service option is still available: deploy just the `render.yaml` blueprint and share
its `https://<service>.onrender.com` URL. That URL waits through a cold start before displaying the page.
