# Knob-on, first complete run -- REPORT

**STATUS: PRE-REGISTERED SKELETON. No run has produced these numbers yet.**
Every `[EMPTY]` is an unfilled field, not a pending-but-known value. Written
before the run so the result cannot choose its own frame.

---

## 0. Lane (fill before reading any number)

A number without its lane is not a measurement.

| field | value |
|---|---|
| tree / head | `[EMPTY]` -- **the subject now INCLUDES boxparam.** main `54df60a99`, d15 rebased onto it at `721496bc2`. The knob-on run measures a compiler containing `05980b03c` (boxed param joins the slice), which it did not before. |
| TREEHASH baseline | `[EMPTY]` |
| node | `[EMPTY]` (want v25.9.0) |
| zig + path | `[EMPTY]` (want 0.16.0, `G:\tools\zig\zig.exe` -- two zigs on this host) |
| SCRIPTC_TARGET | `[EMPTY]` |
| SCRIPTC_CC / TEST_CC | `[EMPTY]` |
| workers | `[EMPTY]` |
| TMP / cache / ziglocal / prov | `[EMPTY]` (all must be off C: and outside the worktree) |
| expected-files (partition) | `[EMPTY]` -- **read it from THIS run's own `PARTITION` line.** It is not a constant: the killed 09:10 run said 214, the 14:53 gate says **216**, because boxparam added tests. A carried-over 214 would have passed `--expect-files` while two files went unrun. |
| disk free at start | `[EMPTY]` |

## 1. Verdict

`[EMPTY]` -- one of: COMPLETE-CLEAN / COMPLETE-WITH-FAILURES / VOID.

**Pre-committed decision rule. The exit code decides, not the reading:**

- `rc=0` -> COMPLETE-CLEAN. Claim permitted: *every collected file passes with
  the knob on.* Must still state collected-vs-expected file count; a clean run
  over fewer files than the partition expected is not a clean run over the
  suite.
- `rc=1` -> COMPLETE-WITH-FAILURES. The named list in section 2 is the product.
- `rc=2` -> **VOID. No failure list is published from this run at all**, and
  section 2 stays `[EMPTY]`. An incomplete run yields no partial verdict.

## 2. PRODUCT A -- the named failures

Not a count. File names, and the test names under each.

**IN FLIGHT -- shards 4-6 not yet reported. No verdict until the exit code.**

### shard 3/6 RED -- 1 file, 1 test

    FILE  tests/harness/fetch-dispatcher.test.ts
    TEST  the reference-count audit > a delegated fetch leaves nothing
          behind, and the audit really ran
    AT    fetch-dispatcher.test.ts:627
    SIG   AssertionError: the abandoned-fiber control did not report a skip
          -- the audit above may not have run either:
          expected 'scriptc RC AUDIT FAILED: 0 heap strin...'
          to match /RC audit skipped: 1 fiber\(s\) never resumed/

Named by two independent instruments agreeing: the shard JSON and the human
log (line 22-23, the `x` row and its arrow).

**Mechanism.** Line 627 compiles a CONTROL program that abandons a fiber and
asserts stderr matches "RC audit skipped: 1 fiber(s) never resumed". With the
knob on there is no fiber to abandon, so the audit does not skip -- it runs.
The control asserts fiber-lane behaviour unconditionally.

**This is the THIRD instance of one pattern, and my own sweep missed it.**
`651cedf93` made exactly this control knob-aware in `request-init.test.ts`
(branching on whether the artefact contains `sc_cr_f(`) and the paired
assertion in `shared-trap-helpers.test.ts`. `fetch-dispatcher.test.ts:627`
carries the same control and was not converted. So the finding is not only
this failure: it is that the knob-aware sweep was incomplete, and this names
the site it skipped.

### Triage, by the rule in 2.2 and not by how it looks

NOT an artefact. The written condition for every class is "fails identically
knob-OFF", and the knob-off gate `d15-gate-20261006-145308` was **6/6 GREEN
with 216/216 files ran** -- `fetch-dispatcher.test.ts` among them. It passes
knob-off and fails knob-on, so it is knob-specific. That evidence is stronger
than the single-file re-run the rule would otherwise require, and it is
already on disk.

The known environmental cause for this exact file is also ruled out with
evidence rather than by assertion: `fetch-dispatcher` is the canonical victim
of a TMP inside the worktree, and the pre-flight verified all four temp roots
outside it (`tmp=G:/blocks/knobon-measure/tmp`). That is the failure the
pre-flight was built to exclude, and it did.

**Class: `other`, reported UNTRIAGED.** It fits none of the six as worded --
it is not a trap or abort site (`trap-parity`), and the assertion that failed
is about a control's skip notice, not a refcount imbalance
(`frame-ownership`). Calling it an artefact would require widening a
condition, which 2.2 forbids; calling it `frame-ownership` would require
stretching that class past its wording. So it goes in `other` and the
headline carries **untriaged=1**, which is the rule working rather than
failing.

Evidence: `node G:\blocks\knobon-names.mjs <logdir> --expect-shards=6`, reading
each shard's `--reporter=json` output. Falsifiable: re-reading the same
artifacts must reproduce the list exactly, with no re-run.

## 2.1 Failure taxonomy -- PRE-REGISTERED, written before the list exists

Fixed now because this front's taxonomy has already been wrong three times:
`loop` gave its name to D2, `return` sat outside the ladder while being the
largest blocker, and today `boxedParam` was missing from the ladder because it
gates a function rather than a point. At the moment of reading, invented
classes get their shape from whatever is on the screen.

| class | a failure here would mean |
|---|---|
| `frame-ownership` | refcount imbalance -- leak or double-free -- because the frame carried the wrong set of locals. The owned-vs-live distinction has another face. |
| `unregistered-suspend` | a lib call that suspends is not registered, so a function is admitted and a park lands in a body with no fiber. `SUSPENDING_LIB_CALLS` is still short. |
| `trap-parity` | a trap or abort site exists on one lane and not the other. The knob changes refusal behaviour, not only performance. |
| `value-kind` | some value kind does not survive the state-machine round trip. The guard's ledger has another uncovered shape. |
| `collection-failure` | the file does not compile or import with the knob on. Shows up as ABSENT tests, never as red ones -- this is the shape the zero-test guard exists to catch. |
| `tick-divergence` | observable turn count differs knob-on vs knob-off. The lowering changes scheduling, so await ordering is visible to callers. |
| **`other`** | **the pre-registration was wrong.** Reported, never absorbed. |

**The rule that makes this worth writing, fixed before the data:**

1. A failure that does not fit a class **as worded above** goes in `other`.
   The temptation when reading will be to widen a class until the failure
   fits; that is forbidden here by prior agreement.
2. Classes may be **split** afterwards (one turning out to be two is a real
   finding). They may never be **widened**.
3. `other` is reported with its full count and every name, **even if it is the
   majority**. Half the failures landing in `other` is the result, not a
   defect in the report.
4. This table is reproduced verbatim in the filled report, so any post-hoc
   change to it shows up as a diff rather than as a tidier story.

### Scope -- two lines that vanish when the table is copied

- This run measures **lane C with the knob ON**. It says nothing about the
  **LLVM lane**, which is what the CLI actually defaults to.
- It says nothing about **production**, which stays at **0%**: the knob ships
  disabled.

## 2.2 Triage rule -- PRE-REGISTERED, written before the list exists

The taxonomy says what a failure IS. This says what it MEANS: does it block
turning the knob on by default, or is it a harness artefact that says nothing
about the knob?

Written before the data for the same reason the taxonomy was. After seeing the
list, the pull is to reclassify as artefact whatever is hardest to fix, and
each such reclassification looks reasonable one at a time.

**Default: every failure BLOCKS.** Artefact status is an exception that must be
EARNED by meeting a written, verifiable condition. "Looks like a flake" is not
a condition. "Fails identically with the knob off" is.

| class | what a failure PROVES about the knob | artefact ONLY IF (verifiable) |
|---|---|---|
| `frame-ownership` | the owned-vs-live frame rule has another face; the knob can leak or corrupt | the same test fails knob-OFF **with the same RC-audit counts**; or the audit did not run at all (its own UNSANITIZED skip notice is in the stderr, so no imbalance was measured) |
| `unregistered-suspend` | a fiber-only primitive is admitted and parks in a fiber-less body; `SUSPENDING_LIB_CALLS` is short | the same crash reproduces knob-OFF. Note this is **near-unreachable by construction** -- knob-off has no stackless lowering to park in. That is a property of the class, not a loophole to widen |
| `trap-parity` | the knob changes refusal/abort behaviour -- correctness-visible, not performance | the assertion's expected side is a **literal** rather than derived from the artefact (a hardcoded count re-read under a changed admission set); or it fails knob-OFF. Both current assertions were checked and DERIVE their expected value, so for them this condition is already known FALSE |
| `value-kind` | the state machine loses or corrupts a value of that kind | fails identically knob-OFF |
| `collection-failure` | the lowering cannot handle some construct -- the worst kind, because it shows up as ABSENT tests and rc=0 | the same file fails to compile knob-OFF **with the same compiler diagnostic**; or the diagnostic is in the known environmental set (missing CC, zig link refusal, disk) AND reproduces knob-OFF |
| `tick-divergence` | the lowering changes observable scheduling, so await ordering is visible to callers | the same test diverges from node knob-OFF too (a coercion adapter whose turn count differs independently of the knob) |
| `other` | nothing yet -- the pre-registration was wrong | **not applicable.** See below |

### Every artefact claim costs a re-run, and the evidence is recorded

No failure is marked artefact without an actual knob-off re-run of that single
file, recorded with the command and its result. A classification with no
evidence line is not a classification; it is the reclassification this section
exists to prevent. One file is seconds, so there is no budget excuse.

### The ceiling: 5

**Five** artefact-classified failures, summed across all classes. At six or
more, the run is reported as **HARNESS-NOT-KNOB-READY** and the blocker list is
NOT published as a measurement of the knob -- because at that point the
dominant thing being measured is the harness, not the lowering. Five is ~2.3%
of 216 files; the number is fixed now, before anyone knows whether it binds.

### Unallocatable failures are UNTRIAGED, not a new category

A failure that meets neither the blocking default nor any written artefact
condition goes to `other` and is reported as **UNTRIAGED**, with its name. No
third category is invented at reading time. Any untriaged count above zero
appears in the headline verdict, because an untriaged failure means the triage
rule itself came up short -- which is information, not a gap to be tidied.

### Scope, unchanged by this rule

Lane **C**, knob **ON**. Nothing here speaks to the **LLVM** lane, which is the
CLI default, nor to **production**, which stays at **0%** because the knob ships
disabled.

## 2.3 POWER -- what a GREEN can and cannot claim

Its own section, not a caveat at the end, because a caveat at the end is the
first thing lost when the table is copied.

**The dangerous outcome of this run is GREEN.** Zero failures will read as
"the knob is correct". It can equally mean the suite does not exercise the
knob -- green by construction, at the level of the whole measurement rather
than of one control.

### First: the 1,728 denominator does NOT belong to this run

The admitted set -- 1,099 functions and 1,728 points -- is measured on
`tests/perf/zapo-rest/app182` (zapo-js 1.8.2, the real load), per
`docs/stackless-llvm-port.md:16`. The denominators there are 1,304 functions
carrying a suspension point and 2,260 points in **that module**.

**Zero of this run's 216 partitioned files are under `tests/perf`.** The suite
never compiles app182. So "exercises N of 1,728, says nothing about the
remaining 1,728 - N" is not a sentence that can be written: the two numbers
count different populations, and subtracting one from the other is the
carried-past-its-scope error. The run's coverage and app182's admission share
no denominator.

Two traps nearby, both worth writing down:

- **1,728 is two different quantities in this tree.** `docs/estado-protofences.md:1030`
  says "Corpus size 1728 **programs**"; the boxparam commit says 1,728
  **points** of 2,260. A pure numerical collision, and exactly the shape that
  yields a confident wrong ratio.
- **Touching is not executing.** A file that compiles a converted module but
  never crosses a park proves the lowering COMPILES, not that it RUNS. These
  are two counts and the second is the one that matters.

### Measured from this run's own emitted C (PARTIAL -- live, ~1.3 of 6 shards)

| quantity | value |
|---|---|
| emitted program TUs so far | 345 |
| of those carrying a converted state machine (`sc_cr_`) | **8** |
| distinct converted functions (`void sc_cr_*(ScrCoroBase`) | 124 |

`[EMPTY]` -- **and these three numbers are worse than "partial": they are a
SNAPSHOT OF A ROTATING POPULATION, and must not be read as characterising the
run.** Measured again eight minutes later the same commands gave 390 TUs, 9
converted, and **9** distinct converted functions -- against 124 before. The
scratch directory holds a steady ~167 program dirs while their contents are
continuously reclaimed and replaced, so each reading samples whichever tests
happen to be in flight. 124 and 9 are not a decline; they are two different
samples, and neither is a total.

Consequence: **the cumulative converted set cannot be derived from scratch at
all.** It needs a run that PERSISTS the emitted C (`--keep-c` into a durable
directory) or a dedicated instrumented pass. Until then every count here is a
sample of unknown relation to the whole.

### The honest sentence

On the partial figures, **about 8 of 345 compiled programs (~2.3%) contain any
converted code at all.** A green therefore excludes defects that affect those
~124 converted functions as compiled by this suite, and it says **nothing**
about app182's 1,728 admitted points, which this run does not compile.

So if this run comes back green, its primary product is NOT "the knob is
sound". It is: **knob-on coverage in the suite is this small, and it is
insufficient on its own to justify enabling the knob by default** -- because
the population the decision is about is the one the run does not touch. That
is a useful result; it is simply not the one we were hoping for.

What would raise the power, named now so it is not invented later: a knob-on
run over `tests/perf/zapo-rest/app182` itself, which is the population every
admission number in the port doc already refers to.

### Scope, unchanged

Lane **C**, knob **ON**. Silent on the **LLVM** lane (the CLI default) and on
**production** (**0%**, the knob ships disabled).

## 2.5 Census of fiber-dependent assertions, BY PROPERTY

A grep for "never resumed|audit skipped" is a floor: it censuses vocabulary.
The property is **an assertion whose expected value is reachable only when the
fiber lowering exists.** Derived mechanically instead:

`scr_console.c:36` gates the skip notice on `scr_abandoned_fibers > 0`, and
`scr_note_abandoned_fibers` has exactly ONE caller -- `scr_async.c:4413`, the
fiber runtime. So with the knob on that branch is dead by construction. The
census keys are then the runtime's own fiber-observable emission surface, read
off `packages/runtime/src/*.c`, not a word list.

| # | site | expected value | why it depends on the fiber | shard | state |
|---|---|---|---|---|---|
| 1 | `fetch-dispatcher.test.ts:627` | matches `/RC audit skipped: 1 fiber\(s\) never resumed/` | the notice only prints when a fiber was abandoned | 3 | **RED, confirmed** |
| 2 | `request-init.test.ts:483` / `:490` | `toContain` / `not.toContain` `"never resumed"`, branched on `sc_cr_f(` | same notice, but asserted per lane | 1 | **GREEN, correctly** |
| 3 | `fiber-pool-decay.test.ts:64` | parses `/^\[fiberpool\] window freed=.../` | the pool is only exercised when fibers are created | 4/5/6 | **PENDING -- predicted RED** |

**Class 2 is the point of censusing by property.** Site 3 contains neither
"audit" nor "never resumed"; a vocabulary search cannot reach it. It depends on
the fiber through a different observable -- pool statistics.

NOT sites, and why: `differential-suite.ts:210` and
`llvm-differential-suite.ts:187` FILTER the notice out of a line stream
(`!l.startsWith(...)`), so they tolerate presence or absence and are knob-safe
in both directions. Four further hits are comments. The
`ConvertThreadToFiber` matches are compiled test binaries, not assertions.

### Pre-registered prediction for site 3, made before its shard reported

`fiber-pool-decay.test.ts` is partition index 142 and shards 1-3 did not run
it, so it is still ahead in 4, 5 or 6.

Mechanism, measured not reasoned: its fixture
`tests/fixtures/fiber-pool-decay/burst.ts` **converts under the knob** -- 0
`sc_cr_` definitions knob-off, **6** knob-on. Converted functions create no
fibers, so the pool is never exercised and `[fiberpool] window` never prints.

**Prediction: the positive arm fails (`parseWindows` returns an empty array),
and the suite's own negative control -- "decay off prints NO windows" -- passes
VACUOUSLY.** Its header comment already names that trap: "an unarmed build
would satisfy that by printing nothing ever."

If instead it passes, the live alternatives are that the pool survives the knob
through some non-converted async path, or that the arm never executes. Both are
distinguishable by reading the emitted C of its fixture, which is already
measured above.

### PREDICTION REFUTED -- site 3 passed, and the model was wrong

`fiber-pool-decay.test.ts` ran in **shard 5 and PASSED** (2 tests, 40.1s);
shard 5 was GREEN. The prediction was wrong and the inference behind it was
wrong, not merely unlucky.

Both pre-registered alternatives are also excluded by measurement:

- *"the arm never executes"* -- it executed, 40 seconds of it.
- *"the test built knob-off"* -- it compiles through `compile()` with the
  ambient environment (line 74 spreads `process.env`), so it inherited
  `SCRIPTC_STACKLESS`. And the fixture does convert: its knob-on TU carries
  **6** `sc_cr_` definitions.

So a binary with six converted functions still produced `[fiberpool] window`
lines. The knob-on TU calls `scr_loop_run`, and the fiber machinery is still
linked and still used.

**The corrected model:** conversion is PER FUNCTION, and the two lanes COEXIST
in one binary. Converting some functions does not remove fibers from the
program -- it removes them from those functions. A fiber-dependent assertion
therefore breaks only when the SPECIFIC fiber it depends on is the one that
was converted away.

That is exactly why site 1 fails and site 3 does not: `fetch-dispatcher:627`
depends on one particular abandonment, in a function that got converted, so no
fiber is abandoned; `fiber-pool-decay:64` depends only on the pool being
exercised at all, which surviving fiber traffic still does.

**Consequence for the census.** Fiber-dependence is necessary but NOT
sufficient. The census names candidates; whether a candidate breaks depends on
whether its specific fiber source was converted, which the census does not
measure. Its three sites are an upper bound on breakage, and today's evidence
is 1 broken, 1 fixed, 1 unaffected.

### The number asked for: fiber-dependent sites that passed GREEN

**Exactly one -- site 2, `request-init.test.ts`, in shard 1.** And the reason is
a third option neither of the two offered: the dependency is real AND executed,
but the assertion was already made knob-aware in `651cedf93`, so it passes on
the correct branch rather than vacuously. Distinguishable by reading: it is the
only site carrying BOTH branches.

So of three fiber-dependent sites: one fixed and green, one broken and red, one
predicted broken and not yet run.

## 2.4 The knob reaches THIS RUN -- control on the real gate

Its own section because it is the evidence the whole run rests on, and it was
found without looking for it.

The pre-flight proves the knob reaches *a* compiler, by emitting a TU twice and
counting state-machine symbols (off=0, on=6). That is a two-second probe on a
five-line program. It does not prove the knob reached the 216-file suite.

This does: **`armrig/tmp` -- the scratch of the knob-OFF gate -- contains ZERO
converted `.c`**, while every `sc_cr_` on this machine comes from the knob-on
run's scratch (15 converted TUs, 27 distinct functions at the time of
measurement). Same box, same tree, same compiler, same 216 files; the only
difference is `SCRIPTC_STACKLESS`.

So the chain is closed in the artefact rather than in an environment variable's
echo: the knob reaches the compiler (pre-flight), and the knob reaches *this
suite* (this control). Without the second link a green run could have meant the
knob never arrived.

## 3. PRODUCT B -- validation of the extractor itself

The run has two products. This one says whether product A can be believed.

| check | result |
|---|---|
| shards read / expected | `[EMPTY]` / 6 |
| unreadable reports | `[EMPTY]` |
| cross-check ok / mismatch / unavailable | `[EMPTY]` |

**Armed before the run, not against it:** `G:/blocks/knobon-selftest.mjs`,
14 synthetic cases where the answer is known in advance, each asserting both
what must appear and what must not. Mutation-proven -- disabling the
suite-status arm turns exactly the collection-failure case red, and making the
cross-check always agree turns exactly the two mismatch cases red. A harness
never seen failing is not evidence that it can.

The cross-check holds the JSON-derived per-shard counts against the **same
shard's own `Test Files` summary line** in the human log -- two independent
artifacts from one pass, since `gate-sharded.ps1:350` runs both reporters
together. It costs no extra run.

**Pre-committed:** any mismatch means the JSON shape assumption is wrong, so
product A is void and section 2 is `[EMPTY]` -- fix the reader and re-read the
same artifacts. Any `unavailable` is also void: **a cross-check that could not
run is not a cross-check that passed.**

### Validated against a REAL completed run, before this one

The standing caveat all session was that the extractor had only ever met
synthetic input, so a wrong shape assumption -- vitest spelling a status
"fail" where the reader expects "failed" -- would report little and read as
clean. That caveat is now CLOSED, using boxparam's preserved artifacts
(`G:/blocks/boxparam/logs/20261006-135754`): a complete six-shard GREEN run
with both reporters' output and independently known ground truth.

| axis | extractor | gate's own record |
|---|---|---|
| shards | 6/6 | 6 SHARD-RESULT lines |
| files | 216/216 | `PARTITION-RESULT expected=216 ran=216 missing=0` |
| tests | 6,691 | 976+1698+747+1743+565+962 = 6,691 |
| failures | 0 | all six GREEN |
| cross-check | 6 ok | -- |
| empty files | 0 | real skipped files did NOT false-positive |

Every axis agrees, including per-shard test counts against the real
ANSI-coloured summary lines. The shape assumption is confirmed on real vitest
output rather than on my own fixtures.

That run was GREEN, so the naming path would have been green by construction.
So one REAL passing assertion in a REAL shard report was flipped to failed:
the extractor named the right file and the exact test
(`tests/harness/async-generator-boundary.test.ts`, path normalised from its
absolute form), AND the cross-check REFUSED -- "log says 0, JSON says 1",
rc=2. On real artifacts a claimed failure the log does not corroborate is
rejected, which is the difference between a cross-check and a decoration.

### The completeness lesson, in its general form

Not "count the files too". The rule is:

> **Every completeness guard has a neighbouring axis, and that axis is open
> until it has been proven closed by mutation.**

The specific shape is forgettable and keeps coming back wearing new clothes.
Four instances today, each found only after the previous one was closed:

| guard that existed | neighbouring axis it left open |
|---|---|
| assertions counted | suite status -- a file that failed to COLLECT counted as passing |
| shards counted against 6 | files counted against nothing |
| files counted against 216 | tests counted against nothing -- a file running ZERO tests passed every guard |
| cross-check read `Test Files` | it did not read `Tests`, though the gate's own `Get-ShardVerdict` reads both |

Each was closed only once a mutation proved the new guard could go red:
disabling the suite-status arm reddens exactly the collection-failure case,
removing the zero-test guard reddens exactly that one, and dropping the
`Tests` comparison reddens exactly the test-count case. A guard never seen
refusing is not a guard, and the next axis along is open right now.

Operationally: pass the `PARTITION` line's own file count, never a remembered
one. The killed 09:10 run said 214; this tree says 216.

## 4. What this run does NOT claim

`[EMPTY]` -- but fixed in advance: nothing about performance, nothing about any
lane other than section 0's, and nothing about files the partition did not
reach.

---

## 5. Provenance of the earlier, killed run -- DURABLE HOME

This section exists because its original lives in `G:\blocks\slice-tmp\` under
a prunable TMP directory. This is the copy meant to survive.

The `20261006-091028` log directory contains **no result**: zero `shard-*.json`,
one `shard-1.log` truncated mid-stream, only shard 1 of 6 started. Pointing the
extractor at it exits 2. That run was **killed deliberately**, mid shard 1, on
disk consumption -- before the JSON reporter writes its file at end of run,
which is exactly why the shape looks like that.

It nonetheless produced three failures, read **live** from the running output
and afterwards **reproduced independently**:

| # | finding | reproduction | status |
|---|---|---|---|
| 1 | RC leak in `request-init` | 10/10 knob-on vs 0/10 knob-off | FIXED, merged `d7d690369` |
| 2 | `4611` crash | 10/10 | FIXED, merged `bf1143f06` |
| 3 | trap parity | 15/15 | **NOT fixed -- pending in `658aeebe9`, awaiting gate** |

Attribution measured at the base. **Two fixed and merged, one still open.**
Verified by commit content, not subject line: `d7d690369` adds the owned-local
sweep to `coroFrameLocals` (width in-commit: 707 of 990 converted functions,
71.4%); `bf1143f06` registers `async.awaitDyn` in both the union and the
runtime array, carriers `4611-dyn-func-generator-param-callable.ts` and
`4631-readonly-map-in-a-record-through-unknown.ts`; `658aeebe9` touches zero
source files and so asserts the gap without closing it. `b299e89f0` looked
plausible by subject and is **not** one of the three.

**The error this section prevents:**
"That directory is not evidence of anything" is TRUE.
"Those three failures never happened" is FALSE.
Both hold at once, and the second must never be derived from the first -- it is
the day's recurring shape, absence in one place read as absence in general,
pointed backwards.


---

# 6. DESIGN: knob-on differential over app182 (not yet run)

Authorised, designed before execution. Three things in the brief needed
correcting first; they are named because each changes the build.

## 6.1 Three corrections to the premise

**(a) app182 does not terminate.** It is an HTTP/WS server (`zapo-rest.ts`,
ending in a listen callback plus `initStore()`). "Equality of stdout, stderr
and exit" is undefined for a process that never exits. It becomes definable
because the entry already exposes `ZAPO_REST_ALLOW_SHUTDOWN` and
`ZAPO_REST_SHUTDOWN_MS`: drive a bounded scripted workload, then shut down, and
an exit code exists to compare. Without that the oracle has no exit term.

**(b) `SCRIPTC_STACKLESS` is a COMPILE-time knob, so the arms are two
BINARIES.** `delivery-ab-knob.sh` is built for the opposite case -- a runtime
env knob where both arms are one binary, chosen precisely so the comparison
carries no code-layout confound. It is therefore the wrong driver here: our
two arms are separately compiled and the layout difference is unavoidable.
That is harmless for a CORRECTNESS differential (behaviour, not cycles or
RSS). It is fatal for anything else, so as a RULE rather than an aside:

> **No memory number and no timing number may be taken from these arms.**

The reason, stated rather than omitted: the two arms are separately compiled,
so they differ in code layout as well as in lowering, and an A/A floor taken
on one binary cannot bound a layout difference. That is precisely why
`delivery-ab-knob.sh` was built for a RUNTIME knob -- one binary, two paths,
zero layout confound. Pointing that driver at these arms would emit memory
figures that look measured and are not, which is worse than having none.

**(c) The reusable part is the workload and rotation, not the comparator.**
`delivery-ab.sh` / `delivery-ab-knob.sh` carry arm rotation because position
within a repetition is a 28.7 MiB effect on this box. Correctness equality is
position-insensitive, so rotation is not required -- but the workload plumbing
is, and it should be copied rather than reinvented.

## 6.2 Oracle

knob-ON against knob-OFF: same compiler, same source, same workload, one
variable. NOT against node -- node is a different implementation and would
reintroduce every divergence this front has already catalogued.

Compared, per arm:

| term | how |
|---|---|
| exit code | via `ZAPO_REST_ALLOW_SHUTDOWN` after the scripted workload |
| stderr | raw bytes |
| stdout | normalised, see below |
| HTTP responses | fixed request script; status + body, normalised |
| WS event stream | ordered frames for the scripted session |
| tick counts | **instrument required -- see 6.4** |

**Normalisation is the risk, so it is enumerated and controlled.** Fields
expected to differ run-to-run: timestamps, session ids, QR payloads, port if
arms differ, and any duration. Each is normalised by an explicit rule written
in the comparator, and the comparator must pass a POSITIVE CONTROL: inject a
one-byte behavioural change in one arm and confirm the normalised comparison
still fails. A normaliser that cannot fail is the whole measurement reading
green by construction, one level below the run.

## 6.3 The power question, as two separate counts

**Admitted in the emitted C** -- cheap, static, exact: count
`void sc_cr_*(ScrCoroBase` in app182's own emitted TU, per arm. This is the
denominator that actually belongs to app182, unlike anything in section 2.3.

**REACHED at execution** -- `[EMPTY]`, and **no instrument exists**. Searched:
the runtime has `SCRIPTC_RC_AUDIT`, `SCRIPTC_RC_SITES`, `SCRIPTC_TRAP_TRACE`,
`SCRIPTC_SAN`, `SCRIPTC_NET_WAIT`, `SCRIPTC_FETCH_CURL`, `SCRIPTC_PROF_CFLAGS`
-- none counts a park or a resume. `harness/coverage.mjs` is route-surface
coverage (zapo's public API against served routes), not suspension coverage.

So this count is NOT estimated. What it requires, stated so it can be built or
declined: a per-resume-point counter emitted under its own build flag, keyed by
(function, state), incremented in the dispatch.

**It must not be flushed at exit.** `process.exit` lowers to `_Exit` in
zapo-rest, so `atexit` censuses are compiled in and silently never run -- that
has already produced a whole series that worked only because something else
chained the call. The table must be dumped on an explicit trigger (a debug
route, or a signal handler) or written incrementally.

Until that exists, a green differential over app182 is bounded by *points
reached*, which is unknown, not by *points admitted*, which is known. Those
are different claims and the smaller one is the true one.

### The instrument must enter the build cache key, and that must be PROVEN

This front has already paid for this: a header `-include`d from under
`tests/perf` was not part of the cache key, so editing the census served the
PREVIOUS binary from a byte-identical exe. An instrument the key cannot see
means measuring the build from before it existed, and the result looks
entirely plausible.

So the flag and the counter's source file must both be in the key, and the
proof is an experiment, not an inspection.

**But the obvious experiment is invalid here.** "Enable the counter, confirm
the exe changes" fails as stated, in both directions:

- an exe embeds its `-o`-derived PDB path, so building the two states into
  per-arm output directories guarantees different hashes **whatever** the key
  did -- a pass that proves nothing;
- and if the key is broken, the cache may serve a byte-identical exe, which
  reads as "no change" rather than as "stale".

The valid form: build to the SAME output path, counter off then on, and
compare the **emitted C** (or `.ll`), not the exe hash -- that is the artefact
the key is supposed to invalidate. Then invert it: with the counter ON, touch
nothing and rebuild; the C must be identical. A key that cannot distinguish
those two cases is not proven by either one alone.

## 6.4 Cost -- UNMEASURED, and deliberately not estimated

`[EMPTY]` minutes per arm, `[EMPTY]` GB per arm. The only anchor on record is
that an app182-scale link is the expensive step (the reason the knob pre-flight
skips linking at all). The first action is to TIME ONE ARM's build and record
it, before committing to two.

Each arm needs its OWN cache: the knob changes the emitted C, so an arm sharing
a cache with the other misses every async-bearing TU and the second arm's cost
is not the first arm's cost.

## 6.5 Hard limit: nothing writes to the user's zapo-rest

`G:/zapo-rest/` -- the user's binaries and paired store -- is untouchable. The
repo source under `tests/perf/zapo-rest/app182` is input only.

Verified-by-construction, not by intention: the entry contains no absolute
`G:` path, and the store location is environment-driven. Per arm, in its own
directory under `G:/blocks/app182-ab/<arm>/`:

- `ZAPO_DB` -> that arm's directory
- `ZAPO_REST_PORT` -> a distinct port per arm
- `ZAPO_AUTOCONNECT=0` -> no real WhatsApp connection, so no QR gate
- all four `SCRIPTC_*` temp roots -> that arm's directory

And a guard, because a constraint nobody checks is a comment: snapshot the
listing and mtimes of `G:/zapo-rest/` before and after each arm, and REFUSE the
result if anything changed. Proven by the same method as everything else --
break it deliberately once and confirm it refuses.


---

# 7. DESIGN: the minimal knob-on gate (not yet buildable -- see 7.2)

If all knob-on coverage fits in a handful of files, checking the knob stops
being a 75-minute end-of-day measurement and becomes a check that runs on every
change. That would alter the regime of the whole front: today nobody knows the
knob is broken until someone pays for a full run.

## 7.1 Are the knob-relevant tests concentrated? NO -- spread

Asked because concentration would make the minimal gate nearly free. It does
not hold.

Only two of the 216 files are named `stackless-*`
(`stackless-rc-balance.test.ts` at partition index 203,
`stackless-values.test.ts` at 204) -- and **neither is among the files observed
emitting converted C.** The files seen emitting it are
`shared-trap-helpers.test.ts` (idx 46), `builtin-fn-value.test.ts` (88),
`fetch-slice-price.test.ts` (137) and `request-init.test.ts` (187). The name
does not predict the property.

Shard 1 holds `shared-trap-helpers` (46) and `request-init` (187) but not the
other four, so vitest's `--shard` is not a contiguous cut of this ordering and
the relevant files land in different shards.

**This turns out not to matter, which is the useful part.** A minimal gate does
not need a shard: vitest takes an explicit file list. Cost becomes the sum of
those files' own durations rather than any fraction of the partition, so the
spread costs nothing as long as the SET is known.

## 7.2 Why it is not buildable yet

The set is not known. Per the correction in 2.3, the converted-program
population can only be sampled from scratch, not totalled, because the
directory is reclaimed as the run proceeds. The design is therefore complete
but blocked on one input:

`[EMPTY]` -- the cumulative set of converted functions and the files that carry
them, from a run that keeps its emitted C.

## 7.3 Coverage proved by IDENTITY, and refusing when short

The check is set equality on function NAMES, never on counts:

    union(converted fns emitted by the subset) == full set of converted fns

**Counts are specifically forbidden**, and I made the error this guards against
while measuring section 2.3: summing each program's distinct converted
functions gave 16 where the globally distinct total was 9, because the same
function appears in several programs. Two programs each carrying 2 converted
functions may carry 4 or 2 between them. "124 covered" and "124 different" are
different claims.

The tool must **refuse to report coverage** if any converted function in the
full set is absent from the subset's union, and name the missing ones. Partial
coverage reported as coverage is worse than no gate.

## 7.4 Proven by FAILING

A minimal gate that cannot fail is worse than none, because it manufactures a
feeling of cover. So: break one converted function deliberately -- perturb its
lowering, or corrupt one state in its dispatch -- and show that the subset
turns red. Repeat for one function per carrying file, since a subset that
catches a break in file A proves nothing about file B.

## 7.5 The more valuable outcome

If some converted function is exercised by NO test, that is the finding, and it
is worth more than the subset: it names where the knob runs without a net.
Report those functions by name, with their carrying program, and do not let a
tidy subset obscure them.

Note the standing distinction, which applies here one level down: a test that
COMPILES a converted function has not necessarily EXECUTED it. The subset
bounds compile coverage; execution coverage needs the resume-point counter from
section 6.3, which does not exist yet.
