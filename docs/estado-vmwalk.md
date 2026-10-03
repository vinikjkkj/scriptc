# estado-vmwalk — what the 855 MiB peak private commit of a compiled zapo-rest actually is

The user's standing complaint is that a scriptc-compiled program never returns
memory to the OS after a peak. A sibling block named the RETENTION owner (the
fiber pool). This file names the PEAK itself: what the bytes are at the moment
the process is largest, decomposed into terms that **must** sum, and what two
knobs would move without touching the allocator, placement, or zapo.

Base `e54bf853f`. The subject is an **uninstrumented** `tests/perf/zapo-rest/app182`
binary — the shipped lane, no census header anywhere in it.

---

## 1. The column, and why it is that column

Every MiB below is `PROCESS_MEMORY_COUNTERS_EX.PrivateUsage`, which is the same
field `tests/perf/zapo-rest/harness/pmon.c` calls `privateCommit`. A peak taken
here and a peak taken by the rig's sampler are therefore the same number, not
two numbers that resemble each other.

Peak **working set** is a different instant and a different value — 214 against
855 MiB on the same run — and the user's complaint is about commit charge, which
is what the OS does not get back. Reading one for the other is how this would go
wrong, so the column is named in the instrument's own output on every line.

## 2. The instrument, and why it is not the one we already had

`tests/perf/memmap/scr_memmap.h` asks the same question from inside the process.
It was the right starting point and its classification rules are reused verbatim
(STACK == `MEM_PRIVATE` whose allocation base owns a `PAGE_GUARD` region; classes
disjoint and exhaustive over committed regions), as is its hard-won trigger rule:
close the high-water mark against what a walk **proved**, never against the
sampled peak, so a missed peak re-arms itself instead of latching a trough.

It was not used, for three reasons that are each specific rather than stylistic:

* **An in-process header is inside every peak it quotes.** Its own README says
  the INSTRUMENT class ran 3.5-6.6 MiB and is not subtracted. The subject here is
  the shipped binary.
* **`SCR_MM_MAXREG` is 32,768** and this workload has ~49,000 committed regions.
  Its README says the region array clips **silently**.
* **It triggers on peak working set**, and this question is about peak private
  commit.

So the walk runs from OUTSIDE, over `VirtualQueryEx`, against the unmodified
binary: `G:\blocks\vmwalk\lab\vmwalk2.c` (walker) and `vmtarget.c` (its arm).
A decomposition over `VirtualQueryEx` regions sums to the committed total by
construction — every committed page lies in exactly one region, and every region
has exactly one type and one allocation base. There is no room in it for a
forgotten term, which is the whole reason for preferring it to a list of
suspects.

## 3. The budget at the peak

One run (`e5`), every line from the same walk, kernel `PrivateUsage` = 855.41 MiB:

| term | MiB | share | note |
|---|---:|---:|---|
| STACK committed | 663.00 | 77.5% | 24,246 fiber stacks |
| &nbsp;&nbsp;of which `PAGE_GUARD` | 284.13 | 33.2% | never resident, by construction |
| &nbsp;&nbsp;usable stack commit | 378.87 | 44.3% | |
| PRIVATE (heap, arenas, sqlite) | 93.13 | 10.9% | |
| IMAGE / MAPPED, COW already taken | 0.87 | 0.1% | the 31 MB image is **not** in private commit |
| REMAINDER | 98.41 | 11.5% | page tables, 4.16 KiB per fiber |
| **total** | **855.41** | **100.0%** | = kernel `PrivateUsage` |

**Fiber-stack infrastructure is 89.0% of peak private commit.** The heap — where
an allocator change, a region design, or a placement fix would act — is 10.9%.

### The per-fiber price is 32 KiB, not 16

`packages/runtime/src/scr_async.c:1640` passes `CreateFiberEx(SCR_FIBER_COMMIT, 0, ...)`
with `SCR_FIBER_COMMIT` = 16 KiB. What the kernel charges per stack:

| | bytes | |
|---|---:|---|
| usable stack | 16,384 | the constant |
| `PAGE_GUARD` region | 12,288 | 3 pages, a Windows constant (§5) |
| page-table page | ~4,096 | for the stack's own 16 MiB reserve (§6) |
| **total** | **~32,768** | **2.0x `SCR_FIBER_COMMIT`** |

### The peak is bimodal and the mode is the live fiber count

Five runs of the identical configuration:

| peak privateCommit MiB | peak workingSet MiB | stacks at the walk |
|---:|---:|---:|
| 715.65 / 715.66 / 715.92 / 716.08 | 183.7-184.0 | 20,207 |
| 854.91 / 855.88 | 214.1-214.8 | 24,246 |

`STACKSUM` is byte-identical within a mode across runs. The 139 MiB between the
modes is 4,039 fibers at 32 KiB (126 MiB) plus the heap that comes with them.
This gives the project's existing "peak RSS is bimodal and the mode is POSITION"
note a mechanism on the commit column: here the mode is the live fiber count.

### At the peak the pool holds nothing

A control run with `SCR_FIBER_POOL=0` reports **24,245** stacks against the
pooled arm's 24,246. Every stack at the peak is a live fiber; the pool
contributes none of it, because by then every pooled stack has been taken out.

The same control reproduces the sibling's retention finding on a different
binary and a different run: settled private commit 37.52 MiB at cap 0 against
198.08 at cap 4096, a difference of **160.6 MiB** against their 162.19. And with
the correct per-fiber price the model now closes: `4096 x 32 KiB = 128 MiB` plus
the heap that cannot coalesce around it — not the 64 MiB that `4096 x 16 KiB`
predicted and that nobody could reconcile.

## 4. Against node, same workload, same columns

Same 19,200 messages (`CHUNKS=8 CONVS=400 MSGS=6 TEXTLEN=300`), same fake server,
same rig, same sampler, same two columns. Rotated A B B A, because peak is
position-sensitive on this rig.

| arm | peak privateCommit | peak workingSet | stack bases |
|---|---:|---:|---:|
| compiled (pos 1) | 715.66 | 184.00 | 20,207 |
| node v22 (pos 2) | 153.54 | 154.71 | 12 |
| node v22 (pos 3) | 147.57 | 149.25 | 9 |
| compiled (pos 4) | 855.88 | 214.84 | 24,246 |

```
scriptc  4.75x - 5.68x node on PRIVATE COMMIT
scriptc  1.21x - 1.41x node on WORKING SET
```

Node's private commit is essentially its working set (151 vs 152 MiB). The
compiled binary's is four times its working set. **The entire difference is
commit that cannot be resident**: guard pages plus page tables are 44.7% of peak,
and node pays neither — 9 to 12 stack bases, half a MiB.

The node arm runs the same `app182/zapo-rest.ts`, transpiled by `tsc` and run on
plain node (no tsx in the measured process). It pairs, syncs and exits 0.

## 5. LEVER 1 — the guard region is a Windows constant. The commit is not.

The hypothesis was that the three guard pages could become one. **They cannot.**
Varying the requested commit, 2000 fibers each:

| requested commit | committed per stack | guard per stack |
|---:|---:|---:|
| 4 KiB | 16,384 | 12,288 |
| 16 KiB | 28,672 | 12,288 |
| 64 KiB | 77,824 | 12,288 |
| 256 KiB | 274,432 | 12,288 |

The guard is exactly 12,288 bytes in every arm — additional to the requested
commit, and not a function of it. `SetThreadStackGuarantee` cannot lower it
either: the call succeeds with 4 KiB and the guard does not move; with 64 KiB it
grows, and only on the **calling thread's own stack**, not on fibers created
afterwards. The guarantee can be raised and not lowered, and it is per-thread.

**But the same table is a lever, in the other column.** Lowering
`SCR_FIBER_COMMIT` from 16 KiB to 4 KiB cuts the per-stack commit from 28,672 to
16,384 — **12,288 bytes per fiber, 284 MiB (33.2%) of this peak** — through a
knob that already exists as a `#ifndef`-guarded define. Stacks grow on demand
when they need more (§8 shows the instrument watching it happen), and the guard
is unchanged, so overflow behaviour is unchanged; what changes is the number of
demand-zero growth faults, which is exactly the trade the measured table beside
`SCR_FIBER_COMMIT` already documents in the other direction.

### The bound on that saving, measured as a distribution

99.97% of stacks sitting at the initial commit proves they never exceed 16 KiB.
It does not say how many stay under 4, and a mean would not say either: two
resident pages with 20% of stacks above 4 KiB is a different result from two with
0.1% above. So the histogram, from the real workload, 20,207 stacks, taken at the
same instant as the budget (`QueryWorkingSetEx` against the process handle):

| resident pages | stacks | share |
|---:|---:|---:|
| 0 | 39 | 0.19% |
| 1 (4 KiB) | 18,148 | **89.81%** |
| 2 (8 KiB) | 1,988 | 9.84% |
| 3 | 17 | 0.08% |
| 4 | 14 | 0.07% |
| 18 | 1 | 0.00% |

Mean 1.101 pages. **Above 4 KiB: 10.00%. Above 8 KiB: 0.16%. Above 16 KiB: one
stack in 20,207.**

So at a 4 KiB commit roughly one fiber in ten takes a guard fault and grows a
page; at 8 KiB, roughly one in six hundred. That is the shape of the trade, and
it is a real tail rather than a rounding error.

**Resident is a lower bound on ever-touched** — a page touched and later trimmed
reads invalid — so the tail could be larger than 10% and cannot be smaller. The
knob run in section 7 settles it directly and agrees to within 0.15 points.

An intermediate point is therefore worth naming: a commit of **8 KiB** saves
8,192 B per fiber (189 MiB at the 24,246-stack mode, 22.1% of peak) and puts only
0.16% of fibers at risk of a growth fault, against 4 KiB's 284 MiB and 10%.

## 6. LEVER 2 — one page table per fiber, because every stack reserves its own 16 MiB

The REMAINDER term is one page-table page per fiber. It was identified by
scaling, not by assertion — 0 / 2000 / 4000 / 8000 fibers give 0.75 / 8.36 /
16.37 / 32.38 MiB, i.e. **4.00, 4.00, 4.05 KiB per fiber**, independent of how
many bytes are committed.

It is a function of the per-stack RESERVE, because a 4 KiB page-table page maps
2 MiB of address space and a 16 MiB reserve puts each stack alone in its own
span. 2000 fibers, varying only the reserve:

| per-stack reserve | REMAINDER MiB | per fiber | stacks sharing a 2 MiB span |
|---:|---:|---:|---:|
| 16 MiB (the PE default) | 8.24 | 4,325 B | 1 |
| 1 MiB | 4.16 | 2,181 B | 2 |
| 256 KiB | 1.23 | 645 B | 8 |
| 64 KiB | 0.50 | 262 B | 32 |

`scr_async.c` passes reserve **0**, which means "the executable's own
`SizeOfStackReserve`". On the shipped `zapo-rest.exe` that field reads exactly
**16,777,216** bytes.

**And that 16 MiB is an unpinned linker default, not a choice.**
`packages/compiler/src/backend/cc.ts:2307` passes `-Wl,--stack,8388608` and its
own comment says why: "classic mingw ld defaults to 2MB ...; zig's lld happens to
default to 16MB today, but that is nobody's contract." That flag sits inside the
`engineArchive` block — the dynamic/island lane. A statically lowered program
like `zapo-rest` never takes that branch, so it gets lld's 16 MiB, and the
comment predicted precisely this.

### This is a latent defect before it is a saving

**The static lane must pin its stack reserve because the reserve is loose, and
the ~50 MiB is a consequence, not the reason.** The engine lane pins 8 MiB; the
statically lowered lane pins nothing and takes whatever lld defaults to, which is
16 MiB today and is, in `cc.ts`'s own words, "nobody's contract". If a future lld
changes that default, the stack reserve of every statically lowered program
changes with it, in silence, with no commit in this repository. The symptom would
be a stack overflow in production traced to a toolchain bump.

That is worth fixing if the memory saving were exactly zero, and it should be
argued on those terms: a correctness argument clears bars a performance argument
does not. The reserve now ships named rather than inherited, so the defect is
closed whatever the value; the value itself is argued separately below.

Two forms, and they are not equivalent:

* **(B1) pass an explicit reserve to `CreateFiberEx` instead of 0.** Affects
  fibers only; the main thread keeps the PE default. 16 MiB -> 1 MiB saves
  2,144 B per fiber (**50 MiB**, 5.8% of this peak); 16 MiB -> 256 KiB saves
  3,680 B (**85 MiB**, 10.0%). This is the preferred form.
* **(B2) pin the PE reserve at link for every win32 program**, not only the
  engine lane. This also changes the main thread's stack, and `scr_async.c` is
  explicit that lowering the reserve "caps how deep an async body may recurse and
  that is a semantic change, not a tuning one."

B1 is taken, and the value shipped is 1 MiB.

### 1 MiB is DEPTH PARITY with node, and that is why it is the value

Max synchronous recursion depth inside an async body -- the recursion runs on
the fiber's own stack, so the reserve is its ceiling:

| runtime | max surviving depth | vs node |
|---|---:|---:|
| node v22 | 9,520 | - |
| node v25 | 9,642 | - |
| **scriptc at 1 MiB (shipped)** | **10,547** | **1.10x** |
| scriptc at the inherited 16 MiB | 174,219 | 18.3x |

**A program that works at 16 MiB and breaks at 1 MiB is a program that recurses
past the point where node would already have thrown.** It only worked *because*
of the divergence. The 16 MiB protected no correct program - it let an
already-node-broken program run 18x deeper before dying anyway. The deepest
fiber stack measured on the real history-sync workload was **86,016 B, 12.2x
under the new ceiling**.

### What stays divergent is the behaviour AT the ceiling, not its depth

A fiber-stack overflow **kills the process** instead of throwing a catchable
`RangeError`. Same probe, wrapped in its own `try`/`catch`:

| runtime | at the ceiling |
|---|---|
| node v22 / v25 | `RangeError`, caught by the program, rc=0 |
| scriptc, any reserve (1, 16, 64 MiB) | `0xC00000FD` STATUS_STACK_OVERFLOW, **dead** |

The probe prints its first line and never reaches its own `catch`. There is no
stack-overflow handling anywhere in the runtime: no `__try`, no vectored handler,
no `SetUnhandledExceptionFilter`, no `EXCEPTION_STACK_OVERFLOW`, not even the
string `"Maximum call stack"`.

**This is a standing divergence from Node, independent of these levers and
present before them** - it holds at every reserve, because there is no
stack-overflow handler in this runtime at all. The reserve never affected
*whether* the process dies, only at what depth.

With the depth now at parity, **this is the only thing left between the fiber
stacks and node's contract**, and it is a handler's job, not a constant's. It is
open, and it is tracked in §12.

Two checks that keep this honest. The depth scales with the reserve at 16.5x
against a 16x reserve ratio, which is what proves the recursion is on the
*fiber* stack and not the main thread's -- without it, "the ceiling is somewhere
else" is an equally good reading of the same crash. And the shipped value is
verified on the built artifact rather than in the source: with the environment
unset, the gate's own binary bisects to **10,547 frames**, because a `#define`
proves nothing if the build served a cached object.

## 7. What the two levers are worth, MEASURED on the real workload

Both knobs are read by `getenv` in `scr_async.c`, the same shape
`SCR_FIBER_POOL` is read. During the measurement both defaulted to the previous
compile-time value, so an unset environment reproduced the old binary exactly and
**one binary served every arm** — no rebuild between arms, no compiler difference
to confound — which is the property that made the pool measurement sound.

Eight runs, rotated A B C D D C B A so no arm is confounded with position.
Peak private commit is bimodal here and the mode is the live fiber count, so the
runs are **classified by mode before anything is compared**.

**Low mode, 20,207 stacks:**

| arm | peak privateCommit | peak workingSet | bytes/stack | page tables |
|---|---:|---:|---:|---:|
| baseline (unset) | 714.94 | 184.36 | 28,673 | 82.27 |
| `SCR_FIBER_COMMIT=4096` | 486.57 / 486.86 | 183.9 / 183.5 | 16,807 / 16,811 | 82.3 |
| both | 445.56 | 183.21 | 16,800 | 40.75 |

**High mode, 24,2xx stacks:**

| arm | peak privateCommit | peak workingSet | bytes/stack | page tables |
|---|---:|---:|---:|---:|
| baseline (unset) | 855.86 | 215.35 | 28,673 | 98.50 |
| `SCR_FIBER_RESERVE=1MiB` | 806.01 / 805.69 | 213.9 / 214.0 | 28,673 | 49.19 / 49.07 |
| both | 538.51 | 215.98 | 16,830 | 48.68 |

| | low mode | high mode |
|---|---:|---:|
| lever 1 alone | **-228.2 MiB, -31.9%** | — |
| lever 2 alone | -41.2 MiB (from lever 1) | **-50.0 MiB, -5.8%** |
| **both — THIS IS WHAT SHIPS** | **-269.4 MiB, -37.7%** | **-317.4 MiB, -37.1%** |

**Both levers ship.** The shipped configuration is the `both` row: **714.94 ->
445.56 MiB, -269.4 MiB, -37.7%** in low mode and **-37.1%** in high, per-fiber
32 KiB -> 18 KiB, with the page-table term going 82.3 -> 40.75 MiB.

The two modes agree on the headline to 0.6 points, and repeat runs of one arm
differ by 0.04-0.06%. Projection from the per-fiber price was 38.8%; measurement
is 37.1-37.7%.

**Both controls fire.** With neither variable set the knobbed binary reports
`STACKHIST 28,672 x 24,241` — today, unchanged. With `SCR_FIBER_COMMIT=4096` it
reports `16,384 x 18,179` (89.96%), `20,480 x 1,996` (9.88%), and a thin tail
above. That growth distribution is the §5 residency prediction — 89.81% at one
page, 9.84% at two — reproduced to **0.15 percentage points** by an entirely
different instrument.

### This is a commit win and NOT an RSS win, and that distinction is the point

Peak working set is **unchanged** by both levers: 183.2-184.4 MiB across every
low-mode arm, 213.9-216.0 across every high-mode arm. That is not a disappointment,
it is the prediction holding — guard pages and untouched committed stack were
never resident, so removing them cannot move a number they were never in.

The user's complaint is that the process does not give memory back to the OS, and
commit charge is what the OS is owed. This moves that column by 37% and leaves
RSS alone. It must not be reported as a working-set improvement.

### The 284 MiB that survives everything

```
12,288 B of PAGE_GUARD per suspended task, unreachable by any knob measured here
24,246 tasks  ->  284 MiB, 33% of the peak
node pays none of it
```

Every knob in this file acts on the usable stack commit or on the page table.
**Neither touches the guard**, and section 5 shows why: it is a kernel constant
per stack, additive to whatever is requested, and `SetThreadStackGuarantee` moves
it only upward and only for the calling thread. There is no parameter left.

The only thing that removes it is not having a stack per suspended task, which is
what node does, and why node pays zero for the same 19,200 messages. That is an
architecture question (stackful fibers with JS-exact scheduling), it is the one
part of this problem no knob reaches, and **this file does not open it.** It
records the number because anyone returning here to look for a fifth knob should
know the floor before they start: after both levers, roughly a third of the peak
is still guard pages, and the next move after that is not a knob.

## 8. What the lowered commit COSTS, and therefore what the default should be

Section 5 measured the FREQUENCY of the growth fault (10.00% of fibers at a
4 KiB commit, 0.16% at 8 KiB). This is its COST. A third series, one binary,
three arms, rotated A B C C B A; five of its six runs landed in the 20,207-stack
mode and only those are compared.

| arm | n | syncMs | within-arm spread | cpuMs | page faults | peak privateCommit |
|---|---:|---:|---:|---:|---:|---:|
| baseline (16 KiB) | 2 | 15,481 | 13.1% | 17,539 | 232,742 | 715.00 |
| `COMMIT=8192` | 2 | 13,442 | 31.1% | 15,164 | 229,324 | **557.71** |
| `COMMIT=4096` | 4 | 13,940 | 22.4% | 15,543 | 230,120 | **486.76** |

**The cost is below the floor, and the floor is not subtle.** Every between-arm
difference (10-13%) is smaller than the within-arm spread (13-31%), and all of
them point the wrong way: a lower commit cannot make the work faster. Sorting the
same eight runs by box load instead of by arm explains it -- runs at or below 20%
CPU load average 12,042 ms, runs at or above 57% average 15,497 ms, **a +28.7%
swing that is larger than every arm difference in the table.** Wall and CPU on
this box cannot resolve this question, and the honest report is that they did not.

**The page-fault counter can, and it says the faults are not there.** It is the
direct count rather than a proxy, and lowering the commit does not raise it:
-1.1% at 4 KiB and -1.5% at 8 KiB against a baseline whose own two runs differ by
2.2%. That agrees with the arithmetic: about 2,020 extra guard faults inside a
14-second decode is 0.14% even at a generous 10 microseconds each. The effect is
unmeasurable by construction, not merely unmeasured.

> **So the default should be `SCR_FIBER_COMMIT = 4096`.** It saves 228.2 MiB
> (-31.9%) against 8 KiB's 157.3 MiB (-22.0%) -- 71 MiB more -- and nothing in
> wall, CPU or fault count distinguishes the three arms.

One scope limit that matters: these fibers are shallow, 89.8% touching a single
page. A workload with deeper async bodies has a larger tail and the trade could
invert. The knob is per-process environment, so a deep workload can raise it;
the DEFAULT should be chosen for the shallow case, which is this one.

## 9. Gate status

The change is three hunks in `packages/runtime/src/scr_async.c`: two `getenv`
readers shaped exactly like `scr_stack_pool_max`, and `CreateFiberEx` taking them
instead of a constant and a literal `0`, with the defaults moved to the values
section 7 and section 8 settle:

```
SCR_FIBER_COMMIT    16 KiB -> 4 KiB                    together, -37.7%
SCR_FIBER_RESERVE   inherited (16 MiB) -> named 1 MiB   depth parity with node
```

The measurement series ran before the defaults moved, with the knobs set from
the environment, so every arm in sections 7 and 8 shares one binary. The gate
below ran AFTER they moved, against the configuration actually being shipped --
gating a configuration that will not ship is the wrong test.

**Green, bounded:** the five harness files that exercise the changed path --
`fiber-pool-decay`, `event-loop`, `async-generator-boundary`,
`for-await-stream-turns`, `library-asyncfree` -- 33 tests, all passing, under
node v25.9.0 with `SCRIPTC_TEST_WORKERS=3`.

That run reported `early cache hit`, which would make it evidence about a
pre-change artifact rather than about the change, so `fiber-pool-decay` was re-run
with **no `SCRIPTC_CACHE_DIR` at all and the previous cache purged**. It
recompiled, printed no cache-hit line, and both tests passed -- including that
file's own negative control, "decay off prints no windows at all".

**The full `vitest run` was NOT completed, and the reason is disk, not red.** It
filled `node_modules/.cache` at **876 MB/min** -- 5.9 GB in 25 minutes -- against
a shared volume that had 8 GB free with two other blocks working on it. At that
rate it would have exhausted the disk in nine minutes and taken their runs with
it, so it was stopped by identity and its cache reclaimed. **A full gate on this
change needs roughly 15 GB of headroom reserved for it, and should be scheduled
when the box can give that.** Nothing was observed failing.

Two things that attempt got wrong and are worth not repeating: the output was
collected with `| Select-Object -Last 60` rather than streamed, so the log sat at
35 bytes for 25 minutes and a hang was indistinguishable from progress; and the
first kill filtered processes by a command-line substring that **also matched the
shell issuing the filter**, so it killed itself. That is the same
match-the-querying-shell shape recorded in `HANDOFF-Q1-ANSWERED.md`, in its
destructive form.

## 10. How the instrument was armed

Each of these is a run, not an assertion.

* **Positive, to the page.** `vmtarget.exe 256 0 ...` commits a known 256 MiB and
  the walk reports `CLASS PRIVATE committedMiB=256.14` with a 0.75 MiB remainder.
* **Negative.** With zero fibers the walk reports **2** stack bases and 0.05 MiB,
  not 2,002. "Found none" and "there are none" do not read alike.
* **Specificity — the one that matters.** 1,000 of 2,000 fibers run 128 KiB deep.
  The walk reports two exact clusters, `28,672 x 1,001` and `151,552 x 1,000`;
  at 200 KiB the second cluster moves to `229,376`. The instrument **would** see
  stack growth. On the real workload it sees none, and that zero is therefore
  evidence rather than silence.
* **The REMAINDER is scaled, not asserted** (§6).
* **Coverage is printed, not assumed.** Every report carries walk-resolved bytes
  against the kernel's own figure.

### Two instrument defects, recorded because both are reusable shapes

**A specificity control that passed vacuously.** The first `burn()` ended in a
tail call; `zig cc -O1` collapsed it to a loop reusing one frame, so the "deep"
arm touched 4 KiB and reported no growth. It would have **confirmed** "every
stack is 16 KiB" by being blind. A control that can only fail loudly is safer
than one that can pass for the wrong reason; this one was caught because the deep
arm's output was byte-identical to the shallow arm's, which is not what a real
effect looks like.

**A part larger than its whole.** Two per-walk accumulators were added to the
walker without being added to its per-walk `memset`, so they summed across every
walk of the run: `STACK rwMiB=10,613` against 552 MiB committed. The sum still
closed — it closes by construction — and only the part was wrong.

> **Rule this earns: a decomposition must assert both halves — every part <= the
> whole, and the sum == the whole.** Closing by construction makes the second
> check free and the first one necessary.

A third, procedural: three separate patches and one PowerShell switch silently
no-op'd because a bash heredoc ate one backslash before the pattern reached the
matcher. Patch from a file, never from a heredoc.

## 11. What this does not establish

* **Node's promise count was not measured.** "~19,200 promises at a few hundred
  bytes" remains an inference; what is measured here is node's whole-process peak.
* The walk counts **stacks**, not live fibers. The `SCR_FIBER_POOL=0` control
  shows the two coincide at the peak; it does not show that anywhere else.
* The REMAINDER is identified as page tables by linear scaling across four arms
  and by the 2 MiB-per-page-table arithmetic, not by an API that names them.
* Per-stack **residency** is memmap's earlier finding, not this one's — and it is
  the measurement that bounds Lever 1 (§5).
* Lever 2 was measured at a 1 MiB reserve only, which is the shipped value. The
  256 KiB point (a further ~37 MiB by the §6 table) is projection, and it would
  take the ceiling BELOW node's, which 1 MiB does not.
* **The overflow divergence is characterised, not fixed, and its blast radius is
  not measured.** What is established is that the process dies at every reserve
  tested and that no handler exists. Which real workloads recurse deep enough to
  reach 174,219 frames is not known, and no corpus-wide search for deep async
  recursion was run.
* The overflow probe is a **single synchronous recursion shape** on a fiber
  stack. Overflow through a different path -- a deep `await` chain, a deep native
  frame, the main thread rather than a fiber -- was not probed and may behave
  differently.
* The growth-fault cost is bounded, not priced (section 8). Wall and CPU could
  not resolve it on a box whose load swung 4% to 96% during the series; the page
  fault counter shows no increase, and the arithmetic says the effect is 0.14%.
  A quiet box would tighten the bound; it would not change the decision.
* The full test suite has not been run against this change (section 8); only the
  five files covering the changed path have.
* One run per cell for the per-class numbers; the peak columns are five runs for
  the binary and two for node, plus eight for the knob series. Box state for every table: 12 logical cores
  (6 physical), 9.7-10.0 GiB free, 408-422 processes, 16-38% CPU, three blocks
  running.

## 12. The handler front — what converting the overflow actually needs

This is a reading of the code, not a design, and not code. It answers two
questions: can an overflow be caught on a fiber stack, and is there anywhere to
return to.

### There IS somewhere to return to, and it is unusually well suited

`scr_runtime.h` is explicit about the exception model: **no `setjmp`/`longjmp`**
("longjmp would skip the emitted RC releases"). Instead the COMPILER emits
`if (scr_exc_pending()) { ... }` after every call that can throw, and unwinds by
releasing that frame's scopes and returning a dummy value. The in-flight
exception lives in a `ScrExcCell`, and there is **one cell per fiber**
(`ScrFiber.exc`), already swapped on every fiber switch by
`scr_exc_swap_cell`.

So the unwinding machinery a catchable overflow needs already exists and already
works per-fiber. **The hard part is not unwinding — it is detecting early.**
Every intermediate frame is intact and already carries its own release code; all
that is missing is a point that notices before the stack is gone.

### Route A — SEH. Possible, but it detects too late and then has to repair.

Three things would have to be true, and none is verified:

* **Headroom after the fault.** `SetThreadStackGuarantee` is per-THREAD, and §5
  measured that it succeeds and moves nothing. Whether it establishes a
  guarantee for a FIBER stack is unverified, and is the first thing that would
  have to be tested.
* **`_resetstkoflw`** to rearm the guard page. It is an MSVC CRT function;
  availability under this toolchain (`zig cc`, mingw target) is unverified, and
  it is documented for threads, not fibers.
* **The handler cannot jump.** Because unwinding is compiler-emitted and
  cooperative, an SEH handler cannot branch to the `catch` — it would have to
  synthesise a RETURN from the faulting call (`RtlVirtualUnwind` one frame, set
  the fiber's exception cell, `ContinueExecution` at the return address) so that
  the already-emitted pending check fires. Delicate, architecture-specific, and
  it must not skip a single RC release.

### Route B — a software stack limit, which this repo already vendors

`quickjs-ng`, in `packages/runtime/vendor/`, solves exactly this problem without
SEH:

```c
static inline bool js_check_stack_overflow(JSRuntime *rt, size_t alloca_size)
{   ...  return unlikely(sp < rt->stack_limit);  }
```

A stack-pointer comparison at entry, throwing an ordinary catchable error. No
SEH, no CRT dependency, no context rewriting, and it lands directly in the
existing pending-cell unwind path.

On Windows the limit needs no bookkeeping at all: the TEB's `StackLimit` is
maintained by the OS for whatever stack is current — fiber or thread — so the
check reads `__readgsqword(0x10)` and compares the address of a local, two or
three instructions, correct by construction and with no per-fiber field to
maintain. (`ScrStack.mem` is POSIX-only precisely because "Windows fibers own
their stack", so the TEB is the right source rather than something this runtime
would have to track.)

**But the TEB limit alone does not buy Node parity, and the distinction
matters:**

| | source | where it fires | main thread today |
|---|---|---|---|
| HARDWARE limit | TEB `StackLimit` | where the OS faults | 16 MiB |
| SOFTWARE limit | chosen by us | where Node would throw | ~1 MiB |

Node throws at ~984 KB. **With the reserve shipped at 1 MiB the fiber TEB limit
is already at node's depth**, so on a fiber the hardware limit alone lands in the
right place and the software floor is fine-tuning rather than a requirement. The
main thread still reserves 16 MiB - that is the PE field, set by the linker, and
`CreateFiberEx` does not touch it - so a floor is what would give the entry
function the same ceiling as a fiber.

So the test is against **`max(TEB_StackLimit, software_floor)`**: one mechanism
covering fibers and the main thread, with the floor as *policy* rather than
*mechanism*.

### What is NOT known, and would size the front

* **Where the check goes.** Every function, or only potentially-recursive ones.
  This is the whole perf cost of the fix and it is measurable on the existing
  bench, which is the first thing to do.
* **The software floor is a policy choice that is not yet made.** The mechanism
  covers the main thread and fibers identically via `max(TEB_StackLimit,
  floor)`; what the floor should be — Node's ~984 KB, or something else — is
  open, and "parity" means throwing rather than throwing at exactly 9,520.
* **Native frames.** An overflow inside a runtime C function or a vendored
  library is not covered by an entry check in emitted code.
* **Which lane any perf number describes must be declared.** The existing bench
  cannot see the dyn path — both arms are statically typed — so a cost measured
  there is the static lane's cost and must be named as such, not generalised.

## 13. Reproducing it

```sh
# the walker and its arm
zig cc -O1 -o vmwalk2.exe vmwalk2.c -lpsapi
zig cc -O0 -o vmtarget.exe vmtarget.c      # -O0: -O1 collapses the deep arm (§8)

# arm it first, in all three directions
vmtarget.exe 256 0 0 0 18 256              # positive, and the no-fiber negative
vmtarget.exe 0 2000 1000 128 18 0          # specificity: two clusters, exact

# the real subject: attach to the rig's child by IMAGE PATH, never by name
node packages/cli/dist/main.js build tests/perf/zapo-rest/app182/zapo-rest.ts \
    -o <out>/zapo-rest.exe --provenance-sources
vmwalk2.exe <pid> <out>/e1.vmwalk.txt e1 100 8 400
```

The drivers that stage all of it are in `G:\blocks\vmwalk\` — `levers.ps1` is the
two tables in §5 and §6, `series.ps1` the rotated A B B A of §4. The sole change
against the committed rig is one hunk in a local copy of `memrig.mts`:
`spawn(exe, [])` becomes `spawn(exe, JSON.parse(MEMRIG_ARGV))`, so the same rig
can drive `node` as the child for §4.

---

## Record correction, 2026-10-03 — `e53b807c5`'s headline is a diagonal

`e53b807c5` states the fiber-pool decay as `SETTLED private commit 250.67 ->
37.78 MiB, -212.89`. **Its "off" arm was never run on the decay branch.** The
figures 250.67, 102.87 and 58.02, and the "within-arm spread 2.52 and 0.83"
derived from 251.93 / 249.41, are verbatim from `G:\blocks\walkfuse\HANDOFF-POOL.md`,
the cap-4096 pair of a different experiment.

The configuration matched — cap 4096 with decay off was the shipped default
then. The **tree** did not. That arm was measured on `b6a763983`; the decay
branch is based on `53cdae32b`, **27 commits and 4 merges later**, and
`7439947b3` (a suspended fiber priced at 18 KiB instead of 32) is an ancestor
of `53cdae32b` and not of `b6a763983`. Confirmed with
`git merge-base --is-ancestor` in both directions.

So `-212.89` is the diagonal of a 2x2 — both changes on against both off —
reported as one change alone.

### The 2x2, actually run

One binary, all three knobs read from the environment, n=6 per cell, 24 runs in
six permuted blocks so no cell owns the early or late half. `settledPriv`, MiB:

```
                    decay off        decay on        decay alone
fiber at 32 KiB     C1 198.09        C2  37.65        -160.44
fiber at 18 KiB     C3 151.26        C4  36.28        -114.98
price alone          -46.83           -1.37
```

Within-cell spreads 3.17 / 2.61 / 3.87 / 0.65.

```
diagonal C1 -> C4        -161.81
sum of the isolated      -207.27
interaction I            + 45.46      (median-based +46.79)
```

`I` is 11.7x the largest within-cell spread, so it is real: **the two terms
overlap by 45.46 MiB and must not be added.** In the configuration that ships
(fiber at 18 KiB) the decay alone is **-114.98 MiB**, not -212.89.

### What the other columns say

- `settledWS` — C1 103.54, C2 52.06, C3 103.02, C4 50.96. `I = -0.57` against a
  largest spread of 3.99: **not an interaction.** Additive, and the resident
  saving is entirely the decay's.
- `peakPriv` / `peakWS` — **the design does not separate the effect from the
  draw.** The high mode hit C3 twice and C4 never, while C1/C2 sit in a separate
  tight population near 715.8 MiB priv (spread <= 1.34). Mean-based `I` is
  -29.19 / -9.46; drop those two draws and it is +0.20 / +1.41. No peak
  interaction is reportable at this n.
- What peak **does** say robustly: the fiber price is the whole peak effect and
  it is the same at both decay settings — **-271.87** (decay off) and **-271.68**
  (decay on), agreeing to 0.19 MiB.

### The general rule this cost

An arm must be run on the tree under test. When a prior artifact's arm is
reused, state the base commit of **both** arms — if they differ, it is not a
control, it is a diagonal. And two results are addable only when they name the
same column: `7439947b3` measured mode-classified **peak**, `e53b807c5`
measured **settled**, so no sum of the two was ever meaningful even before the
confound.
