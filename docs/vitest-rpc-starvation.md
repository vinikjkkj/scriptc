# A vitest shard can go red with zero test failures

`[vitest-worker]: Timeout calling "onTaskUpdate"`, no failing test, the run
dead.

**THE OCCURRENCE TABLE BELOW WAS WRONG AND IS CORRECTED.** An earlier
revision recorded three occurrences, two of them on `knobon-measure` shard
**6/6** (`npm-static.test.ts`, `coverage-corpus-02.test.ts`). Those two are a
**different signature**: `Error: SyncRpcChannel: timed out connecting to
named pipe`, and they are ordinary failing tests (`Test Files 2 failed | 34
passed`), not an unhandled error. The `onTaskUpdate` timeout in that run was
on **shard 3**. A census over every preserved gate log settles it -- see S6,
which is the source for every count in this file from here on.

| # | run | tree | shard | what failed |
|---|---|---|---|---|
| 1 | `knobon-measure/logs/20261006-154415` | `ea491bac283dfe86` | **3/6** | unhandled error, 1 test also failed |
| 2 | `gatefour/logs/20261006-173655` | `188d879f51b0962f` | **3/6** | unhandled error, no test failed |
| 3 | `gatefour/logs/20261006-183921` | `2474424c07609be3` | **3/6** | unhandled error, no test failed |
| 4 | `gatefour/logs/20261006-192443` | `9f637ca4e2b519db` | **3/6** | unhandled error, no test failed |

**Four occurrences, four runs, four distinct trees, and every one is shard
3.** They are independent observations, not one event seen four times.

This file records the MECHANISM, read out of the installed `vitest@3.2.7`
rather than recalled. S1 and S2 are unchanged and still hold. S3 named two
candidate causes and said the mechanism selects neither; **one of those two
is now refuted and a third has joined and been refuted as well** -- read S6
before citing S3 or S3b.

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

**SUPERSEDED IN PART BY S6.** This section says two runs timed out; it
was four. It names two candidate causes and says both conditions were
present in every timeout; the co-load one is refuted outright (S6.3) and
the quiet-machine "tiebreaker" below is now known to have run on a day
that was quiet in gate terms throughout. The reasoning about mechanism
versus cause is unchanged and is why the section stays.

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
verifiably quiet machine. It ran on 2026-10-06 and came back **3 of 3
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

SUPERSEDED IN PART BY S6. Kept because the reasoning about *how* a hypothesis
dies is still the standard, but every denominator here was re-derived from
the census and three rows changed.

Every row now names its REFERENCE ARM and that arm's DENOMINATOR, because
two conclusions were found resting on arms of 0/2 whose 95% upper bound is
77.6% -- a bound that excludes nothing. A third state is therefore required:
a row whose reference was never established is **UNMEASURED**, which is not
the same as refuted and not the same as confirmed.

| hypothesis | status | reference arm | denominator |
|---|---|---|---|
| per-shard work | **REFUTED by ordering** | descendant counts, direct census | 8 twelve-worker shard-runs: green 24/25/26/27 against red 23/24/25/27, fully interleaved. No green arm involved |
| our co-load (another GATE on the box) | **REFUTED by measurement** | foreign-rig wall overlap, with instrument controls | 109 shard intervals; A/A pair and all 8 full runs at 0.0%; function proven able to report non-zero (2 of 109 real, synthetic 500s/0s) |
| the in-run scratch sweeper | **REFUTED by ordering** | census anti-ordering, direct counts | 110 shard-runs: a red shard that removed 0 directories, a green shard in the same run that removed 9,964. **The two supporting ARMS are struck** -- nosweep37/maxsweep37 were 0/2 draws from a process now measured at ~50%, and contribute nothing. The census carries this row alone |
| position as SEQUENCE in the gate | **REFUTED** | R0a, a positive reproduction | shard 3 alone, no preceding shards: RED 2/2 under the gate invocation and RED under the plain one (A0). Does not depend on any green arm |
| position as vitest SHARD INDEX | **REFUTED** | R3, a positive reproduction | shard 3's 37 files passed as explicit paths, no `--shard` flag, no index: RED 2/2. Does not depend on any green arm |
| worker count | **contrast significant, one leg UNMEASURED, CONFOUNDED** | the 3-worker arm | 4/8 at 12 workers against **0/10** at 3, p = 0.023. But 0/10 bounds the 3-worker rate only at **25.9%**, so "3 workers is safe" is not established; and the 3-worker runs are the overnight ones |
| tree content as SUFFICIENT | **DOWNGRADED to UNMEASURED** | the A/A pair, armrig GREEN shard 3 | **n = 1 against n = 1.** Under a process now measured as intermittent (50% plain, ~100% gate), one green beside one red is p = 0.5 and carries no information. See the note below |
| tree content as NECESSARY | **UNMEASURED -- never varied** | the 34-file core | 34 files common to shard 3 of all reproductions, worst pairwise J = 0.8718 |
| shard 5 does not reproduce (R0b) | **UNMEASURED** | R0b green arm | **0/2**, 95% upper bound 77.6%. The content result rests on this and it is the same defect that voided the plain arm |
| plain invocation does not reproduce | **REFUTED -- it does** | the plain arm, re-measured | was 0/2; A0 re-ran the identical invocation and it came back RED. Now **2/4** |

### The A/A pair is the boundary of the temporal break, not independent evidence

This correction matters more than the row. The A/A pair was called "the
discriminator any future hypothesis has to pass", and its force came from an
unstated assumption: that the phenomenon is DETERMINISTIC, so that one green
and one red on the same tree must mean something outside the tree changed.
The phenomenon is not deterministic. It is intermittent: 2 of 4 under the
plain invocation, and 4 green of 10 among twelve-worker shard-3 gate runs.
(An earlier draft of this paragraph said "14 of 20", which conflated the
twelve-worker population with ten three-worker runs that are all green and
all pre-break -- a different population, and exactly the denominator error
this section exists to catch.) A single green 50 minutes before a single red
is what an intermittent process produces by chance, at p = 0.5.

What survives is the TEMPORAL BREAK of which the pair is merely the
boundary. Taken over the natural unit -- the ten twelve-worker shard-3 runs,
in time order: green green green green, then RED RED RED RED RED RED -- the
probability that all six reds fall in the last six positions is
1/C(10,6) = **0.0048**. That is the real evidence, it rests on 10 runs
rather than 2, and the A/A pair adds nothing to it because it IS two of
those ten, adjacent across the break. Citing both as separate support
double-counts one observation.

### Why a Fisher p from a tiny arm misleads, stated once

A 0/2 arm against an 11/11 arm yields p = 1/C(13,2) = **0.013**, which looks
decisive. But if that arm's true rate is 50%, the chance of observing 0/2 is
**25%** -- one experiment in four produces that "significant" table by luck.
Fisher conditions on the margins, so the p is driven by the size of the
OTHER arm, not by the precision of the small one. Tonight this is not a
hypothetical: the plain arm sat at 0/2 with exactly that p, and two more
runs took it to 2/4.

**Design rule adopted from it: an arm must be large enough that ONE flipped
observation does not change the conclusion.** At n=2 a single red takes an
arm from 0/2 to 1/3 and the conclusion collapses; at n=5 it goes to 1/6 and
survives. Robustness under one flip, not significance, is the bar.

The old row read "2/6 at 12 workers against 0/10 at 3, p = 0.165". That p was
computed over a run list that no longer matches the corrected occurrence
table, and the denominator moved as well: five `armrig` 12:55 "runs" are
dry-run-only gates that never started a shard and must not sit in a
per-shard contingency. **A p whose numerator and denominator both moved has
to be re-derived, not carried.** The new one is above.

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

- **What starves the main thread.** S3's two candidates are both gone: our
  co-load is refuted (S6.3) and worker count, though now significant, cannot
  by itself explain four green runs and four red ones at the SAME 12 workers
  (S6.2). Nothing currently on the list explains the A/A pair.
- birpc's default RPC timeout, in milliseconds.
- ~~Whether the three occurrences share a shard or a test file. ANSWERED,
  and it cuts both ways. They do not share...~~
  **THAT ANSWER WAS BACKWARDS AND IS WITHDRAWN.** It rested on placing two
  occurrences on shard 6/6, which the preserved logs do not support -- those
  two are `SyncRpcChannel: timed out connecting to named pipe`, a different
  signature (see the header). Over **109 distinct shard-runs in seven rigs
  the `onTaskUpdate` signature appears 4 times and all 4 are shard 3**: 4 of
  18 shard-3 runs red against 0 of 91 non-shard-3 runs red. **Shared shard IS
  available as a discriminator, and it is the strongest ordering anyone has
  found.** What it is NOT is a property of shard 3 across the day --
  `d2-valguard-gate` ran 12 shard-3s green, all of them before the break in
  S6.2.

  The withdrawn note also said "the p does not move, do not recompute it."
  That instruction was right for the correction it was written about and
  wrong for this one: there the numerator was already collapsed, here the
  occurrence list, the run list and the per-shard denominator all changed
  together. S3b carries the re-derivation.
- Whether any of the 93 synchronous spawns are on the hot path of shard 3.
  The count is a harness-wide figure, not a per-shard one.
- **Non-gate co-load.** S6.3 closes concurrent GATE load only. Work that
  writes no log under `G:\blocks` -- a block compiling, benching, the dev
  server, the user's own session -- leaves no retroactive record at all, so
  this variant cannot be settled from logs in either direction.

## 6. THE CENSUS, AND WHAT IT KILLS

Source for every count above: a sweep of every preserved gate log under
`G:\blocks` -- seven rigs, **109 distinct shard-runs** (the raw sweep lists
110; `slice-tmp` holds a byte copy of one `knobon-measure` shard-run and is
deduped), of which 18 are full six-shard runs. Two derived tables are kept
beside the logs:
`G:\blocks\sweep-vs-timeout-census.csv` (per shard-run: timeout, sweeps, GB
freed, directories removed) and `G:\blocks\runs-workers-census.csv` (per
run: worker count, verdict, which shard timed out).

### 6.1 An A/A pair with opposite verdicts

`armrig/logs/20261006-145308` (14:53) and
`knobon-measure/logs/20261006-154415` (15:44) ran head `721496bc2e8`,
treehash `ea491bac283dfe86` -- **the same tree, therefore the same six-way
partition** -- at the same 12 workers. The shard-3 file lists were compared
and match. armrig: GREEN 6/6. knobon-measure: RED, shard-3 `onTaskUpdate`.
Fifty minutes apart, and the two windows do not even touch (armrig ends
15:39, knobon starts 15:44).

**Nothing resident in the tree can explain this**, which retires
composition, per-shard content, sync-spawn density, corpus concentration and
per-shard work in one stroke -- and the sweeper with them (6.4). This pair
is the discriminator any future hypothesis has to pass; aggregate statistics
over the eight runs are context.

### 6.2 The break is temporal, and it is not disk

Eight full 12-worker six-shard runs on 2026-10-06:

| time | rig | verdict | free at end |
|---|---|---|---|
| 12:13 | d2-valguard-gate | GREEN 6/6 | 45.94 GB |
| 13:10 | d2-valguard-gate | GREEN 6/6 | 41.09 GB |
| 13:57 | boxparam | GREEN 6/6 | 23.40 GB |
| 14:53 | armrig | GREEN 6/6 | 33.34 GB |
| 15:44 | knobon-measure | **RED shard-3** | 23.70 GB |
| 17:36 | gatefour | **RED shard-3** | 19.15 GB |
| 18:39 | gatefour | **RED shard-3** | 15.28 GB |
| 19:24 | gatefour | **RED shard-3** | 12.04 GB |

Four green, then four red, with a clean break around 15:00.

**Free disk is NOT the variable, and an earlier reading of this table that
called it monotonic was wrong.** The series is not monotonic (33.34 follows
23.40), and the boundary pair inverts: **23.40 GB is GREEN and 23.70 GB is
RED**. A green run with less free disk than a red one refutes disk as a
threshold. Do not pursue it.

### 6.3 Concurrent gate load: refuted, pre-registered

Predictions fixed in writing before any number was computed:

- **P1** the A/A pair must separate, RED above GREEN by more than 1.5x on
  foreign-overlap fraction, else refuted;
- **P2** no GREEN run's fraction may exceed the minimum RED run's, else
  refuted.

Shard intervals run from `RUN-START tag=shard-N` to `SHARD-RESULT n=N/6` --
**both** markers, because `DISK-TROUGH` exists only in the newer gate and a
first attempt using it silently dropped every older run and returned a
uniform zero. Three controls: per-rig interval counts (109 of 110 parsed,
every rig non-zero); a synthetic overlapping pair that must score 500 s and
a disjoint pair that must score 0; and a sweep for any real overlap
anywhere, which found 2 shard-runs with foreign overlap, the largest 88 s at
36.1%. **The overlap function can report non-zero on this data, so the zeros
below are real and not a wrong pattern.**

Result: **P1 and P2 both refuted.** Both members of the A/A pair and all
eight full 12-worker runs score **0.0% foreign-rig overlap, peak 0 foreign
rigs.** No new cut was tried afterwards.

The raw concurrency column, interpretable whatever the hypothesis does: the
box ran **one rig per clock hour for almost the whole day**, two rigs in only
four hours (03:00, 13:00, 14:00, 15:00). Concurrency does not rise at the
break -- it **falls**. Three of the four red runs had no other rig active at
any point. The sign is backwards, not merely absent.

This closes concurrent GATE load. It says nothing about co-load that writes
no log (S5, last bullet), including S3's original "concurrent
whole-repository scanning", which was never a gate.

### 6.4 The in-run scratch sweeper: refuted by ordering

`tests/harness/scratch-hooks.ts` sweeps the scratch tree inside a worker's
`afterEach`, and `sweepRemove`'s own note names this very signature as what
its async rewrite fixed -- so "a multi-GB rmdir burst starves the worker"
was a live and well-motivated reading. The census anti-orders it:

- a red shard that removed **zero** directories (`gatefour/20261006-192443`);
- in the same run as a red, a GREEN shard that removed **9,964 directories /
  19.26 GB** against the red shard's 1,472 / 4.05 GB -- 6.8x more sweeping on
  the green side;
- the largest single burst anywhere, **2,706 directories**, is green; the
  largest on any red shard is 1,014;
- 23 green shard-runs removed more directories than the worst red.

Two direct arms over the same 37 files at 12 workers on tree `b3a265368`
agree: sweep OFF (`SCRIPTC_NO_SCRATCH_SWEEP=1`, 0 removals) and sweep forced
after every test (`SCRIPTC_TEST_SCRATCH_MAX_MB=512`,
`SCRIPTC_TEST_SCRATCH_CHECK_MB=0`, 4,018 removals / 11.90 GB) produce
`gapMaxMs` of 2,263 and 2,245 -- the same to within 0.8% -- and neither
reproduces the timeout. Both arms are weak on their own because neither
reproduced the signature at all; the refutation is the census.

### 6.6 The partition was never varied, and that breaks a ledger row

S3b and the dead-hypothesis list both carry a row saying composition was
varied across reproductions and the failure survived it. Measured, that is
false, and the word doing the work was an unquantified "changed".

Jaccard over the gate's own `shard-N.json` -- the same source
`PARTITION-RESULT` reads -- across shard 3 of all six `onTaskUpdate`
reproductions, with paths normalised repo-agnostically:

- **34 files appear in shard 3 of every single reproduction.**
- Union across all six: 41. Worst pairwise J: **0.8718** (2 removed, 3 added).
- Between the two most recent runs, on different repos and different
  branches, J = **0.9474** -- one file swapped. Their shard 1 and shard 2
  are J = **1.0000**, identical membership.

So composition moved by at most 5 files out of 41 while a 34-file core
stayed constant. **Composition has never been meaningfully varied.**

The consequence has to be stated in two halves, because they point
differently:

- Tree content is NOT SUFFICIENT. The A/A pair (6.1) settles that: identical
  tree, identical partition, opposite verdicts. That row stands.
- Tree content as a NECESSARY condition is UNTESTED. Six reproductions, one
  file set. Nothing on record varies it, so nothing on record can refute it.

Position and content remain perfectly confounded, and no run so far
separates them. The cheap separation is to make one shard the sole
invocation -- which holds sequence position fixed at "first and only" and
varies only which files run.

**The partition function, read from source, says the same thing by
construction.** `vitest@3.2.7` shards in `coverage.DfSpMS-b.js:3456`: it
hashes each spec's REPO-RELATIVE path with SHA-1, sorts by that hash, and
slices `[ceil(n/count)*(i-1), ceil(n/count)*i)`. Three consequences:

- Ordering is by hash of the relative path, so the same relative path lands
  at the same rank in any repo -- which is why two different worktrees
  produce identical shard 1 and shard 2.
- `ceil(220/6)` and `ceil(221/6)` are both 37, so the slice WINDOW for
  shard 3 is indices [74, 111) in both runs. Only the contents shift.
- Adding one file to the corpus shifts everything past its insertion point
  by exactly one. The magnitude of membership change is bounded by the
  number of files added, NOT by the ordering scheme.

That last point is the one that matters: the corpus differed by one file
(`expected=221` against `expected=220`), so no partition function -- hash,
name, or insertion order -- could have moved shard 3 by more than about one
file. The question "did the partition move enough to separate content from
position?" was answerable before any list was compared, and the answer was
no either way.

Source predicts, lists confirm: the displaced file
(`array-absent-slot-accounting.test.ts`) is exactly where the cascade says
it must be -- shard 4 of the slice run, and in no other shard.

### The slice gate's two size-class reds: attributed to the slice, not the cache

Recorded because it was briefly moved to "unattributed" here and that is no
longer the right status.

Those two reds are `.text GREW by 512 bytes: 544214 against the recorded
543702 (tolerance 256)` -- the same delta on the same baseline in both
shards. They were first attributed to the slice without checking whether a
stale vendor object could produce them, which was an unverified attribution
and was retracted. Three independent routes then closed it, and all three
are measurements rather than arguments:

1. **Paired under a constant cache.** The quarantined vendor directory holds
   32 files and none written after 14:21; the before/after measurements are
   23:29 and 23:30 and the quarantine is 23:41. `find -newermt 23:00`
   returns nothing, with a positive control at `12:00` returning all 32. The
   -512 on both programs is therefore a direct paired comparison.
2. **The only candidate confounder cannot move that figure.** The
   hello-world was measured under BOTH cache states with the fix applied --
   stale objects from 12:04, and a rebuilt-from-absent cache -- and gave
   **543,702 both times**. It links neither library, so no vendor cache
   state can move it. Measured, not argued.
3. **Intervention in both directions.** Reverting one site leaves the test
   permanently red naming line 5780; fixing all seven brings both programs
   to exact equality, 543,702 and 630,182. And the two numbers were
   separated: the 512 came from source, the 144 was the cache, isolated and
   quarantined.

The premise of the retraction is itself refuted: nothing in that directory
has an mtime between 21:00 and 23:00, so the 21:50 gate **consumed** those
objects and wrote none. Both of its reds were the regex-free program --
shard 1 through the island anchor directly, shard 5 failing the `STATIC`
assertion, which precedes `REGEX` and so fails first. Both are the
cache-invariant figure.

**The retraction was still the right instinct.** Nobody had checked, and
"probably cannot" is not a measurement. The check cost four minutes and
produced a better control than existed before it -- route 2 above was not
in anyone's argument until the retraction forced someone to look. A
practice that occasionally retracts a correct attribution is cheaper than
one that never checks.

A normalisation note worth keeping, because it nearly produced a finding:
the first pass read J = 0.0000 against the `knobon` run, because that run
lived in `slice-wt` and the normaliser only knew `gate-wt` and `llvm-wt`.
A complete disjunction sitting beside 0.95 is not credible, which is the
only reason it was caught. A wrong pattern and a real zero are the same
number.

### 6.5 A defect found on the way, unrelated to the timeout

`prune-scratch.mjs`'s `measure()` starts `newest = 0` and raises it only from
**file** mtimes, never stat-ing the directory. An **empty** program directory
therefore reports `newest: 0`, which both sorts it first in the eviction
order and defeats the liveness floor (`d.newest > floor` is `0 > floor`).
With no lease it goes straight to `sweepRemove`, so a directory a live
compile is about to write into can be deleted under it -- observed once as
`zig cc: error: unable to open output directory ... FileNotFound`.

`prune-scratch.test.ts` states exactly the violated property ("an UNLEASED
directory of this run is spared: silence is not permission") and passes,
because every directory in that file is built by `keyDir`, which
unconditionally writes a `program.exe`. **The one input shape that breaks
the stated property is not constructible through the helper.** 20 test files
create scratch program directories without calling `holdScratch`.

## 7. What remains, with the power computed before the machine is asked

### 7.1 Position is already answered; "content vs position" is no longer the question

Two rows of the ledger settle it, and both are POSITIVE reproductions, so
neither depends on a green arm that might be a draw:

- **Sequence position** is out: shard 3 alone, with no preceding shards,
  reproduces (R0a, RED 2/2 under the gate; A0 RED under the plain one).
- **Shard index** is out: shard 3's 37 files passed as explicit paths, with
  no `--shard` flag at all, reproduce (R3, RED 2/2).

So what is left is the file set itself, and the open question is narrower
and better than the one we were asking: **which file or files inside the 37**.

### 7.2 Bisection, and why it is immune to the defect that bit us twice

The asymmetry is that an arm which does NOT reproduce needs many runs to
mean anything, while one that DOES needs few. Bisection is the design that
only ever leans on the powered direction:

1. The current set must first reproduce **2/2**. That is the invariant.
2. Split it in half. Run half A twice. If A reproduces, descend into A --
   and the 0/2 on half B is never load-bearing, so its weak bound costs
   nothing.
3. Only if A fails twice is B run. If B reproduces, descend into B.
4. If NEITHER half reproduces, re-verify the parent at 2/2. If the parent
   still reproduces, the cause needs files from both halves: declare an
   interaction and stop bisecting. Registered in advance so it cannot be
   explained away as a bad run.

Cost: 37 -> 19 -> 10 -> 5 -> 3 -> 2 -> 1 is about six levels, 2-4 runs each,
and runs shrink as the set does. Roughly **18 runs, ~30 minutes**. Use the
GATE invocation, where the rate is ~100% (11/11); the plain one is ~50% and
would double the runs for nothing.

### 7.3 A0 for R0b, the other unestablished arm

Shard 5 at 0/2 is the same defect that voided the plain arm. Three more runs
takes it to 0/5, whose upper bound is 45.1% -- below the 54.9% LOWER bound
on shard 3's rate, so the two no longer overlap. ~6 minutes. By the design
rule above, 0/5 also survives one flipped observation (1/6) where 0/2 does
not (1/3).

### 7.4 The rate claim: cheap to significance, expensive to a number

Plain 2/4 against gate 11/11 is p = 0.057 today. If the gate holds and the
plain rate stays near half:

| plain runs | reds | p |
|---|---|---|
| 5 | 2 | 0.018 |
| 6 | 3 | 0.029 |
| 8 | 4 | 0.018 |
| 10 | 5 | 0.012 |

So **four more plain runs (~20 min)** lands it comfortably under 0.05 with
room for an unlucky draw. But pinning the RATE -- distinguishing a true 50%
from a true 80% -- needs **39 runs per arm, 78 runs, 3.9 to 6.5 hours**.

**DECISION: the rate is DECLARED OPEN.** Not unknown by neglect, and not
pending: a decision, with its price attached so nobody reopens it without
seeing the bill. The target of this investigation is the CAUSE, and the
rate is not on the path to it -- knowing whether the plain invocation fails
at 50% or 80% does not name a file, a line, or a mechanism. Four runs buy
significance on the CONTRAST (plain differs from gate), which is all any
downstream argument needs; 78 runs buy a number that no downstream argument
uses.

Reopen it only if the rate itself becomes the target -- for instance if a
fix is proposed whose claim is "this lowers the rate", which cannot be
evaluated against a rate nobody measured. In that case the 78 runs are the
entry price and must be budgeted before the fix is attempted, not after it
looks good.

### 7.5 Repointing the instrument requires an anchor run

The gate variants under `G:\blocks` dot-source the disk copy of the sampler,
not `scripts/`. Repointing them is correct but must happen BETWEEN
experiments, never inside one, and must be paired with an anchor: re-run a
cell whose answer is already known -- R0a, RED 2/2 -- with the repointed
instrument and confirm both the verdict and a comparable MACHINE column.
Two runs, ~5 minutes. Swapping instruments without an anchor is changing the
ruler mid-series, and nothing measured after it is comparable to anything
measured before.

## 8. How the instruments failed, and why they nearly all failed the same way

Nine times in one day an instrument on this front returned something that
looked like a result and was not. They are collected here because the
pattern across them is sharper than any one of them.

| # | instrument | what it reported | why it was wrong | how it was caught |
|---|---|---|---|---|
| 1 | shard-interval extractor | uniform **0.0%** foreign-rig overlap | keyed on `DISK-TROUGH`, which exists only in the newer gate, so every older run's intervals were dropped | per-rig coverage control: one rig parsed 0, and only 49 of 110 shard-runs appeared |
| 2 | path normaliser for Jaccard | **J = 0.0000** against one run | that run lived in `slice-wt`, a repo root the normaliser did not know | a complete disjunction sitting beside 0.95 is not credible |
| 3 | file-set comparison | **"IDENTICAL"** | both extractions had failed; two empty sets compare equal | printing the set sizes (0 and 0) |
| 4 | `CurrentDiskQueueLength` | **0** under 768 MB of writes | an instantaneous gauge sampled at 10 s is a lottery; it read non-zero on 2 of 12 samples even at 1.3 GB/s | positive control that forced real I/O |
| 5 | `scriptc: early cache hit` count | **5** cold and **5** warm | it counts five specific compilations, not cache temperature | positive control across a known-cold and two known-warm runs |
| 6 | `rg ... ; echo "(ascii clean)"` | **clean** | the echo was unconditional; `rg` had in fact flagged a backspace byte on line 71 | reading `rg`'s own output instead of the echo |
| 7 | `grep -P ... && echo DIRTY \|\| echo CLEAN` | **clean** | `grep -P` failed on the locale; `\|\|` fired on the ERROR, not on a non-match | rebuilt with a positive control that plants a byte and must flag it |
| 8 | `rg -q` on a path that did not exist | **clean** | same shape as 7: failure read as absence | checking the file existed before reporting on it |
| 9 | content grep over prose | phrase **absent** | present, but split across a line break | re-matched with newlines collapsed |

### They fail toward the null, and that inverts where scrutiny belongs

Eight of the nine reported **"clean", "zero", "identical", "no difference"**.
Only #9 failed the other way, toward a false alarm. That is not luck: the
failure modes available to a search or a check are *didn't-find* shaped --
wrong pattern, wrong field, missing file, dead counter, unrun command. There
is no symmetric mechanism that invents a match.

The consequence runs against the usual instinct. A positive result is
self-validating: the pattern matched, so the pattern works. **A null result
is the one that needs proving, because the commonest explanation for it is
that the instrument never looked.** On this front the null was also usually
the convenient answer -- no overlap, no difference, no dirty bytes -- which
is exactly when nobody rechecks.

### The four rules that would have caught all nine

1. **Positive-control every zero on real data.** Before believing "not
   found", point the same pattern at something known to contain it. This
   caught #1, #2, #4 and #5.
2. **Prove a column can MOVE, both directions.** A counter that always reads
   the same is indistinguishable from a stable machine. #4 and #5 were dead
   and readable, which is the worst combination.
3. **Assert the input is non-empty before comparing.** A comparison of
   nothing is not a match (#3).
4. **Never let `||` carry a verdict.** `cmd || echo CLEAN` reports clean when
   `cmd` FAILS, not only when it finds nothing -- exit 1 and exit 2 are
   different facts and branching merges them. Either separate them, or do
   not branch: require a positive assertion that the check ran and passed
   (#6, #7, #8).

And for prose rather than code, match with newlines collapsed or on a short
distinctive token, because wrapping breaks a phrase grep (#9).

### Instances 10 and 11, produced while verifying the commit above

The section you have just read was merged, and its own post-merge
verification produced two more instances of what it describes. They are
recorded because they settle a question the section leaves open: whether
knowing the pattern is enough to avoid it.

Checking that rule 4 had landed, two greps in a row reported it missing:

- the first searched `never let` against a document containing `Never let`
  -- a case mismatch;
- the second searched `never let .\{0,4\}carry a verdict`, and the real gap
  is `` `||` `` plus a space, five characters. One too many.

The second printed the words **GENUINELY ABSENT**, which is a confident
assertion manufactured by a pattern that was too narrow. The text was there
the whole time, three lines below where the same command had successfully
matched three other markers.

Both were caught by the section's own rule 1 -- point the matcher at
something known to contain the thing -- applied as a literal substring
search with a must-be-0 and a must-be-1 control beside it.

**The lesson is not "be more careful with patterns".** It is that the author
of this taxonomy, within minutes of writing it, produced two more entries
for it while deliberately looking for exactly this failure. Intention does
not protect anyone here. Only a mechanical positive control does, and it has
to be attached to the check itself rather than kept in mind.

### Instance 12: the right pattern aimed at the wrong object

The eleven above are variations on one theme -- the instrument did not
look, or could not move. The twelfth is different in kind, and it bounds
the rules rather than illustrating them.

Asking whether another block's commit had landed on main, a grep for a
distinctive phrase from it returned **0**, read as "still stranded", and
contradicted a blob comparison that said the opposite. The phrase was in
the **commit message**. The file never contained it. The pattern was
correct and was pointed at the wrong object.

**A must-match control would not have caught this.** Run against the same
file it would also have returned 0, *correctly*, and would have certified
the wrong conclusion with a clean attestation. A control in the same
invocation proves the instrument WORKS. It does not prove the instrument is
AIMED at the right thing, and nothing inside a single check can.

What caught it was a **second, independent instrument disagreeing**: the
blob hash was identical on both sides while the text search said absent.

#### The conclusion, not a footnote

**For "did this change land?", compare content identity, never text.**
`git rev-parse <ref>:<path>` on both sides, or `git diff A B -- <path>`
returning empty. A phrase search answers a different question than the one
being asked and can be confidently wrong about this one.

#### Ancestry and presence are different questions

The same family, and it was reported wrongly to the coordinator before
being corrected. A branch can be **unmerged by ancestry and identical by
content**, and that is not "stranded":

- `git branch --merged` / `git rev-list main..branch` answer **is this
  commit reachable from main?**
- They do not answer **is this change present in main?**

Here one commit sat outside main's ancestry while the single file it
touched was byte-identical on main -- re-landed by its owner through
another route. Nothing was lost; the branch was a stale pointer. "Not
merged" was true and "stranded" was false, and only the content comparison
could tell them apart.

#### And one administrative instance of the same shape

A report in this session stated that "four branches await authorization",
then listed one and said two others were already in. Four, one and two do
not reconcile. Reading the refs gave the fact: of eight branches, **seven
were merged and zero awaited anything**, the single unmerged one holding
only another block's already-landed commit. The count was produced from
memory and gave comfort; the refs gave the answer. Counting is not doing,
and a remembered tally is not a measurement -- this front has paid for that
shape before.

### Instance 13: a basename comparison that dropped the distinguishing directory

Checking which shard held the size-asserting tests, a script mapped paths
with `.pop()` and reported `regex.test.ts` in **two** shards at once. That
contradicts `partition=OK` with zero dupes, which the same run had printed.

There are two files: `packages/runtime/test/regex.test.ts` and
`tests/harness/regex.test.ts`. `.pop()` removed exactly the directory that
tells them apart.

It belongs with instance 12 rather than with the first eleven: the data was
right and the *projection* of it was lossy. And it was caught the same way
12 was -- not by a control on the check, but by **a second fact
disagreeing**, here the gate's own partition verdict. A control on the
basename comparison would have passed, because the comparison did exactly
what it was told.

The same shape recurred once more within the hour: a status check for
uncommitted work printed `0` for both trees because a `cd` in an earlier
command had persisted and both halves of the check ran in the same
worktree. The work was intact; the instrument was pointed at one tree twice.
Fixed by passing `git -C <path>` explicitly rather than relying on the
working directory, which is the general remedy for this family: **name the
object in the command instead of inheriting it from context.**

### The root form: no instrument at all

The thirteen above are instruments that looked and reported wrongly. There
is a case underneath them where **no instrument ran**, and it is the one
that scales furthest, because its error is shared by everyone who reads the
same sentence.

Auditing `vendor/.cache`, two independent investigations both reported
FIVE cached units. Neither counted. Both read a source comment --
`cc.ts:774`, "The five cached vendored units (the engine archive, lre,
zlib, SQLite, mbedTLS)" -- and inherited its number as the denominator of
an audit. There are six; `ensureCurlStub` is not in the list.

A comment that claims to enumerate a population is prose, not code. Nothing
checks it, nothing fails when a sixth member is added, and once it is a
denominator its error is the audit's error. That is worse than having no
count, because it supplies confidence with the wrong number.

**A count you did not derive is not yours to trust.** Derive the population
from something the toolchain verifies -- call sites, directories on disk,
the type every member implements -- and use the prose as a lead. See
`docs/vendor-cache-key.md` for the worked case.

This is the same defect as the reference-arm sweep in S3b, one level up.
There, conclusions rested on arms whose denominators nobody had stated;
here, an audit rested on a denominator somebody else had stated wrongly.
Both are answered by the same question: **where did this number come from,
and what would have made it different?**

The question is the method. The criterion is harder, and it is what makes
the method survive a tired reader: **a number without an answer to the
second half is not a measurement.** That is a predicate, and a predicate is
something a doc line, a table cell or a commit can FAIL -- where the
question alone depends on somebody remembering to ask it, which is the
exact dependency that failed thirteen times above.
