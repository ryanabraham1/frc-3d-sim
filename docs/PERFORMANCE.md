# Performance diagnostics

Append `?perf&fps` to the game URL (or `&perf&fps` if it already has a query). The optional panel shows:

- `tickMs`, `drawMs`, `faderMs`, `renderMs`: smoothed CPU time per update/frame, in milliseconds. Render CPU time is not a GPU measurement.
- `rttMs`: command acknowledgement round-trip time for the guest driver.
- `jitterMs`, `interpDelayMs`: arrival jitter and the replica's interpolation buffer.
- `missedSnapshots`: sequence gaps detected by the guest.
- `hostSimLoad`: fraction of host time spent in simulation and snapshot generation.
- `pixelRatio`: current resolution after automatic quality adjustment.

These values are also available through `window.game.netStats()`. Capture both host and guest panels while the slowdown is happening; steady-link results alone do not identify intermittent stalls.

For a local network check, `?perf&fps&netlag=200` on the guest simulates 200 ms round-trip delay. It preserves message order and does not simulate packet loss or bandwidth limits.

## Stall recovery

On steady links, remote robots use a 50 ms minimum interpolation buffer (previously 75 ms). The buffer still grows with measured jitter, up to 350 ms. The local driver's prediction remains immediate.

The worker ticker allows one outstanding callback, and host catch-up steps produce at most one snapshot per tick. Prediction reconciles only the newest robot pose in a received burst; all snapshots still pass through replica state processing. This avoids correcting the local robot repeatedly against obsolete poses before physics advances.

Host and relay snapshot queues stop accepting additional snapshots above 16 KiB. Host skips retain pending piece changes. A guest detecting a missing delta requests a full snapshot, retries once per second until it arrives, and holds piece/rules deltas until that full state repairs its baseline. Self-contained robot poses, scores, and clock updates continue during recovery.

Validation: `npx vitest run tests/ticker.test.ts tests/netsync.test.ts tests/prediction.test.ts tests/relay.test.ts tests/net.test.ts tests/multiplayer-bots.test.ts` covers worker backlog, dropped initial/recovery keyframes, prediction bursts, interpolation, codecs, transport, and bot station setup.
