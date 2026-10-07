# Ranked play

Ranked matches 1v1, 2v2 and 3v3 on the current game (`RANKED_SEASON_ID` in `src/engine/net/ranked.ts`, 2026 REBUILT).
Each mode has its own Elo. Everything is layered on the multiplayer relay ([MULTIPLAYER.md](MULTIPLAYER.md)).

## Flow

1. **Queue.** The Ranked page sends `queue {mode, name, secret}`. `server/matchmaker.ts` forms a group of 2 × team size from
   neighbours in rating order once their spread fits the tightest search window (100, +15 per second waited, max 1200).
2. **Match.** `server/ranked.ts` balances teams (`balanceTeams`), flips colours randomly, picks a random host, seats everyone in
   a private room (no reconnect token juggling: peers keep their ids) and sends `matched`. The host's `LobbyController` builds the
   ranked lobby (`hostRankedRoom`).
3. **Draft** (`draftSteps` in `ranked.ts`). The pool is the season's archetypes plus real team robots (`src/app/rankedPool.ts`).
   Two bans per alliance, alternating red/blue, then picks in snake order (3v3: R1 B1 B2 R2 R3 B3). A robot may be picked once
   per alliance (both alliances can have it); banned robots are gone for everyone. 15 s per ban, 20 s per pick; a timed-out turn
   auto-plays (random ban, random pick).
4. **Placement.** The normal start-position screen; 75 s, then everyone is locked in where they stand. Drive-in-AUTO, no bots.
5. **Result.** Host and every client report the winner at the results screen. The relay applies Elo only if the host and at least
   half of the other drivers agree; otherwise the match is **voided** (no change).
6. **Rating.** `rateMatch`: team strength = mean rating, `K` = 40 for the first 10 games, 28 up to 30, then 20. Tiers (Bronze …
   Master) show after 5 placement games.

## Leaving

Leaving before any result exists is a loss for the leaver (at least K/2 points). Their teammates who stay keep their rating; the
opponents are scored as winners. A dropped connection has the relay's 30 s reconnect window and is not a forfeit.

## Storage and identity

- **Identity:** an anonymous device key in `localStorage` (`frc-sim-ranked-secret`). The relay stores only `sha256(secret)`, so a
  rating follows a browser. Clearing site data starts a new player; extra browsers can farm accounts. One device can't queue twice.
- **Store:** `server/rankedStore.ts`. `MemoryStore` (default, resets on restart) or `SupabaseStore` when `SUPABASE_URL` and
  `SUPABASE_SERVICE_KEY` are set **on the Render web service** (never the static site, never `VITE_`-prefixed). Run
  `supabase/ranked.sql` once; RLS is enabled with no policies so only the service key can touch the tables.

## Trust model and limits

The simulation runs in the host's browser, so a modified client could cheat; result agreement and abandon penalties limit the
damage but don't remove it. The host also has zero input lag. A server-side simulation is the real fix (see MULTIPLAYER §7a).
There is no placement-only hiding of ratings beyond tiers, no seasons/resets, no rematch, and no party queue yet.

## Tests

`tests/ranked.test.ts` (Elo, tiers, teams, matchmaker, draft, store), `tests/ranked-relay.test.ts` (queue, results, voids,
abandons through real sockets), `tests/ranked-lobby.test.ts` (two real lobbies through draft → placement → start → rating).
