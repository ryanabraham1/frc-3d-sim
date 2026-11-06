# Performance diagnostics

Append `?perf&fps` to the game URL (or `&perf&fps` if it already has a query). The optional panel shows:

- `tickMs`, `drawMs`, `faderMs`, `renderMs`: smoothed CPU time per update/frame, in milliseconds. Render CPU time is not a GPU measurement.
- `rttMs`: command acknowledgement round-trip time for the guest driver.
- `jitterMs`, `interpDelayMs`: arrival jitter and the replica's interpolation buffer.
- `missedSnapshots`: sequence gaps detected by the guest.
- `hostSimLoad`: fraction of host time spent in simulation and snapshot generation (in the worker's loop when the match runs there).
- `workerTickMs`, `workerTickMaxMs`, `workerStepMs`, `workerFrameMs`, `workerCheckpointMs`: the simulation worker's loop (smoothed, and longest of the last 0.5 s), one physics step, one frame, and the last checkpoint's capture.
- `pixelRatio`: current resolution after automatic quality adjustment.

These values are also available through `window.game.netStats()`. Capture both host and guest panels while the slowdown is happening; steady-link results alone do not identify intermittent stalls.

For a local network check, `?perf&fps&netlag=200` on the guest simulates 200 ms round-trip delay. It preserves message order and does not simulate packet loss or bandwidth limits.

## Host simulation worker

The host's match runs in a worker, so rendering no longer competes with physics and snapshot encoding (see docs/MULTIPLAYER.md §2.0). Two Chrome processes on one Mac, through the local relay, host at 4x CPU throttle, 20 s of driving with bots:

| Host | Snapshot gap p95 / p99 (ms) | Page `tick` p99 (ms) | Guest `jitterMs` | Guest `rttMs` |
|---|---|---|---|---|
| Page sim (`?worker=0`) | 40 / 68 | 19 | 16 | 40 |
| Worker | 37 / 40 | 0.7 | 5 | 30 |
| Worker, also slowed 4x | 48 / 54 | 0.8 | 9 | 29 |

`Emulation.setCPUThrottlingRate` only reaches the page's main thread, so the middle row flatters the worker. The last row adds a temporary busy-wait of three times each loop pass (not in the code) to stand in for a slow core: worker load is about 0.55, and its longest gap was 129 ms against 94 ms for the page sim, so a worst-case stall can still be as long.

These runs share one machine and say nothing about real links: there is no real latency, jitter or loss between the browsers. Check two computers before drawing conclusions about how a match feels.

## Stall recovery

On steady links, remote robots use a 50 ms minimum interpolation buffer (previously 75 ms). The buffer still grows with measured jitter, up to 350 ms. The local driver's prediction remains immediate.

The worker ticker allows one outstanding callback, and host catch-up steps produce at most one snapshot per tick. Prediction reconciles only the newest robot pose in a received burst; all snapshots still pass through replica state processing. This avoids correcting the local robot repeatedly against obsolete poses before physics advances.

Host and relay snapshot queues stop accepting additional snapshots above 16 KiB. Host skips retain pending piece changes. A guest detecting a missing delta requests a full snapshot, retries once per second until it arrives, and holds piece/rules deltas until that full state repairs its baseline. Self-contained robot poses, scores, and clock updates continue during recovery.

Validation: `npx vitest run tests/ticker.test.ts tests/netsync.test.ts tests/prediction.test.ts tests/relay.test.ts tests/net.test.ts tests/multiplayer-bots.test.ts` covers worker backlog, dropped initial/recovery keyframes, prediction bursts, interpolation, codecs, transport, and bot station setup.
