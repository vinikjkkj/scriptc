# placement — where a burst's allocations land, and what it costs to move them

The NT heap already returns memory. On a control with identical live data and
identical live bytes it returned **72.09 MiB** when the garbage was contiguous
and **3.39 MiB** when the same garbage was scattered. Nothing about the
allocator needs replacing; what defeats it is where the survivors sit.

**Those two numbers are version-independent and stay.** They come from
`poolsim.c` / `placement.c` -- standalone C against the CRT heap, with no zapo
in the process at all -- so the zapo-arm retirement below does not reach them.
The same is true of `../pagecensus/vmprobe.c`'s platform table and of the
census self-tests. **Every zapo figure in this directory is a different
matter: it was measured on `app/` (1.6.2), which is retired.** See the banner
at the top of `RESULTS.md`.

| file | question |
|---|---|
| `placement.c` | **what a mechanism is worth**, as a curve over the survivor fraction |
| `profdiff.mjs` | **what the burst actually allocates**, per call site, and what survives it |

## `placement.c` — the mechanism, priced

```sh
zig cc -O2 -o placement.exe placement.c -lpsapi
placement.exe <arm> [-pairs N] [-hole N] [-survivor N] [-keep PPM]
```

Four arms, one binary, every arm ending with the **same live population**:
`scattered` (the status quo), `clustered` (survivors first — the upper bound),
`burstheap` (a private heap destroyed wholesale, needing to know at allocation
time which blocks survive), `copyout` (everything in the private heap,
survivors copied out at phase end, no foreknowledge needed).

The measured table is in the file's own header. Three results carry:

* **The survivor fraction is not the term that decides this.** 115 survivors
  in 115,000 blocks — one in a thousand, 0.08 MiB live — already cost 30 MiB,
  and by one in a hundred the damage has saturated. No mechanism that hopes
  survivors are rare can work; the survivors have to be handled.
* **The oracle is worth nothing.** `burstheap` and `copyout` are within
  0.01 MiB at every survivor fraction. A compiler that could tell at an
  allocation site whether a value outlives the phase would buy nothing.
* **Not slower.** Allocation path 50.78 → 49.79 ms, phase end 10.70 → 6.53 ms
  (one `HeapDestroy` replacing 115,000 `free()` calls). Memory columns have
  zero variance across seven reps; the timing columns overlap, so the claim is
  *not slower*, not faster. A cycle-level mode-matched A/B is still owed.

`-pairs`, `-hole`, `-survivor` and `-keep` are parameters precisely so a
measured distribution replaces the stand-ins. Nothing here bakes in a hole
size.

## `profdiff.mjs` — what the burst allocates

```sh
node profdiff.mjs <control.txt> <burst.txt> [--top N]
node profdiff.mjs --selftest        # answers are arithmetic; run this first
```

**The phase split is two runs, not a mid-run dump.** `scr_prof.h` has
`scr_prof_report_to()` for a phase edge, but nothing calls it at one: the
markers that matter (`PRESYNC-BASELINE`, `SYNC-DONE`) are the *rig's*, written
in the parent, and the child has no seam to fire them through. Adding one
would mean a poll inside the allocation hook or a new route in
`zapo-rest.ts`, and both change the thing being measured.

The rig already offers a cleaner split: `CHUNKS=0` delivers no history at all,
so the child pairs, logs in, idles and shuts down having done everything
*except* the burst. The per-site difference between that and `CHUNKS=8` is the
burst's allocation profile, and it needs no new machinery anywhere.

What it costs, stated rather than discovered: the two runs differ in more than
the phase, so small per-site differences are noise; and a site allocating at
the same rate in both runs cancels to zero and drops out.

### The build and the two runs

> **RETIRED RECIPE (1.6.2).** By the user's instruction nothing is to be run on
> the old zapo version -- 1.8.2 only. The entry below is `app/`, which is
> zapo-js 1.6.2, so **do not run this**; it is kept because the readings in
> `RESULTS.md` were taken through it and a reader has to be able to see how.
> To take this measurement on the live arm, swap both `app/` for `app182/` and
> use a separate `-o` directory (see `../zapo-rest/app182/README.md`), and
> `pnpm build` first -- `../zapo-rest/README.md` says why a green gate cannot
> catch a stale `dist`.

```sh
cd <repo>/tests/perf/zapo-rest/app && npm install   # RETIRED -- 1.6.2
cd <repo>
export SCRIPTC_PROF_CFLAGS="-include <repo>/tests/perf/prof/scr_prof.h -DSCR_PROF_ALLOC -DSCR_PROF_LIVE"
node packages/cli/dist/main.js build tests/perf/zapo-rest/app/zapo-rest.ts \
  -o <out>/zapo-rest-prof.exe --provenance-sources

# control: everything but the burst
node --import tsx tests/perf/zapo-rest/harness/memrig.mts <out>/zapo-rest-prof.exe ctl \
  CHUNKS=0 CONVS=400 MSGS=6 TEXTLEN=300 ROUNDS=1 IDLE_S=60 \
  SCR_PROF_OUT=<runroot>/ctl.prof.txt
# burst: the documented workload
node --import tsx tests/perf/zapo-rest/harness/memrig.mts <out>/zapo-rest-prof.exe bst \
  CHUNKS=8 CONVS=400 MSGS=6 TEXTLEN=300 ROUNDS=1 IDLE_S=60 \
  SCR_PROF_OUT=<runroot>/bst.prof.txt

node tests/perf/placement/profdiff.mjs <runroot>/ctl.prof.txt <runroot>/bst.prof.txt
```

**`-DSCR_PROF_LIVE` is not optional.** Without it the dump carries no
`PROFLIVE` rows, and a reader showing `live=0` everywhere would report
"nothing survives the sync" — the most wrong answer this tool could give.
`profdiff.mjs` refuses by name instead.

**REVERSED: use `app182/`, not `app/`.** This section used to argue for `app/`
and the argument was internally sound; it is overridden by the user, who has
instructed that nothing be run on the old version. The reasoning is kept
because it says exactly what the switch costs.

The two arms have *different history-sync architectures*, verified from the
emitted IR: `app182` (zapo-js 1.8.2) contains `streamProtoFields` /
`ProtoStreamReader` and no `downloadHistorySyncBlob`; `app` (1.6.2) contains
`downloadHistorySyncBlob` twelve times and no streaming reader. 1.6.2
downloads the whole blob, inflates it whole, and decodes the entire object
graph at once.

Every settled figure this objective used to rest on — 163.39 → 104.50 MiB, and
the 105.14 MiB the heap census itemised — was taken on `app/`. **Those figures
are retired with the arm**, and because the architectures differ they are not
stale readings of the same program: they cannot be adjusted, only re-measured.
Everything downstream that was derived from them — the ceilings, the
percentages of settled, the delivery A/B in `RESULTS.md` — is superseded and
labelled there. Nothing in this file may be quoted as a current zapo number
unless it names 1.8.2.

## What is already known from reading, before any profiler run

Established from the runtime source and the emitted IR of a prior `app/`
(1.6.2, retired) build; each is a claim a profiler run can confirm or refute.
**Re-derive these against `app182/` before relying on them:** they are readings
of source and IR, so they are cheap to redo, but they are readings of the
*other* program.

* **The decode path is statically typed end to end.** `streamProtoFields`,
  `settleHistorySyncChunk` and `consumeHistorySyncStream` allocate arrays,
  bytes, strings, unions, maps and records. Dyn boxing on that path is four
  *scalar* walkers (`sc_td_0` a string, `sc_td_15/17/737` a number) per
  notification. **There is no record boxing and therefore no `cap × 24`
  entries array on the history-sync path.**
* **The sync-path record types are all arena-carved, not malloc'd.** The
  records `settleHistorySyncChunk` builds are 3–12 fields (24–96 bytes), so
  `scr_cyc_alloc`'s physical size stays under `SCR_POOL_MAX` and they never
  reach the CRT heap.
* **Two raw realloc ladders exist, and both are the right shape for the
  observed holes.** `scr_arr_grow` (`scr_array.c:165`) is `cap × 8` bytes,
  first cap 4, doubling, raw `realloc`. `scr_dyn_obj_put_k` (`scr_json.c:1585`)
  is `cap × 24`, first cap 1, doubling, raw `realloc`, and never shrinks —
  and it is written from about 16,000 emitted call sites across
  `scr_dyn_obj_set` / `_lit` / `_present_lit`. Whether the SYNC reaches it
  is decided by the `CHUNKS=0` control, not by a symbol count — see
  `PREDICTIONS.md`.
* **The string allocator has an uncovered band, and the workload sits in it.**
  `scr_str_alloc` (`scr_string.c:616`) serves a heap string from the pool or
  the string arena only while `scr_pool_bytes(sizeof(ScrStr) + cap + 1) <=
  SCR_POOL_MAX` (256), i.e. `cap <= 243`; `scr_str_release` keeps a **single**
  spare block for `cap >= 512`. **Everything with `cap` between 244 and 511 is
  a raw `malloc`/`free` with no recycling at all**, and the rig's
  `TEXTLEN=300` message bodies are `cap = 300`.

## What page return does not touch

Both files here are about the CRT heap. The cycle arena's own page-level
behaviour is `../pagecensus`, and the ceiling there is bounded at 9.44 MiB —
see that README. Neither touches SQLite's page cache or genuinely live data.
