# Solo leaderboards and ghosts

One leaderboard per real team robot in a season: every `teamRobots` entry (`boardRobots` in
`src/engine/ghost/board.ts`). Archetypes have no boards. Each driver keeps their best score on each board, with a ghost anyone can race.

## What counts

A run is a full **Solo practice** match (AI opponents off) on a team robot. Its score is the driver's alliance total minus penalties (`Scoreboard.soloScore`): the foul points the driver gave
away, never below zero. The live ghost gap uses the same number, and the results card shows what penalties took off.
Nothing else is on the field, so the score comes down to the driver and the robot.

These don't count: 3 v 3 matches, archetypes and custom builds (`boardRobotFor` compares the build, ignoring team number), matches
where the practice boost was switched on, `?speed=` runs, and matches abandoned before the buzzer. The Solo page says
whether the current setup is ranked.

## Ghosts

- **Recording.** `MatchSim` feeds `GhostRecorder` from the fixed step: the robot's world pose at 15 Hz on the match
  clock, each launched piece (time, position, velocity) and each score change. It runs on the page or in the worker;
  the worker sends the finished run as a `ghost` event just before `results`.
- **Format** (`src/engine/ghost/format.ts`). Fixed-point poses as per-column deltas, JSON, gzip, base64: tens of KB a
  match. Shared with the relay. Change the layout only with a new `GHOST_VERSION`.
- **Playback** (`GhostLayer`). A see-through copy of the robot model, posed by match time, with a name tag and shots on
  their launch arc. It lives only in the page's scene, built on a throwaway physics world, so it can't touch the match
  and the worker doesn't know about it. Mechanisms don't animate. A run driven on the other alliance plays on your side
  through `mapSymmetry`. The panel over the FUEL readout shows your score gap to each ghost right now.
- **Which ghosts race.** Up to three picked on the Leaderboard page; otherwise your own best on this robot, unless
  "Race my best automatically" is off. Restart and Play again keep the same picks.

## Storage

- **This device.** `src/app/soloScores.ts` keeps your best per robot in IndexedDB (`frc-sim-solo`), so personal bests
  and your own ghost work with no connection.
- **Online.** `/api/solo-scores` on the relay (`server/soloScores.ts`, used by the Worker and the Node server) stores
  the best run per driver in the Supabase table `solo_scores`. Drivers are the hash of the same device secret as ranked,
  so a best follows the browser. A run that couldn't be sent stays marked unsent and goes up the next time the
  Leaderboard opens. Without Supabase env vars the Node server keeps boards in memory (dev), and the Worker answers 503.
- Name changes apply to every board. Names go through `cleanName`, on the way in and on the way out.

## Going live

The frontend degrades gracefully, so order doesn't matter, but online boards need both of these:

1. Run `supabase/solo_scores.sql` in the project the relay uses (RLS on, no policies: only the service key can reach it).
2. `npm run cloudflare:deploy`. The endpoint is served by the stateless Worker entry, so it is live at once and rooms
   on the coordinator aren't touched.

## Cheating

The sim runs in the browser, so the relay can't prove a score. `ghostProblem` rejects what can't be real (wrong match
length, teleporting, off the field, a score the timeline doesn't reach) and writes are limited to 30 per IP per hour (per Worker isolate, so treat that as a loose limit).
A determined cheat can still forge a plausible run. Removing a score is a row delete in `solo_scores`.

Boards aren't tied to a robot's tuning: if a robot's stats change, its old scores stay. Clear that robot's rows if a
change makes them unfair.
