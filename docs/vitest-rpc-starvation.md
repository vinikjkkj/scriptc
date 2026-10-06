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

**The tiebreaker was the free experiment**: shards 4-6 under 12 workers on a
verifiably quiet machine. It ran on 2026-10-05 and came back **3 of 3
green**.

### The clean arm is encouraging and UNDERPOWERED. Do not read it as settled.

Three shards, zero timeouts. Against the failing condition's own observed
rate that is **not** a discriminating result:

| assumed per-shard rate | P(0 red in 3 shards) |
|---|---|
| 1/6 -- shard 3 of 6, this run | **0.579** |
| 2/12 -- both red runs, 6 shards each | **0.579** |

So a clean arm this size is **more likely than not** even if quiet changes
nothing. Reaching P < 0.05 at a 1/6 rate needs **17 clean shards**, not 3.
The arm raises the plausibility of the co-load hypothesis; it does not
establish it, and "the experiment came back green" must not be cited as
though it did.

A second, smaller negative result from the same run points the other way
from the obvious reading: **shard 4 carried 29 descendants against the 21
and 23 of the two that failed.** The shards that timed out were not the
heaviest, so per-shard WORK does not order the failures either.

What the arm does do is hold worker count FIXED at 12 across both
conditions, which is the only variable it was built to control.

## 3b. The ledger

| hypothesis | status | why |
|---|---|---|
| per-shard work | **refuted by ordering** | shard 4 carried 29 descendants and passed; the two that failed carried 21 and 23 |
| our co-load | **raised, not established** | 2-in-2 with, 0-in-4 without; the clean arm is P = 0.579 under the null |
| worker count | **tested, not significant, CONFOUNDED** | 2/6 at 12 workers against 0/10 at 3, p = 0.165 -- and the 3-worker runs are the overnight ones, so worker count is confounded with time of day |

**One refuted, two live** -- and the third is live by *non-significance and
confounding*, not by absence of contrast. The difference decides what to do
next: "never tested" asks for a new experiment, while "tested, p = 0.165,
confounded" asks to **de-confound** -- a 3-worker arm at peak, or a 12-worker
arm overnight.

### What the clean arm does and does not say about workers

The clean arm held worker count **fixed at 12** across both of its
conditions. That was its design and its value: it varied the co-load alone.
So it refutes nothing about worker count, and a green arm must not be read
as exonerating it.

That statement is about the ARM. It does not generalise to the day's data,
where the contrast plainly exists -- and an earlier revision of this section
made exactly that leap, claiming worker count "has never been varied". It
has: 12 against 3, which is the contingency the p was computed from.

**The tell was already in this file.** S5 states the denominators as "2 of 6
against 0 of 10". A contingency with two levels IS a varied variable, and a
p cannot exist without one. The claim was contradicted three sections above
where it was written, by a sentence the same author had put there. A right
fact about one population (the arm) carried into a question about another
(the day) -- and the check that would have caught it was reading the rest of
the document.

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
  there is no sharing BETWEEN runs. Worker count remains the only condition
  stated across both events.

  **AND THE p DOES NOT MOVE. Do not recompute it.** The correction changes
  the prose and nothing else, because the statistic was never computed over
  occurrences: it counts **runs that timed out** -- 2 of 6 against 0 of 10,
  the two being `knobon-measure` and `gatefour`. Occurrences 1 and 2 were
  ALREADY one run in that count. Reading "three became two" as a change to
  the numerator and recomputing would produce a new p that disagrees with
  the old one with nobody having made a mistake, which is a worse outcome
  than either number alone.
- Whether any of the 93 synchronous spawns are on the hot path of the shards
  that timed out. The count is a harness-wide figure, not a per-shard one.
