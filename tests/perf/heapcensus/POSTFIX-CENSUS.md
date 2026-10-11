# The 64 KiB-alignment saving, measured: 3,080,192 B over 47 chunks

> ## LANE BANNER — this run is on the OTHER coroutine lane from its baseline
>
> **The `sa` arm is a FIBER-lane binary; the `evidence-idle` baseline it
> reproduces is a STACKLESS one.** Proved on the artifact, not argued:
> `evidence-postfix/sa.build-env.txt` records `EMITTED
> zapo-rest.ll=229342743`, and `DECOMP-ON.md`, section *"The three coverage
> holes, each with its evidence"*, records the baseline's as *"the measured
> artifact is on disk: `/g/blocks/h2-out182-prof/zapo-rest.ll`, 242,844,741
> B"*. `pagecensus/evidence-fr2/manifest.txt` builds both lanes from one
> tree and labels that very figure *"`<- the lane discriminator`"*:
> 242,844,763 stackless, 229,342,757 fiber. The two clusters are 13.5 MB
> apart and `sa` sits in the fiber one.
>
> **The mechanism, and section 0's identity argument does not cover it.**
> Section 0, *"The run"*, closes with *"`packages/cli/dist/main.js` is
> byte-identical to the baseline's (`sha256:33d1e9e49e5c4111…`, 18,610 B),
> so invalidator 5 is closed by identity and not by argument."* **That
> identity is true and it is the wrong file.** `cli/dist/main.js` is a thin
> entry — `zapo-rest/harness/nobuf/build.sh` says so in its own staleness
> guard — and the stackless knob is read in exactly one place,
> `packages/compiler/src/ir/coro-plans.ts`, whose compiled form did not
> exist in `G:\scriptc`'s `dist/` at the time of this build
> (`evidence-peak/lane-dist.txt`: *"`rg -l SCRIPTC_STACKLESS packages/*/dist
> 0 files`"*). The default flipped to STACKLESS at `8f4100d7a` on
> 2026-10-09 19:46 −0300; this build started 2026-10-11T02:50:03Z. A
> compiler that cannot read the knob cannot honour the flip, so **a recipe
> that set no knob at all got the fiber lane while the shipping default was
> stackless, and nothing in the build command says so.**
>
> **WHAT SURVIVES, and it is most of the file.** Every one-binary fact:
> section 1's C1 and C2 controls (a preprocessor and a string comparison of
> `scr_string.c`, which the coroutine lane does not touch), section 3's
> *"P1 — the row that dies"* and *"P2a — the count on the row that already
> existed"*, section 4's two decomposed failures, and the 113/47/4
> ownership split. The chunk size moving 131,079 → 65,536 is source
> arithmetic and is lane-independent in both directions.
>
> **WHAT IS MARKED.** Section 5, *"The realized saving"*, third bullet —
> *"The two agree to **0.004 percentage points** by two independent routes
> — 46 chunks against yesterday's heap, 47 against today's
> counterfactual."* Those two routes are two **lanes**: 18,907,440 B is the
> stackless baseline's heap and 16,243,072 B is this fiber run's. The
> agreement may be real and it is not corroboration from an independent
> route, because the routes differ in a variable neither figure names. The
> same applies to any other sentence in this file that crosses from `sa` to
> the baseline.
>
> **HOW BIG THE CONFOUND IS — proven to exist, NOT proven to be large
> here.** `pagecensus/evidence-fr2/DECOMP.txt`, block *"WHAT THE LANE
> REMOVED"*, row `CRT HEAP`: 79.828 MiB fiber against a 58.711 MiB
> stackless mean, **−21.117 MiB**, which is 7.2× the 2.9375 MiB claimed
> here. But that is measured **at the peak**, and this is a settled census
> taken through `/shutdown`. The lane's effect on the *settled* CRT heap has
> never been measured in this repository. Quoting the 21 MiB as the error
> bar here would be the same shape of mistake this banner is about.
>
> **THE TEST THAT CLOSES IT.** Rebuild the `sa` arm from a tree whose
> `dist/` reads the knob, knob ABSENT, and re-run `sa.manifest.txt`'s
> arm; certify the entry first with `tests/perf/stackless-knob-guard.mjs`
> (~3 s). Cost: 977 s of build (`sa.build-env.txt`) plus 2 m 31 s of run.
> **Not done here** — this marking slice ran no build and no measurement.
>
> **Sections this banner does not name are NOT thereby in force; they are
> UNAUDITED.** Full record in `evidence-postfix/LANE.txt`.

> **What this is.** `PLAN-POSTFIX-CENSUS.md` was written and committed at
> `fb90cc7fd` **without running anything**, with its prediction registered
> before the run existed. This file is that run. One build, one `CONVS=400`
> arm, scored by `postfix-check.sh`. Every artefact it reads is beside it in
> `evidence-postfix/`.
>
> **The verdict: the prediction holds.** `HCSIZE 131079` is gone and
> `HCSIZE 65536` reads **164 blocks**, the two assertions that carry the
> result, both exactly as registered. Two assertions failed and **neither
> failure is the effect failing** — one window was too tight and one guard
> fired on a call that never happened. Both are decomposed below, and both
> correct the checker rather than the finding.

## 0. The run

| | |
|---|---|
| tree | `G:\scriptc` @ `ddc1e373aab0cd610133a7cc38317203e8e55a47` (main, the merge commit) |
| exe | `G:\blocks\sa2-out182-prof\zapo-rest-182.exe`, 32,679,424 B |
| build | 977 s, exit 0, `SCRIPTC_NO_CACHE=1`, `early cache hit` count **0** |
| arm | `evidence-idle/on`'s knobs exactly; `SCR_STRING_ARENA` unset |
| run | 2 m 31 s, rc 0, clean `/shutdown` exit |
| artefacts | `evidence-postfix/sa.{heapcen,prof,manifest,build-env,c1,c2,check}.txt` |

`packages/cli/dist/main.js` is byte-identical to the baseline's
(`sha256:33d1e9e49e5c4111…`, 18,610 B), so invalidator 5 is closed by
identity and not by argument.

**The drift re-measured against the commit actually built.** The plan checked
`21facf366..b22985aa2`. The tree built here is `ddc1e373a`:
`git log 21facf366..ddc1e373a` is **31 commits**, of which **0** touch
`packages/compiler` or `packages/cli`, and `git diff --stat` over
`packages/runtime/src` reports **exactly two files** — `scr_async.c` (the
SQLite idle default) and `scr_string.c` (the repair). The plan's bound
survives the longer range.

## 1. The binary's identity, proved in both directions

**An exe hash is not an identity check**, and here the exe is 681,472 B
*smaller* than the baseline's — a difference that proves nothing either, since
`SCR_PROF_SITE` bakes `__FILE__` and this tree's path (`G:\scriptc\…`) is five
characters shorter than the baseline's (`G:\blocks\h2-wt\…`).

### C1 — the preprocessed TU

`zig cc -E -target x86_64-windows-gnu` with the same two `-include`s, no link.
Full output in `evidence-postfix/sa.c1.txt`.

| | fixed tree `G:\scriptc` @ `ddc1e373a` | pre-fix tree `G:\blocks\h2-wt` @ `73d88e2ea` |
|---|---|---|
| `scr_str_chunk_alloc` body | `scr_prof_malloc((((size_t)64 << 10)), ("…scr_string.c" ":" "820"))` | `return _aligned_malloc(((size_t)64 << 10), ((size_t)64 << 10));` |
| `scr_str_chunk_free` body | `scr_prof_free((p), ("…scr_string.c" ":" "822"))` | `_aligned_free(p);` |
| `_aligned_malloc` lines in TU | **3** | **4** |
| `scr_prof_malloc` sites in `scr_string.c` | **6**, including `:820` | **5**, no `:820` |

**A correction to the plan's C1, and it matters.** `PLAN-POSTFIX-CENSUS.md`
§4 asks for `_aligned_malloc` occurrences **0** on the repaired tree. That
criterion cannot pass on *any* tree: mingw's `malloc.h` and `mm_malloc.h`
declare `_aligned_malloc`, `_aligned_free` and `__mingw_aligned_malloc` at TU
lines 1846, 1847 and 2079 **before any project code is preprocessed**. The
floor is 3 and the control as written would have read FAIL in both
directions and told us nothing. Scoped to the two chunk function bodies — the
thing the control was always about — it reads cleanly in both directions, and
the whole-TU count still carries the signal as a **delta**: 4 → 3 is the one
call site that left, 5 → 6 is the one that arrived.

**The plan's named negative arm is void and was replaced.** §4 says *"run it
against `G:\scriptc` as well, where it must read `_aligned_malloc >= 1`"*.
That was true when the plan was written and is **false now**: the repair
landed on main at `ddc1e373a`, so `G:\scriptc` is the *treatment*. The
negative arm here is `G:\blocks\h2-wt` @ `73d88e2ea`, which still carries the
pre-fix `scr_string.c` with `_aligned_malloc` at **line 753** — the exact
line the plan names. The control keeps its purpose and its direction; only
its path moved.

### C2 — the site string in the two binaries

| | new exe | baseline exe |
|---|---|---|
| `scr_string.c:820` | **1** | **0** |
| `scr_string.c:822` | **1** | **0** |
| path the sites name | `G:\scriptc\packages\runtime\src\…` | `G:\blocks\h2-wt\packages\runtime\src\…` |

**This is also the answer to invalidator 2.** The worry was that
`/g/blocks/h2-wt/node_modules` is an absolute symlink into
`/g/scriptc/node_modules`, so a build from a worktree could compile main's
sources. The build here was run **from main itself**, which is the merge
commit and carries a real `node_modules`, so the ambiguity does not exist —
and the exe's own site strings name `G:\scriptc`, which is positive evidence
and not an argument. Every other `scr_string.c` site moved by exactly +55
lines (`1036`→`1091`, `2063`→`2118`, …), the shift the repair's comment block
introduces, in both the TU and the binary.

## 2. The checker's verdict, raw

```
PASS N1  census armed (the -include reached the link)
PASS N2  the census allocated its own arm (HCSIZE 5113 present)
PASS N3a  HCSIZE rows=247 (on reads 247)
PASS N3b  last line is a complete record
PASS N4  prof report terminated (the _Exit chain carried both halves)
PASS P1  HCSIZE 131079 is gone (was 46 blocks / 6030160 B)
PASS P2a  HCSIZE 65536 reads 164 blocks (= 118 cycle + 46 string)
FAIL P2b  HCSIZE 65536 bytes=10750688 outside [10750528,10750624]
PASS P5a  PROF row at scr_string.c:820 exists: count=47 bytes=3080192
PASS P5b  every chunk request is exactly 65536 (47 x 65536 = 3080192)
FAIL P5c  no PROF row at scr_string.c:822 - the free side is not interposed
SAVED 3014656 B over 46 chunks (2.875 MiB), band +-736 B
NOTE  OWNER-131079.md:217 prints 3,014,768 for c=46; this reads 3014656.
NOTE  The 112 B gap is that line subtracting a MODELLED new overhead
NOTE  (46x16=736) from an OBSERVED old one (526). Both are inside the band.
---- 2 failed
```

All five N controls pass, so the instrument is alive: the `_Exit` chain
carried both halves, 247 rows were read (not truncated), and the last line is
a whole record.

## 3. The two central assertions, with their denominators

### P1 — the row that dies

`HCSIZE 131079` is **absent** from `sa.heapcen.txt`. In the three committed
`CONVS=400` baseline arms it read **46 blocks**: `off` 6,030,160 B, `on`
6,030,160 B, `long` 6,030,128 B. No call site in the tree can produce a
131,079-byte request any more.

### P2a — the count on the row that already existed

`HCSIZE 65536` reads **164 blocks**, the registered number to the block.

**But the decomposition is not the one the prediction assumed**, and this is
the finding the run adds. The plan wrote 164 = 118 + 46, taking the whole
baseline row as the cycle collector's. Split by the PROF sites — the method
`DECOMP-ON.md` §1 prescribes, `scr_cycle.c:1546` minus `scr_cycle.c:1589`:

| owner | baseline `on` | this run `sa` |
|---|---:|---:|
| cycle-collector arena (`scr_cycle.c:1546` − `:1589`) | 614 − 500 = **114** | 675 − 562 = **113** |
| string arena (`scr_string.c:820` − `:822`) | 0 *(it was in the 131,079 row at 46)* | 47 − 0 = **47** |
| other occupants of the 65,536 class | **4** | **4** |
| **row total** | **118** | **164** |

**Positive control on the method:** 614 − 500 = 114 reproduces
`DECOMP-ON.md` §1's committed *"114 of the 118 blocks"* exactly, from the
committed `on.prof.txt`, before it is applied to the new run.

So 164 is right and 118 + 46 is not: the cycle arena lost a chunk and the
string arena gained one, and the two ±1 moves cancel. Both are workload
jitter — the committed arms already span 114 cycle chunks at `CONVS=400` and
116 total at `CONVS=200`. The row count landed on the predicted value through
a near-cancellation, which is worth saying out loud, because a reader who
takes P2a's pass as confirmation of the *split* will be wrong by one block on
each side.

## 4. The two failures, decomposed

### P2b — the window was too tight; the substance is intact

Measured 10,750,688 B. The predicted window was [10,750,528 , 10,750,624],
i.e. `164 × 65,552` plus **up to six** extra 16-byte granules.

```
10,750,688 − 164 × 65,552 = 160 B = 10 extra granules
```

Ten, not six. The "six" was a guess, not a bound: the committed arms span 1
extra granule over 118 blocks (`on`), 2 (`long`), 4 (`off`), and the old
131,079 row carried **7 over 46** — a higher per-block rate (15.2%) than this
row's 10 over 164 (6.1%). **What P2b was built to assert does hold exactly:**
every block in the row occupies the 65,552-byte granule class of a 65,536-byte
request, and `PROFHIST 1aab5ae 16:47` confirms all 47 string chunks sit in the
2^16 size bucket and nowhere else. The assertion should be stated as
`bytes ≡ 0 (mod 16)` above `164 × 65,552` with the surplus reported, not
bounded at six.

### P5c — zero frees, not a dead interposition

The checker reports *"the free side is not interposed"*. **That diagnosis is
wrong and the evidence against it is C1 and C2:** the preprocessed TU shows
`scr_prof_free((p), (… ":" "822"))` in `scr_str_chunk_free`'s body, and the
string `scr_string.c:822` is present in the binary's `.rdata`. The free side
*is* interposed.

The row is absent because **`scr_str_chunk_free` was called zero times in this
run**. `scr_prof_free` creates its row on demand (`scr_prof.h:1044`), so no
call means no row — and the `:820` row's own `freed` field reads 0. The
string arena allocated 47 chunks over the whole run and released none of them;
every chunk allocated is a chunk live at `_Exit`.

**Two assertions were silently not scored because of it.**
`postfix-check.sh:128` guards P5d and P7 on `fc >= 0`, so an absent free row
skips both — including **P7, the guard the plan calls "the single most
dangerous failure in this design"**. Scored by hand from the same evidence:

* **P5d** — alloc 47 − freed 0 = **47 live string chunks**, and the row's
  excess over its other occupants is 164 − 113 − 4 = **47**. The two lanes
  agree exactly. Note that the checker would have **failed** P5d had the free
  row existed: it computes the excess as `n65 − 118`, the hardcoded baseline,
  which gives 46 against a measured 47. The join is only sound against a
  **measured** cycle-arena count.
* **P7** — 47 live chunks against the committed floor of 33 (`half-on` at
  `CONVS=200`). **The arena ran.** Independently: `PROFHIST … 16:47`, and
  `SCR_STRING_ARENA` is recorded unset in the manifest. The arena-disabled
  false pass that P1 alone cannot catch is refuted.

## 5. The realized saving

The per-chunk delta is exact and carries no overhead term
(`OWNER-131079.md:247`, `granule = round16(request + 8)`):

```
old:  round16(131,079 + 8) = 131,088
new:  round16( 65,536 + 8) =  65,552
                               ------
per chunk                      65,536 EXACTLY
```

At the **measured** 47 live chunks:

```
47 × 65,536 = 3,080,192 B = 2.938 MiB
```

**Named denominators, every one of them.**

* **15.940%** of this run's **counterfactual pre-fix instrumented CRT busy
  heap** — the heap this program would have had under the old shape:
  16,243,072 B measured + 3,080,192 B = **19,323,264 B**. This is the only
  share figure in this file whose numerator and denominator come from the
  **same run**.
* **18.963%** of this run's **realized post-fix instrumented CRT busy heap**
  of **16,243,072 B** (`sa.heapcen.txt:3`). Larger, because the denominator no
  longer contains what was released.
* For comparison, the registered figure was **15.944%** = 3,014,656 /
  18,907,440, the **baseline `on` arm's instrumented CRT busy heap**. The two
  agree to **0.004 percentage points** by two independent routes — 46 chunks
  against yesterday's heap, 47 against today's counterfactual.
* **Not** a share of the process, of RSS, or of the uninstrumented heap. This
  binary carries `RtlCaptureStackBackTrace` in its allocation path and
  `WHICH-BUFFER.md` §5 forbids quoting RSS, private commit, throughput or
  wall-clock from it.

### How much of this is knowable

**The point estimate is exact; its last ±752 B is not, and cannot be made so
by re-running.** The 65,536-per-chunk delta is exact arithmetic. What is not
observable is whether each chunk keeps the *extra granule* HeapWalk sometimes
reports: the row holds **160 B of extra granules over 164 blocks**, and
because the chunks have merged into a row that also holds 113 cycle chunks and
4 other blocks, **that 160 B cannot be split by owner**. The string arena's
share of it is somewhere in [0, 160], so the realized saving is

```
3,080,192 B  ±  16 × 47  =  ±752 B   (0.024% of itself)
```

This is the uncertainty `PLAN-POSTFIX-CENSUS.md` §3 registered in advance and
it is **structural, not statistical**: the merge that makes the saving is the
same merge that makes the residue unattributable. The 112 B gap between
`OWNER-131079.md:217`'s 3,014,768 and the plan's 3,014,656 is the same
quantity at 46 chunks, and both endpoints sit inside this band.

### What the grand total does *not* say

`sa.heapcen.txt:3` reads busy **16,243,072 B** across **47,719 blocks**
against the baseline `on` arm's 18,907,440 B across 47,624 — a gross delta of
**2,664,368 B**. **Do not read that as the saving.** It is exposed to all 31
commits of drift, to the SQLite idle release, and to run-to-run variation; it
happens to be *smaller* than the saving because the rest of the heap grew.
P4's registered estimate of ~15,892,672 B missed by +350,400 B for the same
reasons, and it was marked informational before the run. **The verdict rests
on P1, P2a, P5a/b and P7**, which are counts and exact byte identities.

## 6. What this does to the debt in `PLAN-POSTFIX-CENSUS.md` §6

§6 asks that the `DECOMP-ON.md` §1 A1 edit land *with* the census. **It
already landed** — `git log -S` puts the *"That owner line does not survive
the string arena's repair"* subsection in `41ce4373c`, the repair commit
itself, four commits before the plan was written. What this run owes it is
the **measured** number in place of the predicted one, and that edit is in
this slice.

## 7. The method notes this run is owed

1. **A checker that skips an assertion on missing input must say so.**
   `postfix-check.sh` printed `---- 2 failed` while P5d and P7 were never
   evaluated. A guard that silently drops the design's most important control
   is the shape this corpus keeps paying for. The fix is to score them
   explicitly as `SKIP`, loudly, or to treat an absent free row as
   `freed = 0` and score them.
2. **A hardcoded baseline inside a join is a trap.** P5d joins the PROF and
   HCSIZE lanes through the constant `BASE65536=118`. That constant is a
   *measurement of another run*, and it moved by one block here. The join is
   only sound against the cycle arena's own PROF counts.
3. **A window built from "up to six" is not a bound.** P2b's failure cost
   nothing because the row's structure could be checked directly, but a
   tolerance with no derivation is a coin flip dressed as an assertion.
