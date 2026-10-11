# The 4,376 class: a SET value, not a default, and it does not bind

No build and no run. Everything here is read from data already committed at
`1f03e0e63`. `sqlcache-stats.mjs` runs from this directory with no arguments
and regenerates `RESULTS.txt`.

## 0. The premise this slice was given, and what happened to it

> *"The SQLite default for `PRAGMA cache_size` is -2000, about 2 MB. The
> measured population is 3 to 4 times that."*

**The -2000 is never in force in this runtime.** Two independent places set
`-16000`, and both are reached in the measured runs:

| where | what it sets | SET or inherited |
|---|---|---|
| `packages/compiler/src/backend/cc.ts:1291` | `-DSQLITE_DEFAULT_CACHE_SIZE=-16000` in `SQLITE_DEFINES` | **SET**, compiled into every binary |
| `tests/perf/zapo-rest/app182/zapo-rest.ts:259` | `const CACHE_KB = envNum("ZAPO_SQLITE_CACHE_KB", 16000)`, passed as `pragmas: { cache_size: -CACHE_KB }` at `:283` and `:313` | **SET** by the app, default 16000 |

`ZAPO_SQLITE_CACHE_KB` does **not** appear on the `knobs` line of any
`evidence-peakvar/p*.manifest.txt`, so all six runs took the 16000 default.

`cc.ts:1286-1291` names the reason: `-16000` was chosen **to match
better-sqlite3's own build**, read from the installed package's
`deps/defines.gypi`. It is a parity decision, not drift.

So the briefing's branch **(4) — "I read the default wrong"** is the one that
holds, and it compounds: the value is not merely different from -2000, it is
*deliberately* different, in two layers, with a written rationale.

## 1. Branch (3), the one that would have destroyed the question: ELIMINATED

Size alone cannot separate page cache from anything else that asks for 4,368
bytes. Three strands do, and none of them is a size match.

**Octave-12 site table (FLOW, every committed `*.prof.txt`).** Only two sites
carry traffic above 100 allocations in `[4096, 8192)`:

- `packages/runtime/src/scr_array.c:444` — the *larger* row (8.5k-17.8k).
  **Structurally incapable of 4,376.** `scr_arr_grow`
  (`packages/runtime/src/scr_array.c:390-399`) starts `cap` at 4, **doubles**
  it, and requests `want = cap * sizeof(uint64_t)`. `want` is always a power of
  two; in octave 12 that is **exactly 4096**. The measured class 4096 is
  present and separate (13-14 blocks at peak, 12-13 at shutdown).
- `tests/perf/heapcensus/scr_heap_census.h:293/707` — 137 allocations, the
  **instrument itself** (`SCR_HEAPCEN_ARM_SIZE 5113`), corroborated by
  `armCount=137 armSize=5113` on the `HCTOTAL` line.
- residue: `packages/runtime/vendor/sqlite/sqlite3.c:28035`, `sqlite3MemMalloc`.

**Exact-class stack capture, already in the tree.** The PROF builds are armed
on `-DSCR_PROF_STACK_SIZE_MIN2=4376 -DSCR_PROF_STACK_SIZE_MAX2=4376` (visible
in `evidence-peakvar/SL.build-env.txt`, line `PROF_CFLAGS`), i.e. an **exact
size**, not an octave. `evidence-peaksite/RESULTS.txt` reads
**2,780 allocations x exactly 4,376 B = 12,165,280 B** — exact to the byte, so
a pure class — on the stack path
`sqlite3MemMalloc <- pcache1Alloc <- pcache1FetchStage2 <- getPageNormal`
(`WHICH-BUFFER.md` §2).

**Source arithmetic.** `szAlloc = szPage + szExtra + ROUND8(sizeof(PgHdr1))`
= `4096 + 216 + 56 = 4368` (`sqlite3.c:58472`), `+8` for the size prefix at
`sqlite3.c:28035` = **4376**.

## 2. Branch (2), my own prediction: WRONG. One connection, not several

`app182/zapo-rest.ts:252-281` documents, with a negative control, that **one
connection serves every domain of every session**: `openSqliteConnection` keys
its process-wide cache on `driver|path|pragmas|tableNames` and the sessionId is
not in that key, so the stores and the service's raw queries land on the same
`better-sqlite3` Database. A second handle exists only behind `openControl()` /
`secondConn`, reached by one route; `evidence-peakvar/v3-rig.sh` is environment
only and the workload never calls it. **6-8 MB is one cache, not a sum.**

The `4104` class holds **exactly 2 blocks in all six runs, at the peak and at
shutdown, in both arms** — a population that does not scale with the load.
Reported as a size class only: the peak census carries no site id.

## 3. The arithmetic the question actually turns on

```
cache_size   pages/connection   max measured peak population   binds?
-2000                     483                           1845    YES
-16000                   3871                           1845    no
```

`numberOfCachePages` (`sqlite3.c:57021-57036`) divides `-1024*N` by
`szPage + szExtra` taken at the **PCache** level — `4096 + 136 = 4232`, not by
`szAlloc`.

**The shipping ceiling is never reached.** The largest peak population across
six runs is 1,845 blocks = **47.7% of the 3,871-page allowance**. What bounds
the population at the peak is the workload plus the idle release, not the knob.

Stackless peak mean **1,628.3** blocks; fiber peak mean **1,215.7**. All three
stackless runs match the briefing (1,570 / 1,845 / 1,470).

**A correction to the briefing's own figure.** `HCPKSIZE`'s third column is
`size + overhead` (`scr_heap_census.h:167`, from `PROCESS_HEAP_ENTRY`), and
this class carries **248 B of CRT overhead per block (5.66%)** — 4,624 B
committed per 4,376 B asked. `count x 4376` gives 6.43-8.07 MB; the committed
footprint is **6.80-8.53 MB**.

## 4. The verdict, by the rule that decides it

> **A default is not a defect.** Is there a release mechanism? Was it ON in the
> measured run? And did the arm you think moved a ceiling actually move one?

- **Release mechanism: yes, and it works.** `HCSIZE 4376` is **ABSENT at
  shutdown in all six runs** — the class goes to zero.
- **It was ON:** `SCR_SQLITE_IDLE_RELEASE_MS=1000 SCR_SQLITE_IDLE_STAT=1` on
  every `p*.manifest.txt` knobs line.
- **The third test is the one that was already failed, and it is recorded.**
  `WHICH-BUFFER.md` §2a: the `nocache` arm (`ZAPO_SQLITE_CACHE_KB=0`) was
  believed to test the cap and **was an A/A** — with `CACHE_KB=0` the app
  passes no pragma and the connection takes the *compiled-in* `-16000`, so both
  arms ran the same ceiling. It moved the row 2,792 -> 2,791, one block.

**This is not a defect and it is not an unexamined default.** It is a SET
value, set twice, for a written reason, sitting 2.1x above the population it
holds. The only move that would shrink it is lowering the ceiling below the
working set, and `scr_async.c:2498-2505` records that trade as **already
measured and rejected**: on a 129.6 MB database, four runs per arm, the lowered
ceiling cost **+6.65 ms per request (+74.1%, ranges non-overlapping)** while an
idle release cost +8.18 ms **once**. That measurement is why the idle-release
seam exists at all.

**There is no remaining runtime lever in the 4,376 class.** It is a legitimate
null.

## 5. If someone wants to test it anyway: the cost

The knob is read in two places and neither needs a source change:

- `ZAPO_SQLITE_CACHE_KB=<kb>` — environment, read at
  `app182/zapo-rest.ts:259`, default 16000. Changing it needs **no rebuild**:
  the existing `v3-out182-SL` / `-FB` binaries honour it, because the value
  travels as a `PRAGMA` through `store-sqlite`'s allowed-pragma list.
  Cost: 6 runs at ~2.4 min = **~15 min**, no build.
  **Caveat that makes it nearly pointless:** `ZAPO_SQLITE_CACHE_KB=0` does NOT
  fall back to stock -2000, it falls back to the compiled-in -16000. To get a
  binding ceiling you must pass a positive small value, e.g.
  `ZAPO_SQLITE_CACHE_KB=2000`, which is the arm `nocache` was *meant* to be.
- `-DSQLITE_DEFAULT_CACHE_SIZE` — `backend/cc.ts:1291`. Changing it is a
  **compiler** change, needs a gate, and is strictly worse than the env route
  because the env route already reaches the same ceiling.

I did not run either. The measured prior (+74.1% per request) makes the
expected result known in direction, and this slice had no build budget.

## 6. What I did not do, and what contradicts the briefing

**Not done:**

- **No build, no run, no gate.** Nothing in `packages/runtime/src` or the
  vendor was touched; this directory is `tests/perf/**` only, so it is
  **green by construction**.
- **No site attribution of the peak population.** `HCPKSIZE` carries no site
  id, and no `*.prof.txt` exists for the six `evidence-peakvar` runs. The
  octave table in §1 is **FLOW from other runs of the same app** (postfix,
  idle, megapair), used only to eliminate rival sites; it is not a measurement
  of the peak instant and is not presented as one.
- **Did not identify the two `4104` blocks.** Named as a stable class only.
- **Did not re-derive `szExtra = 216` independently.** It is the remainder of
  the equation, as `WHICH-BUFFER.md` §2 already says in its own words.

**Contradicts the briefing:**

1. **The -2000 premise is void.** The ratio "3 to 4 times the default" compared
   the measured population against a ceiling that is not in force. Against the
   ceiling that *is* in force the population is **0.48x**.
2. **The briefing's branch (2) — several connections — is wrong**, and it was
   also my registered prediction. One connection, documented with a negative
   control in the app source.
3. **The briefing's branch (3) is eliminated, but not by the method it
   proposed.** The `*.prof.txt` route it pointed at gives only **octaves**, not
   exact sizes, so reading "the eighth that contains 4,376 by site" cannot by
   itself separate 4,376 from 4,096. What separates them is (a) the *power-of-
   two* structure of the rival site and (b) an exact-size stack band that was
   already built and already committed in `evidence-peaksite`.
4. **The question was already answered in the tree.** `WHICH-BUFFER.md` §2 and
   §2a, `evidence-peaksite/SITE.md` §2, and `scr_async.c:2470-2510` between them
   carry the identification, the ceiling arithmetic, the A/A retraction, and the
   rejected-lever measurement. `WHICH-BUFFER.md:240` states in as many words
   that the 2 MiB figure *"is true of better-sqlite3 and stock SQLite and false
   of this runtime"*. This slice adds the peak-instant arithmetic (§3), the
   248-byte overhead correction, and the connection count — not the identity.
5. **`HCPKSIZE`'s third column is not `count x size`.** The briefing's
   6.43-8.07 MB uses `count x 4376`; the file's own bytes column is already the
   committed figure, 6.80-8.53 MB.
