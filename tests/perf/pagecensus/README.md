# pagecensus — how much of the cycle arena's retained bytes is whole free pages

The cycle arena in `packages/runtime/src/scr_cycle.c` hands a 64 KiB chunk back
to the allocator only when the chunk is **completely empty**, so a single
surviving object keeps all 64 KiB. A chunk is 16 pages and a survivor occupies
one of them. Two files here ask whether the difference can be given back.

**Read that sentence as being about the CHUNK, not about resident memory.**
Since `14dc170c5` the per-page return below this line is compiled in and ON by
default (`scr_cycle.c:596-598`), so the whole free pages inside a chunk one
survivor keeps are already handed to the OS; what the survivor still pins is
the chunk's 64 KiB of address space and commit charge. The measured
demonstration, on one binary through the env knob, is in the `app182` section.

| file | question |
|---|---|
| `scr_page_census.h` | **how much is there** — the whole free pages inside chunks the arena still holds, and how they are distributed across chunks |
| `vmprobe.c` | **can it be returned, and what does that cost** — the platform half, measured against a null arm |

Neither is compiled into an ordinary build. The census is a header
force-included through `SCRIPTC_PROF_CFLAGS`, exactly as `../cycstat` is; the
probe is a standalone program.

## The census

```sh
# arm a program with it (add ../cycstat too: their two chunk counts are
# independent counters of one number and must agree)
export SCRIPTC_PROF_CFLAGS="-include <repo>/tests/perf/cycstat/scr_cyc_stat.h -DSCR_CYCSTAT_ON \
                            -include <repo>/tests/perf/pagecensus/scr_page_census.h -DSCR_PAGECEN_ON"
node packages/cli/dist/main.js build <program>.ts -o <out>/prog.exe
```

At run time:

* `SCR_PAGECEN_OUT` — file for the report; absent, stderr.
* `SCR_PAGECEN_EVERY=1` — also report after **every** collector sweep, so the
  ceiling has a trajectory and the exit reading is not the only one.

The report prints the free-pages-per-chunk **histogram** and the policy trade
curve it implies — for each threshold `T`, how many chunks have at least `T`
free pages and what those pages are worth. A total says nothing about whether
a policy that only touches sparse chunks would recover most of it.

### What makes a reading readable

The census reports numbers only after it has demonstrated it can be wrong.

* a **synthetic arm** at arm time: three fabricated chunks whose answers are
  arithmetic — every slot free is 15 pages, one survivor on page 3 is 14, and
  every slot live is **zero**. The last is the one that matters: an instrument
  that can only say "yes, there are free pages" cannot adjudicate a ceiling.
* the **walk reconciles** with the arena's own bookkeeping on every chunk of
  every reading: carved slots minus free-list length must equal `used`.
* a chunk with **no live block must contribute exactly 15 pages**, checked
  against the reading's own empty-chunk count — on the real workload, not only
  in a fixture.
* **`NO CHUNKS`** by name when the walk saw none, and **`ARMED`**
  unconditionally, so "never compiled", "arena was off" and "everything came
  back" cannot read alike.

Controls live in `tests/harness/cycle-arena.test.ts`.

### On the zapo-rest workload

The instrument is workload-agnostic -- it walks whatever chunks the arena holds
and knows nothing about the program -- and that much is true on any arm. The
reading that matters is the settled state of a WhatsApp history sync, which is
`tests/perf/zapo-rest` and its rig.

**Build `app182/` (zapo-js 1.8.2).** By the user's instruction nothing is to be
run on the old version, so the `app/` (1.6.2) arm is retired; see the banner in
`tests/perf/zapo-rest/README.md`. Rebuild `dist` first -- the note there says
why a green gate cannot catch a stale one.

```sh
cd <repo>/tests/perf/zapo-rest/app182 && npm install
cd <repo> && pnpm build
cd <repo> && node packages/cli/dist/main.js build \
  tests/perf/zapo-rest/app182/zapo-rest.ts -o <out-182>/zapo-rest-pc.exe --provenance-sources

# the rig; see harness/memrig.mts for ZAPO_FAKE_SERVER and the launch-cwd rule
node --import tsx tests/perf/zapo-rest/harness/memrig.mts <out-182>/zapo-rest-pc.exe pc1 \
  CHUNKS=8 CONVS=400 MSGS=6 TEXTLEN=300 ROUNDS=1 IDLE_S=60 \
  SCR_PAGECEN_OUT=<runroot>/pc1.pagecen.txt
```

Those are the dials the arena-reclamation figures were taken on, so a census
taken with them is directly comparable to `[cycstat] arena … held=`. **The dial
set is the comparability claim, and it carries across arms. The figures do
not.** The numbers this section used to quote (1,053 → 160 chunks held,
163.39 → 104.50 MiB settled) were taken through the `app/` 1.6.2 recipe that
stood here, and the two arms do not share a history-sync architecture --
whole-blob `downloadHistorySyncBlob` against `streamProtoFields`. They are
**retired**: do not quote them as zapo numbers, and re-measure on `app182/`
before this section states any.

**The bound this route is working inside, before any reading.** cycstat on that
workload reported 161 chunks held at exit — 10.06 MiB against a 104.50 MiB
settled working set. Every chunk's first page carries the chunk header and can
never be returned, which is another 0.63 MiB off. So the whole route could not
recover more than **9.44 MiB, 9.0% of settled**, however sparse the chunks
turned out to be; the census says how much of that is actually free.

*(All four of those numbers are the retired 1.6.2 arm, and they go with the
figures above.* **What carries across arms is the SHAPE of the bound, not its
value:** *the ceiling is chunks-held minus one unreturnable header page per
chunk, and it is always a fraction of the settled set rather than of the heap.
Recompute it from a cycstat reading on `app182/` before quoting a ceiling.)*

### The `app182` ceiling, measured 2026-10-10

Recomputed on the dial set above, `b6f4a2a47`, zig 0.16.0,
`x86_64-windows-gnu`, LLVM lane, sqlite store, through
`../zapo-rest/harness/memrig.mts`. The run names its own column:
**`SETTLED 74.08 MiB privateCommit / 83.59 MiB workingSet`**, peak
92.52 / 101.88.

```
cycstat   arena chunks=611 freed=497 held=114 peakheld=276 carved=471696
pagecen   chunks=114  cur=24 part=32 full=58 nolive=3   held=7.12 MiB
          slots carved=97501 free=5053 live=73113 livebytes=4701520
          occupancy 0.6293
          CEILING aligned freepages=564 = 2.20 MiB of 7.12 MiB held (30.9%)
          histogram freepages/chunk: 0:68 1:2 2:1 3:2 6:1 7:1 10:2 11:2
                                     12:1 13:8 14:7 15:19
```

So the bound on `app182`: 114 chunks is **7.13 MiB**, less one unreturnable
header page per chunk (114 pages, 0.45 MiB), leaves **6.68 MiB — 8.0% of the
settled working set**; and of that the census finds **2.20 MiB actually free**.
The trade curve is flat to `T=11`, so a policy that only touched chunks with
at least 11 free pages would still recover 2.04 MiB of the 2.20.

**Chunks held is a draw and the ceiling is nearly not.** Four runs across two
binaries of this tree (the second differing only by whether `../lifecensus`
was `-include`d) gave 113, 114, 114 and 115 chunks held, and free-page
ceilings of 2.20, 2.20, 2.24 and 2.32 MiB. Quote the ceiling as **2.2-2.3 MiB
on this dial set and this host**, not as a single figure.

**PAGE RETURN IS ALREADY COMPILED IN AND ON BY DEFAULT** —
`scr_cycle.c:596-598` sets `SCR_CYC_PAGERETURN` to 1 and `scr_cyc_pr_on()`
falls back to it — so the figures above are taken on an arm that is *already
returning pages*, and the chunk-is-returned-only-when-empty rule
(`scr_cycle.c:544-548`, `:1666`) costs working set only for the pages a live
block sits on. Measured here on ONE binary with the env knob, which is the
comparison that carries no layout confound:

```
                        slots carved   free list   live   carved-free-live
SCR_CYCLE_PAGERETURN=1        97,501       5,053  73,113            19,335
SCR_CYCLE_PAGERETURN=0        96,205      23,092  73,113                 0
```

Those 19,335 slots are the blocks `scr_cyc_pr_sweep_chunk` unthreaded before
discarding their pages; with the knob off, every free block is on a list and
the three columns close exactly. **Live blocks and live bytes are identical in
both arms** (73,113 / 4,701,520), so the arm changes what is returned and not
what is retained. What a lone survivor still pins on the default arm is 64 KiB
of *address space and commit charge*, not 64 KiB of working set:
`SCR_CYC_ARENA_VM_DEFAULT` is 0 (`scr_cycle.c:411-413`), so the verb is
`DiscardVirtualMemory` and only `MEM_DECOMMIT` returns commit — see the probe
table below.

### Who is keeping the other 4.92 MiB — `../lifecensus`

The census above says how much of a held chunk is free. It cannot say who is
keeping the chunk, and therefore cannot adjudicate the obvious next move,
which is to **segregate the arena by lifetime**. `../lifecensus` is that
measurement: every allocation's birth, kind and allocation site, every death's
lifetime on the allocation clock, and — per chunk this walk still holds — the
blocks actually in it. Read its README for the reading; the three results that
bear on this route:

* **The pinning population is not lonely survivors.** 93 of 114 chunks hold
  16 or more live blocks; **6 to 8 hold exactly one** (0.38-0.50 MiB over two
  runs of one binary), and 16 hold eight or fewer (1.00 MiB).
* **Type predicts survival superbly and segregation still loses.**
  `scr_dyn_gcfree` survives at 85.3% against four kinds under 3%, and carries
  66.1% of the survivor bytes for 0.16% of the allocation stream — but routing
  it out empties **9 of the 111 non-empty chunks** while its own arena needs
  54, a net **+55 chunks**. A *perfect* predictor lands at 96 chunks against
  114: a ceiling of **18 chunks = 1.13 MiB**, 1.5% of settled privateCommit.
* **The survivors are a startup cohort, not a type.** 90% of everything alive
  at exit was allocated inside the first 92,182 of 36,368,275 cycle
  allocations.

## The probe

```sh
zig cc -O2 -o vmprobe.exe vmprobe.c -lpsapi
vmprobe.exe 0   # null: touch and measure, no call at all
vmprobe.exe 1   # malloc'd chunks + DiscardVirtualMemory
vmprobe.exe 2   # VirtualAlloc'd chunks + VirtualFree MEM_DECOMMIT
vmprobe.exe 3   # VirtualAlloc'd chunks + DiscardVirtualMemory
```

Working set **and** private commit are both read, because a working set can
fall while the process still holds everything it reserved, and those are two
different claims. The measured table and what it settles are in the file's own
header comment. The short form:

* **a decommitted page does not come back by being touched** — Windows leaves
  it `MEM_RESERVE`, and a touch is an access violation, not a soft fault. The
  addresses stay reserved and no pointer moves, so the idea survives; the
  transparency does not.
* **`DiscardVirtualMemory` is transparent and works on memory this process did
  not reserve**, so the arena can return pages without changing allocator.
* **only `MEM_DECOMMIT` returns the commit charge.** Both return the same
  working set.
* a returned page costs about **78x an ordinary resident touch** to fault back
  in, which is the number any return policy has to be judged against.

## What this route does not touch

Page return acts on the cycle arena's chunks and nothing else. It does nothing
about the CRT heap, SQLite's page cache, the string arena in `scr_string.c`
(which has chunks of the same shape and returns none of them), or genuinely
live data. A result here is a slice of the settled heap bounded by the number
above, and must not be read as a whole-process figure.
