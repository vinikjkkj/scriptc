# pagecensus — how much of the cycle arena's retained bytes is whole free pages

The cycle arena in `packages/runtime/src/scr_cycle.c` hands a 64 KiB chunk back
to the allocator only when the chunk is **completely empty**, so a single
surviving object keeps all 64 KiB. A chunk is 16 pages and a survivor occupies
one of them. Two files here ask whether the difference can be given back.

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

The instrument is workload-agnostic; the reading that matters is the settled
state of a WhatsApp history sync, which is `tests/perf/zapo-rest` and its rig.

```sh
cd <repo>/tests/perf/zapo-rest/app && npm install
cd <repo> && node packages/cli/dist/main.js build \
  tests/perf/zapo-rest/app/zapo-rest.ts -o <out>/zapo-rest-pc.exe --provenance-sources

# the rig; see harness/memrig.mts for ZAPO_FAKE_SERVER and the launch-cwd rule
node --import tsx tests/perf/zapo-rest/harness/memrig.mts <out>/zapo-rest-pc.exe pc1 \
  CHUNKS=8 CONVS=400 MSGS=6 TEXTLEN=300 ROUNDS=1 IDLE_S=60 \
  SCR_PAGECEN_OUT=<runroot>/pc1.pagecen.txt
```

Those are the dials the arena-reclamation figures were taken on (1,053 → 160
chunks held, 163.39 → 104.50 MiB settled), so a census taken with them is
directly comparable to `[cycstat] arena … held=`.

**The bound this route is working inside, before any reading.** cycstat on that
workload reports 161 chunks held at exit — 10.06 MiB against a 104.50 MiB
settled working set. Every chunk's first page carries the chunk header and can
never be returned, which is another 0.63 MiB off. So the whole route cannot
recover more than **9.44 MiB, 9.0% of settled**, however sparse the chunks turn
out to be; the census says how much of that 9.44 MiB is actually free. Read any
result against that ceiling rather than against the heap.

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
