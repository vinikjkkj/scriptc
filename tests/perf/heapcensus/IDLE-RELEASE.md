# The page cache gives it all back — and one pinned page keeps a whole slab

> **What this answers.** `WHICH-BUFFER.md` §2 closes the 4,376-byte row with
> *"Why these pages stay pinned is the next question and is not answered
> here."* It is answered here, empirically: **they are not pinned at rest.**
> Arm the idle-release knob and the entire 2,792-buffer population goes to
> **zero** — the census row stops existing. The same run also found the one
> thing that does *not* come back, and names why.

Measured on `h2-which-buffer` at `21facf366`, program
`tests/perf/zapo-rest/app182/zapo-rest.ts` (zapo-js 1.8.2, provenance lane),
zig 0.16.0, `x86_64-windows-gnu`. **Nothing was built for this slice.** Four
arms of the ONE prebuilt `prof`+`heapcensus` binary, the documented workload
`CHUNKS=8 CONVS=400 MSGS=6 TEXTLEN=300 ROUNDS=1 IDLE_S=60`, census through
`/shutdown` after 45 s of settle and 60 s of idle.

**This file reports counts and census bytes only.** `WHICH-BUFFER.md` §5
forbids quoting RSS, private commit, throughput or wall-clock from this
binary, because `RtlCaptureStackBackTrace` sits in its allocation path. Wall
clock is used below **only** to schedule arms and to locate phases in the
timeline, never as a result. Nothing here is combined with the −17.19 MiB of
`040d22982`: that is another run on another binary, and joining them would be
the error `HOLEMAP.md` §5 retires.

## 0. The four arms, and why the fourth one exists

| arm | env | role |
|---|---|---|
| `off` | *(none — the default is 0)* | negative control, **by default** |
| `on` | `SCR_SQLITE_IDLE_RELEASE_MS=1000 SCR_SQLITE_IDLE_STAT=1` | treatment |
| `half-on` | the same `+ CONVS=200` | positive control, known different population |
| `long` | `SCR_SQLITE_IDLE_RELEASE_MS=600000 SCR_SQLITE_IDLE_STAT=1` | **true null** |

`long` is the arm that makes the set honest. An absent env would be green by
construction; this one has the feature **ON** and the path **live**, and still
predicts no change, because the seam returns at `scr_async.c:2588` —
`if (now < scr_sqlite_idle_next_ms) return;` — for the whole 147-second run.
Run in **rotated** order `long → off → on → half-on`.

## 1. The result, and its shape

| arm | `HCSIZE 4376` | `HCSIZE 87368` | `PROFEXACT 4376` | CRT busy bytes | `[sqlidle]` | db bytes |
|---|---|---|---|---|---|---|
| `long` | 2792 / 12,906,128 | 2 / 174,752 | 2792 | 31,918,992 | 0 | 11,268,096 |
| `off` | 2792 / 12,906,128 | 2 / 174,752 | 2792 | 31,900,272 | 0 | 11,268,096 |
| `on` | **row absent** | **1 / 87,376** | 2783 | **18,907,440** | 2 kept / 128 released | 11,268,096 |
| `half-on` | **row absent** | 1 / 87,376 | 1416 | 16,981,584 | 2 kept / 128 released | 5,615,616 |

**The shape of the P1 result is not "≤ 10". It is that the row stops
existing.** The verdict is the count of the line, not a number on it:

```
rg -c '^HCSIZE 4376 ' {long,off,on,half-on}.heapcen.txt   ->   1  1  0  0
```

and the four files are known **not truncated** because each ends in
`HCTOTAL … lost=0`:

```
long     HCTOTAL distinctSizes=250 blocks=50463 bytes=31918992 lost=0 armCount=137 armSize=5113
off      HCTOTAL distinctSizes=247 blocks=50411 bytes=31900272 lost=0 armCount=137 armSize=5113
on       HCTOTAL distinctSizes=247 blocks=47624 bytes=18907440 lost=0 armCount=137 armSize=5113
half-on  HCTOTAL distinctSizes=245 blocks=47606 bytes=16981584 lost=0 armCount=137 armSize=5113
```

A truncated file is not an empty row, so the `lost=0` line is quoted here and
not merely trusted.

**The population that `WHICH-BUFFER.md` §2 called a defect — *"nothing is ever
returned, and the knob that is supposed to cap it does not"* — goes to zero
when the knob is armed.** Not smaller: gone. The 12,906,128 B that were 40.4%
of all busy CRT heap bytes are returned in full, on both armed arms, at rest.

The instrument is the same weight in all four arms: `armCount=137
armSize=5113` = **700,481 B**, self-reported, loaded identically.

## 2. The finding: all-or-nothing per slab

**`HCSIZE 87368` went 2 → 1, not 2 → 0.** This is the interesting result of
the set, and it is a *finding*, not a failed prediction — the brief that
ordered this run marked this exact half as the one most likely to be wrong,
and the failure mode turned out sharper than it could be stated in advance:

> The read of the free condition was **right**. What failed was the untested
> premise that `nPage` reaches zero.

`sqlite3.c:58316-58319`, inside **`pcache1EnforceMaxPage`**:

```c
if( pCache->nPage==0 && pCache->pBulk ){
  sqlite3_free(pCache->pBulk);
  pCache->pBulk = pCache->pFree = 0;
}
```

Three facts compose into the behaviour:

1. The eviction loop walks the **LRU**, which by construction holds only
   **unpinned** pages. A pinned page is never a candidate.
2. A **dirty** page with `nRef==0` counts as pinned. `sqlite3PcacheRelease`
   (`sqlite3.c:57295-57302`) unpins **only the clean page** — at `nRef==0` it
   calls `pcacheUnpin` under `if( p->flags&PGHDR_CLEAN )` and otherwise sends
   the page to the dirty list, where it stays held.
3. `sqlite3PagerShrink` **never writes anything out**, so it cannot convert a
   dirty page into an evictable one.

So the slab is **all-or-nothing: 19 of 20 pages unpinned returns ZERO bytes.**
One residual page holds the whole 87,368-byte allocation. Two caches, one
purged completely, one kept a page.

### P3 misses only *because* P2 missed, and the arithmetic says so

The predicted drop in busy CRT bytes was ≥ 13,080,880. Measured:
31,900,272 − 18,907,440 = **12,992,832**. Add back the one retained slab:

```
12,992,832 + 87,376 = 13,080,208      prediction 13,080,880      difference 672
```

**672 bytes.** Two separately-registered misses are one named cause: the
retained slab, and nothing else. A reader who takes them as two independent
defects has two problems where there is one.

## 3. The validity condition fell, and its inference is false

The brief registered P4 as a stop condition: *"`PROFEXACT 4376` UNCHANGED at
2,792 or more. If it falls, the arms did different work and the comparison is
NULL — stop and report it, do not adjust."*

**It fell: 2792 → 2783.** The run stopped, nothing was adjusted, and the
result is reported as a MISS. **But the inference attached to it is refuted**,
by three independent equalities that were not part of the prediction:

| check | `long` | `off` | `on` |
|---|---:|---:|---:|
| database bytes | 11,268,096 | 11,268,096 | 11,268,096 |
| database pages | 2,751 | 2,751 | 2,751 |
| whole-run allocations | 10,473,977 | 10,474,126 | 10,473,934 |
| `PROFEXACT 4376` | 2792 | 2792 | 2783 |

The database is **byte-identical**; whole-run allocation counts agree to
**0.0014%**; and `long` and `off` land on **exactly 2792** each, so the class
is reproducible to the block and the −9 is not noise in it.

The −9 is a **downstream effect of the treatment itself**. A purge drives
`nPage` to 0, `pBulk` is freed (`sqlite3.c:58316-58319`), and the next fetch
re-enters `pcache1InitBulk` and carves **20 slab-local pages** — which are not
individual `malloc(4376)` calls. Each purge/refill cycle therefore *removes*
allocations from the whole-run 4,376 count. `half-on` reproduces the signature
on its own population: 1423 → **1416**, −7.

> **Marked provisional.** Under the brief's own rule the on/off *magnitude*
> stays provisional. The **direction**, and the P1 result that the row stops
> existing, do not depend on it: they are a presence/absence verdict, not a
> difference of counts.

## 4. The nulls, and why they carry weight

`off` and `long` both printed **zero** `[sqlidle]` lines and both held the row
at 2,792. That zero is not low-power:

- **The channel is demonstrably live.** The same binary on the same workload
  emitted **130 lines per armed arm**. A silent arm is silent because the
  feature did not act, not because nothing could have been printed.
- **`off` and `long` are an A/A pair that agreed to the block** on all three
  counters: `HCSIZE 4376` 2792 = 2792, `HCSIZE 87368` 174,752 = 174,752, and
  `PROFEXACT 4376` 2792 = 2792. The census is deterministic on this rig for
  this class.
- **It is n = 1 per arm.** Both things are true at once, and the second does
  not cancel the first: the effect (2,792 → 0 and 1,423 → 0) is far larger
  than any variation observed across the four runs.

The two zero-byte files `long.sqlidle.txt` and `off.sqlidle.txt` in
`evidence-idle/` **are** the recorded zeros, produced by
`grep 'sqlidle' <arm>.client.log`. They are empty results, not absent ones.

## 5. The instrument trap that nearly voided P5

P5 required a `[sqlidle] … IN-USE, kept` line under load — the only evidence
that the execution-path stamp is being read rather than the release firing on
hot caches. **There are two different `[sqlidle]` lines in this runtime, and
only one of them can print in this binary.**

| line | site | gate |
|---|---|---|
| aggregate `window= released= inUse=` | `scr_async.c:2592-2639` | `#if SCR_ASYNC_STAT` — **compile-time**, default **0** at `scr_async.c:678-679` |
| per-connection `db=… IN-USE, kept` / `RELEASED` | `scr_sqlite.c:434` and `:442` | `getenv("SCR_SQLITE_IDLE_STAT")` — **env only** |

This binary's flags do **not** define `SCR_ASYNC_STAT`, so the aggregate line
can never print here. Confirmed on the artifact, not inferred: the fragments
`sqlidle] window=` and `totalReleased=` occur **0 times** in the exe, while
the two per-connection format strings occur twice.

**Read against the aggregate line, P5 would have failed for a reason that is
the instrument, not the feature.** Strings alone would not have caught it
either — this project's PE binaries keep string data for code that was
compiled out, so a byte scan that found `[sqlidle]` and stopped would have
concluded the wrong thing. The check that worked was scanning for the
*fragments unique to each line*.

### What P5 actually shows

130 windows on `on`: 2 kept, 128 released. The stamp reset is sharp and lands
on the load:

```
window 20   idleMs=19571   RELEASED
window 21   idleMs=21      IN-USE, kept     <- ROUND-1-START is t=20.4 s
window 22   idleMs=1021    RELEASED
```

Only two kept-lines because the sync is **one blocking batch**: the loop
cannot turn mid-write, so almost no window can land inside the burst. The one
that did, did. The stamp is written and read on the execution path.

## 6. Corrections, and traps for the next runner

Four things the brief that ordered this run had wrong, all cheap to repeat:

1. **`sqlite3.c:58322` is a comment line** — the `/*` opening the header of
   `pcache1TruncateUnsafe`. The free is at **`:58316-58319`**, inside
   `pcache1EnforceMaxPage`.
2. **The heapcensus arm is 700,481 B, not 703,632.** `HCTOTAL` reports
   `armCount=137 armSize=5113`, and 137 × 5113 = 700,481. The headline figure
   did not come out of its own parenthetical.
3. **`scr_sqlite_idle_release_all` opens at `scr_sqlite.c:419`**, not 420.
4. **`ZAPO_FAKE_SERVER` must name `packages/fake-server`, not the zapo root.**
   The rig's "or the zapo root that contains packages/fake-server" fallback
   (`memrig.mts`, the `FS_ROOT` block) tests for a `src/` directory — and the
   zapo root **has its own `src/`**, so it is accepted as the package, and
   `ZAPO_ROOT` then derives to `G:\` and the cwd check refuses the run. Costs
   one launch and reads like a cwd mistake.

## 7. Reproduce

Nothing is built. The arms are env only, on the prebuilt binary:

```sh
# from the ZAPO ROOT, with ZAPO_FAKE_SERVER naming packages/fake-server
node --import tsx tests/perf/zapo-rest/harness/memrig.mts <exe> <tag> \
  CHUNKS=8 CONVS=400 MSGS=6 TEXTLEN=300 ROUNDS=1 IDLE_S=60 \
  SETTLE_MS=45000 PRESYNC_MS=20000 [arm knobs]

long      SCR_SQLITE_IDLE_RELEASE_MS=600000 SCR_SQLITE_IDLE_STAT=1
off       (no knobs)
on        SCR_SQLITE_IDLE_RELEASE_MS=1000   SCR_SQLITE_IDLE_STAT=1
half-on   SCR_SQLITE_IDLE_RELEASE_MS=1000   SCR_SQLITE_IDLE_STAT=1 CONVS=200
```

**The rig's `ARM` lines do not record `SCR_SQLITE_*`**, so each arm here
carries a `*.manifest.txt` naming its own knobs. A run whose record cannot
name its lane is a run that cannot be read back.

Evidence: `evidence-idle/<arm>.{heapcen,prof,phases,manifest,sqlidle}`.

## 8. Predictions, as registered

| | prediction | result |
|---|---|---|
| P1 | `on` 4,376: 2792 → ≤10 (point 0) | **HIT** — row absent, exactly 0 |
| P2 | `on` 87,368: 2 → 0 | **MISS → §2** — 2 → 1, one pinned page per slab |
| P3 | busy CRT bytes −≥13,080,880 | **MISS → §2** — −12,992,832, short by the retained slab |
| P4 | `PROFEXACT 4376` unchanged | **MISS → §3** — 2783; inference refuted |
| P5 | ≥1 kept under load, ≥1 released in tail | **HIT → §5** |
| P6 | `half-on` 1423 → ≤10 | **HIT** — row absent |
| P7 | `off` 2792 ± 2, zero `[sqlidle]` | **HIT** |
| P8 | `long` 2792 ± 2, zero `[sqlidle]` | **HIT** |

Five hits, three misses, **two of the misses one cause**.

---

**Gate status: green by construction.** `tests/perf` is outside the gate's
glob, so this document and the evidence beside it are not gated — they were
never at risk of reddening it, and that is a statement about reach, not about
having passed anything.
