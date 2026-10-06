# A vitest shard can go red with zero test failures

`[vitest-worker]: Timeout calling "onTaskUpdate"`, no failing test, the run
dead. Three occurrences on 2026-10-05, all under 12 workers -- but **two
EVENTS, not three**, and the difference matters to every count below:

| # | run | shard | file |
|---|---|---|---|
| 1 | knobon-measure | 6/6 | `npm-static.test.ts` |
| 2 | knobon-measure | 6/6 | `coverage-corpus-02.test.ts` |
| 3 | gatefour | 3/6 | none -- unhandled, no test failed |

1 and 2 are the **same shard of the same run**: one event that struck two
files, not two independent observations. 3 is a different shard of a
different run with no test file at all.

This file records the MECHANISM, read out of the installed `vitest@3.2.7`
rather than recalled. It deliberately does not name a cause, and S3 says why
in the strongest terms available: **the mechanism fits both candidate causes
equally well and discriminates between neither.**

## 1. The worker did not hang. The main thread did.

The name misleads. Three facts, each at a line:

1. The message is minted in `dist/chunks/rpc.-pEldfrD.js:49`, inside
   `createRuntimeRpc` -- the **worker-side** RPC setup. The worker is the one
   raising the error, which means the worker is the one that **waited**.
2. `onTaskUpdate` is implemented on the **main/server** side,
   `dist/chunks/cli-api.DVe0nWUx.js:5214`.
3. The worker's `eventNames` list is exactly:

   ```js
   eventNames: ["onUserConsoleLog", "onCollected", "onCancel"]
   ```

   `onTaskUpdate` is **not in it**. In birpc, a name in `eventNames` is
   fire-and-forget; a name absent from it is an **awaited call with a
   timeout**. So every task update the worker reports is a round trip it
   blocks on.

Put together: a worker finished a task, called `onTaskUpdate` on the main
thread, waited for the acknowledgement, and the main thread did not answer in
time. The failing party is the **single main thread** -- which also runs the
reporter and the sequencer -- starved while N workers each spawn a compiler
and run linked binaries.

That is what explains the signature that was hardest to place: **a timeout
with zero test failures.** No test was slow. The reporting channel was.

## 2. The 300 s hang detector is on the wrong axis

`vitest.config.ts` sets `testTimeout: 300_000` and `hookTimeout: 300_000`,
and its comment reasons correctly about this very hazard:

> 300s is a hang detector, not a performance bound: under a merge gate
> sharing the box with lane compiles, a legitimately compile-heavy corpus
> entry can starve past 120s.

The reasoning is right and the mitigation lands on the wrong knob. **The RPC
timeout is neither of those two settings.** It is a birpc constant, and
nothing in `vitest.config.ts` reaches it -- raising the two timeouts to 300 s
bought exactly nothing for this failure mode.

A config that is already starvation-aware and still cannot see this instance
is a finding about the mitigation, not about any one run. **This part is
actionable independently of which cause is real**, which makes it the most
useful thing in the file.

The birpc default value is deliberately **not quoted here**: the package did
not resolve at the path tried, and an unread constant must not be written
down as if it were read. The number matters less than its nature -- it is a
**library constant, not a configuration**, and that is the whole point.

## 3. THE MECHANISM DOES NOT CHOOSE BETWEEN THE CAUSES

Read this before citing anything above.

Main-thread starvation is the mechanism. **What starves it is not
established.** There are at least two candidates:

- **worker count** -- 12 workers each spawning `zig cc` and running linked
  binaries, on a box with 6 physical cores;
- **concurrent whole-repository scanning** by another process on the same
  box.

Both runs that timed out had **both** conditions present. The mechanism fits
each of them equally well, so finding it **raises the plausibility of both
and selects neither**. Nothing above is evidence for one over the other.

Writing this down is the point of the section: "mechanism found" reads as
"cause established" to anyone skimming, and the distance between those two is
exactly the error this project pays for most often.

**The tiebreaker is still the free experiment**: shards 4-6 under 12 workers
on a verifiably quiet machine. One arm, no extra cost.

## 4. A harness property that holds regardless

`tests/harness` contains **93 synchronous child-process calls across 35
files** (`execFileSync` / `spawnSync` / `execSync`) against 103 asynchronous
ones.

A synchronous spawn blocks its worker's event loop completely. So a worker
alternates between **fully blocked** and **all of its pending RPC traffic at
once**, which concentrates demand on the main thread in bursts rather than
spreading it.

This is a property of the harness, not of any run, and it would make
main-thread starvation easier to reach under any cause. It is worth its own
line because it is fixable on its own terms and nobody has to settle the
cause first.

## 5. NOT DETERMINED

- Which of the two candidate causes it is (S3). The experiment decides it.
- birpc's default RPC timeout, in milliseconds.
- ~~Whether the three occurrences share a shard or a test file.~~
  **ANSWERED, and it cuts both ways.** They do not share: 1 and 2 are one
  event on shard 6/6 of `knobon-measure`, 3 is shard 3/6 of `gatefour` with
  no test file. So "shared shard" is **not** available as a discriminator --
  there is no sharing BETWEEN runs -- and the real numerator falls from
  three occurrences to **two events**, which worsens an already
  non-significant p (0.165 on the three-occurrence count). Worker count
  remains the only condition stated across both events.
- Whether any of the 93 synchronous spawns are on the hot path of the shards
  that timed out. The count is a harness-wide figure, not a per-shard one.
