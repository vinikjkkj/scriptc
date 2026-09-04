# Where the zapo messaging bench's peak RSS goes, per store backend

Measured 2026-09-04 against **the real zapo bench** (`messaging.bench.ts` from
a copy of `bench-client5`), full default workload — 1000 contacts x 2 devices,
4 groups x 500 members, 1000 messages/scenario, fake server a separate
node v22.18.0 process. Binaries built from `main` at `4f229429`,
`x86_64-windows-gnu`, `SCRIPTC_CC=zigcc`, `--best-effort
--provenance-sources`. Every ratio below is formed **inside one rep** — arms
run back to back and this host drifts ~10%/rep, which is visible in the raw
medians (the same memory arm reads 22.3 s at 11:59 and 30.2 s at 12:34 in one
session) and cancels in the pairing.

## The question, and the short answer

The bench was moved to the sqlite store to stop holding everything in memory.
Peak RSS was expected to fall a lot. It rose.

**It rose because peak RSS is not made of store data.** The store swap does
what it was supposed to do — it removes **10-12 MiB** of live heap and
**128,000** live allocations from the program — but that is **6%** of a
190 MiB peak, and SQLite's own footprint costs slightly more than it saves.
With the page cache left at its compiled-in default the sqlite lane is
**+1.6%** on peak RSS; with `cache_size` cut to 2 MiB it is **+0.1%**, i.e. a
dead heat. No store setting makes this workload's peak fall substantially,
because 94% of the peak is not the store.

## Peak RSS by store layout (one session, 5 reps, paired)

A/A floor in that session, same binary, 3 reps: **peak 1.0002
[0.9998 .. 1.0022]**. Anything inside ~0.3% is a draw.

| arm | persistent domains | mailbox domains | peak MiB | peak / memory |
|---|---|---|---|---|
| `mem` — **as shipped** | memory | **none** | 190.76 | 1.0000 |
| `mnomail` (control) | memory | none | 191.74 | **1.0000** [0.9922 .. 1.0108] |
| `mall` | memory | memory | 191.93 | 1.0076 [1.0023 .. 1.0121] |
| `snomail` | sqlite | none | 193.52 | 1.0166 [1.0062 .. 1.0229] |
| `sql` — **as shipped** | sqlite | sqlite | 194.89 | 1.0164 [1.0056 .. 1.0403] |

`mnomail` is the positive control: it reaches the same layout the shipped
memory arm reaches, by the probe's own code path, and reads 1.0000. Without
it the other four rows would be uninterpretable.

Read the table as a decomposition of the shipped +1.64%:

* **+1.66%** — moving the eight persistent domains from the memory store to
  SQLite, at *identical* workload (`snomail` vs `mnomail`).
* **-0.02%** — the message/thread/contact archive, in SQLite (`sql` vs
  `snomail`). It is free there: it goes to disk.
* (+0.76% — the same archive in the *memory* store, `mall` vs `mnomail`. The
  shipped memory arm does not pay this because it does not do the work; see
  "Two harness defects" below.)

A second session measured the same five arms on a different binary and
agreed: `sql/mem` peak 1.0197 [1.0075 .. 1.0472], A/A floor 0.9993
[0.9942 .. 1.0027]. The pristine binary, same session, agreed too:
`xsql/xmem` peak 1.0246.

## The peak is set in `send_group`, in every arm

`cpuphase` samples the child's working set and reports per phase. `rssMax`,
MiB, medians over 5 reps:

| arm | buildContacts | buildGroups | send_1to1 | recv_1to1 | **send_group** | recv_group |
|---|---|---|---|---|---|---|
| `mem` | 26.04 | 27.53 | 148.34 | 169.64 | **190.76** | 126.62 |
| `mnomail` | 26.03 | 27.70 | 144.87 | 164.03 | **191.74** | 127.70 |
| `mall` | 26.60 | 28.13 | 143.96 | 160.43 | **191.93** | 128.27 |
| `snomail` | 27.66 | 28.50 | 170.41 | 182.17 | **193.52** | 139.37 |
| `sql` | 27.64 | 28.47 | 172.35 | 186.19 | **194.89** | 140.21 |

`send_group` enters at ~100-111 MiB and climbs ~85 MiB inside the phase. That
transient is 4 groups x 500 members x 1000 messages of sender-key fanout —
client-side crypto and string work with no store in it. Every layout climbs
to the same top. The store can only move the level `send_group` *starts*
from, and it moves it the wrong way: 99.8 MiB (memory) to 111.1 MiB (sqlite).

## Per-site residency at each lane's own live-heap high-water

`tests/perf/prof/scr_prof.h` with `-DSCR_PROF_ALLOC -DSCR_PROF_LIVE`, which
charges every free back to the **allocating** site. Two reps per lane, same
session, same binary. `ptrLost=0` and `freeUnknown=0` in all four runs, so
the pointer table never overflowed and the lane is complete for the sites it
can see.

| mem r1 | mem r2 | sql r1 | sql r2 | site |
|---|---|---|---|---|
| **80.50** | **81.17** | **68.94** | **71.23** | **live heap at high-water, MiB** |
| 802,134 | 802,024 | 673,597 | 673,859 | **live blocks at high-water** |
| 32.88 | 33.20 | 32.53 | 32.45 | `scr_string.c:128` — `scr_str_alloc` |
| 23.69 | 24.38 | 18.19 | 20.25 | `scr_cycle.c:234` — the collector's arena chunk |
| 8.31 | 8.38 | 8.17 | 8.15 | `scr_array.c:172` — array growth `realloc` |
| 2.69 | 2.72 | 0.72 | 0.71 | `scr_bytes.c:52` — `ScrBytes` payload `calloc` |
| 2.22 | 2.24 | 0.33 | 0.33 | `scr_bytes.c:43` — `ScrBytes` header |
| 1.76 | 1.76 | 1.76 | 1.76 | `scr_cycle.c:281` |
| 1.28 | 1.28 | 0.87 | 0.88 | `scr_map.c:164` |
| 1.16 | 1.28 | 1.16 | 1.16 | `scr_async.c:1565` — fiber stacks |
| 0.78 | 0.78 | 1.02 | 0.94 | `scr_json.c:1600` |
| 0.76 | 0.73 | 0.07 | 0.07 | `scr_bytes.c:479` |

Three sites are 81% of the live heap on both lanes, and the top one does not
move at all. What the store swap removes is the **byte** sites —
`scr_bytes.c` falls 5.67 to 1.11 MiB — and part of the cycle arena: Signal
session records, identity keys, sender keys. That is the store's payload, and
it is 10-12 MiB.

The instrument counts `bytes ever allocated` too, and there the sqlite lane
is *larger*: 16.41M allocations / 2054 MB against 13.44M / 1883 MB. It holds
less and churns more — it marshals every row through `ScrDyn` on the way out
of `scr_sqlite.c`. A churn ranking and a residency ranking answer different
questions; this is a residency question.

## Most of the sqlite penalty is SQLite's page cache

`@zapo-js/store-sqlite`'s `connection.ts` sets `journal_mode=WAL`,
`synchronous=normal`, `busy_timeout=5000` and **nothing else** — `cache_size`
is in its allow-list but is never given a value. So the engine runs on the
compiled-in `SQLITE_DEFAULT_CACHE_SIZE=-16000` (a 15.6 MiB budget, set in
`packages/compiler/src/backend/cc.ts` to match better-sqlite3's own build).

Sweeping that one pragma, 4 arms x 5 reps interleaved, A/A floor 1.0031
[1.0027 .. 1.0036]:

| arm | `cache_size` | peak MiB | peak / memory |
|---|---|---|---|
| `mem` | — | 190.74 | 1.0000 |
| `sql2m` | -2000 (2 MiB) | 191.75 | **1.0008** [0.9955 .. 1.0415] |
| `sqldef` | compiled default, -16000 | 194.36 | 1.0131 [1.0091 .. 1.0690] |
| `sql62m` | -64000 (62.5 MiB) | 196.39 | 1.0296 [1.0088 .. 1.0560] |

Monotone in the budget, and `sql62m` is the **positive control**: a knob that
did not reach the engine could not have raised peak RSS by 3.0%. So the
`sql2m` row is a measured effect, not an inert null.

At 2 MiB the sqlite lane is a dead heat with the memory lane — the ~11 MiB of
heap it frees is exactly cancelled by the engine's remaining footprint. It
never goes below.

## A bigger workload makes it worse, not better

The whole database is **5.02 MiB**. It fits inside the page cache with room
to spare, so a disk-backed store has no working set to win back. Running the
same interleaved pair at 4x contacts (4000 x 2 devices = 8000 sessions, just
under the memory session store's 8192 cap — above it the memory arm would
evict and stop being comparable), 3 reps:

| arm | peak MiB | peak / memory | six-phase sum |
|---|---|---|---|
| `mem` | 196.84 | 1.0000 | 62.95 s |
| `snomail` | 203.59 | 1.0348 [1.0040 .. 1.0725] | 70.30 s |
| `sql` | 205.86 | **1.0464** [1.0196 .. 1.0655] | 75.68 s |

The gap **widens** from +1.6% to +4.6%. Scaling the persisted dataset moves
the answer away from the expectation, not toward it, because the data the
store could offload is not what sets the peak — and at 4x the sqlite lane's
peak moves into `recv_1to1` (205.86) while the memory lane's stays in
`send_group` (196.84).

## Two harness defects in the bench's own store factory

Both are in `packages/fake-server/bench-prof/_store-factory.ts` (zapo's tree,
read-only from here) and neither is a scriptc bug.

1. **The two arms do not run the same workload.** `buildMemoryStore` calls
   `createStore({ memory: { limits: ... } })` with **no `providers`**, and
   `createStore` defaults the mailbox domains to `'none'`, which selects
   `NOOP_MESSAGE_STORE` / `NOOP_THREAD_STORE` / `NOOP_CONTACT_STORE`. The
   sqlite arm passes `providers: buildProviders('sqlite')`, which routes them
   to SQLite. Every message body is archived in one arm and discarded in the
   other. Worth +0.76% of peak RSS and a slice of the wall-time gap; the
   comparison should set `providers` on both arms or on neither.
2. **Four of the fifteen `providers` entries are silently ignored.**
   `buildProviders` writes `retry`, `groupMetadata`, `deviceList` and
   `messageSecret` into `providers`, but `createStore` reads cache domains
   from `options.cacheProviders`, which the bench never sets. Those four
   domains run on the in-process memory stores in **both** arms. Harmless to
   this comparison because it is symmetric, but the sqlite arm is not testing
   what its provider table says it is testing.

## What this instrument cannot see, and why

* **SQLite's own heap.** `vendor/sqlite/sqlite3.c` is compiled by
  `ensureSqliteObjects` in `packages/compiler/src/backend/cc.ts`, which does
  **not** append `SCRIPTC_PROF_CFLAGS`, so the residency lane's `-include`
  never reaches the amalgamation. Page cache, WAL frames, prepared statements
  and every `sqlite3_malloc` are invisible to the per-site table. They were
  measured *indirectly* instead, by the `cache_size` sweep above. Closing
  this properly costs one line in `ensureSqliteObjects` plus a prof
  discriminator in its cache `flavor` string — without the second half an
  instrumented `sqlite3.o` would be reused by an ordinary build.
* **The fake server.** `cpuphase` samples the direct child only (no job
  object), so every RSS number here is **client-only**. Store work is
  client-side in this bench, so that is the right half — but any claim about
  total system memory would need `tests/perf/pairphase`.
* **`finalRSS`.** Unusable on this host (9-105 MiB across an identical arm,
  OS working-set trimmer). Peak only.
* **Whole-run wall.** `bench-prof/server-rpc.ts:182` arms a 60 s `setTimeout`
  that is never cleared, so every run reports ~60 s regardless. The six-phase
  sum is the only honest whole-run number.
* **Live heap and peak RSS are different instants.** `liveSnapAt` is the
  live-heap high-water; peak RSS is set in `send_group`. Do not subtract one
  table from the other and call the remainder attributed memory.

## Reproducing

```sh
# one paired block: A/A floor first, then the arms, all in ONE session
PAIR_RUNENV=<block>/runenv.sh PAIR_TMP='G:/blocks/<block>/tmp' \
  sh pair.sh <bench.exe> aa 3 aa1:memory aa2:memory        > run-aa.log 2>&1
PAIR_RUNENV=<block>/runenv.sh PAIR_TMP='G:/blocks/<block>/tmp' \
  sh pair.sh <bench.exe> ab 5 mem:memory sql:sqlite        > run-ab.log 2>&1

node pairparse.mjs run-aa.log      # the floor, per phase and on peak RSS
node pairparse.mjs run-ab.log      # paired ratios, formed inside each rep
node phasers.mjs   run-ab.log      # which PHASE sets the peak, per arm

# residency, both lanes, same session, same binary
SCR_PROF_OUT=...\prof-mem.txt ZAPO_BENCH_STORE=memory <cpuphase> -- <prof.exe>
SCR_PROF_OUT=...\prof-sql.txt ZAPO_BENCH_STORE=sqlite <cpuphase> -- <prof.exe>
node livediff.mjs memory prof-mem.txt sqlite prof-sql.txt
```

The four parsers **throw** rather than print an empty table, and each was
self-tested on a hand-made input with known ratios and negative-controlled on
an input it must reject. An instrument that cannot distinguish "found none"
from "there are none" reports zero and is believed.

The `providers` and `cache_size` arms need a build whose `_store-factory.ts`
reads `ZAPO_BENCH_PROVIDERS` / `ZAPO_BENCH_SQLITE_CACHE`; the shipped bench
has neither, and on a shipped build those arms silently collapse onto the
default layout. `pair.sh` echoes what each arm asked for, and a probe build
echoes what it actually got — compare the two before believing a row.
