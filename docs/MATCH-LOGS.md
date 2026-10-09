# Match logs (for imitation / RL training)

Every solo or hosted match records what the **humans** did plus enough world state to rebuild what they saw.
Code: `src/engine/telemetry/matchLogger.ts` (format), `store.ts` (browser storage), hooks in `Game.step` and
`HeadlessSim.step`. Bots and autopilot rows carry poses only (context), never commands.

## Where logs go
Every match the machine simulates is logged: solo, and online (the **host** runs the sim, so the host logs the whole
match, including remote drivers, who count as humans). Clients and spectators never log. `?log=0` turns it off.
1. The finished log (also a partial one if you quit after ~10 s) is saved in the browser's IndexedDB, then gzipped and
   POSTed to the relay at `/api/match-logs` (`VITE_RELAY_URL` when the site is hosted apart from the relay).
2. **Supabase** (production): the relay stores the file in the private `match-logs` Storage bucket and a metadata row
   (season, mode, frames, archetype labels, final score, size) in `match_logs`. It uses the same `SUPABASE_URL` +
   `SUPABASE_SERVICE_KEY` env vars as ranked play, on the Render web service only. **One-time setup:** run
   `supabase/match_logs.sql` in that project's SQL editor (creates the bucket and table; RLS on, no policies, so the
   anon key can't touch them).
3. **No Supabase env vars** (dev, tests): the relay writes plain JSONL to `data/demos/` (gitignored).
4. If the upload fails (offline, relay asleep, tab closed) the log stays queued and is retried the next time the game
   starts (up to 6 tries). The relay rejects non-logs, caps uploads at 8 MB gzipped and 30 per IP per hour.
- Results screen: **Download match log**. Console: `await matchLogs.list()` (shows `uploaded`), `matchLogs.flush()`,
  `matchLogs.downloadAll()`.
- Training data: download from the bucket (Supabase dashboard, or `storage/v1/object/match-logs/<path>` with the
  service key), `gunzip`, and point `tools/demos_to_dataset.py` at the `.jsonl` files.

## Archetype
Each robot's header entry has `archetype`: `label` (the season's preset / team-robot id when its config matches
exactly, `model:<id>` when only the visual model does, else `custom`) and `features` derived from the config (shooter
none/fixed/pivot/turret, auto-align, ground/station intake, intake side and rate, capacity, placement level, climb
level, blocker, speed, mass, season options). The features are the ground truth since the menu lets players tweak a
preset. `tools/demos_to_dataset.py` turns them into a 17-number conditioning vector in every observation, so one
policy can be told which robot it is driving, and saves the label per sample (`*_arch`) for per-archetype evaluation.

## Format (JSON Lines, ~30 Hz)
`header` (self-describing column names, robots + mechanism summary, season, seed) · `period` · `frame`
(`rows: [{r: [id,x,y,yaw,vx,vy,omega,held,climbPhase,climbLevel,tipped,turretYaw,src], c: [vx,vy,omega,intake,shoot,pass,climb,descend,level,block,aim]}]`,
`c` absent for bots; `src` 0 human / 1 autopilot / 2 bot) · `pieces` (2 Hz, loose pieces flat `[x,y,z,…]`)
· `launch` · `score` · `foul` · `end`. Field coordinates (WPILib, metres). `c` is the command actually executed
(after driver-assist layers), field frame.

## Train
```bash
python3 tools/demos_to_dataset.py data/demos/*.jsonl -o data/bc.npz   # human rows only; robot-frame observations
```
Step 1, behaviour cloning: `python3 tools/train_bc.py data/bc.npz -o data/policy.json` (numpy MLP; MSE on drive
axes and scoring level, BCE on the buttons; validates on whole held-out matches; exports weights as JSON). Step 2, RL: initialise the policy from the BC weights, then fine-tune in
`HeadlessSim`, keeping a KL/BC loss term so it doesn't forget human play. Condition on the robot (header `robots[]`)
if you mix archetypes. Collect a few dozen matches per season/robot before expecting good clones.
