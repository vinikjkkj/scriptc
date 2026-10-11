# lifecensus — does TYPE predict LIFETIME, and are the long-lived dense enough to fill a chunk?

`../pagecensus` asks how much of what the cycle arena still holds is whole
free pages. This asks the question one step behind it: **who is keeping those
chunks, and could they have been put somewhere else?** The obvious fix for a
chunk that one survivor keeps is to SEGREGATE BY LIFETIME — route the
long-lived somewhere the short-lived cannot strand them. That fix is worth
building only if some key the allocator can see predicts survival, and if the
set it selects is dense enough to fill chunks of its own.

| file | question |
|---|---|
| `scr_life_census.h` | **the instrument** — every cycle allocation's birth, kind and site; every death's lifetime; and, per chunk the arena still holds, what is actually in it |
| `analyze.mjs` | **does a key predict** — R² of log2(lifetime) by kind, by site, by the pair; the pinner population; the per-size-class packing bound |
| `segregate.mjs` | **would the split pay** — route groups by measured survival rate and count the chunks the split would hold against the chunks held today |
| `smoke.ts`, `smoke-exit.ts` | the controls; build them with the same `SCRIPTC_PROF_CFLAGS` as any other program |

## The rules this instrument is built to

**A SURVIVOR IS NOT A PINNER.** What keeps 64 KiB is the object that is
*alone* in a chunk. `../cycensus` reports survivors by kind and cannot say
which chunk any of them is in; `docs/estado-vmwalk.md`, §"The idle-floor
front, 2026-10-03" (its `held at rest / ceiling if perfect / delivered` block
and the subsection "The cycle arena is placement, and the survivors are four
kinds"), reads four kinds off it and concludes a `trace`-keyed arena would be a
four-way split.
That is a by-type census over all survivors, and it answers a different
question from the one a split has to pass. This header reports, per chunk
still held, the blocks actually in it.

**THE CLOCK IS THE ALLOCATION ORDINAL, NOT WALL TIME.** A lifetime here is a
difference of two cycle-allocation counts. Wall time on a loaded box is a
draw; a collector-sweep index is too coarse to separate a decile. The mutator
clock is deterministic for a deterministic workload and is unaffected by
another process on the machine — which is the only reason a reading taken
while another block was building can be believed at all.

**THE INSTRUMENT'S OWN FOOTPRINT, AND IT IS NOT ZERO.** No field is added to
`ScrCycHdr` (which `scr_runtime.h:521-599` says has no padding left) and none
to `ScrCycChunk`; no stride moves and no chunk is carved differently. The
hooks are a counter bump, a hash insert and a hash delete. Everything the
header owns is BSS and its size is printed on every reading as `tableBytes`
— **32.81 MiB**, which is not subtracted from anything because no figure here
is an RSS figure.

**It still moves the answer by 2.5%, and the control says so.** Two binaries
were built from this tree, one with the header and one without, and each was
run twice through the same rig:

```
                 chunks held   live blocks   live bytes   free-page ceiling
armed    pc1         114          73,113      4,701,520     564 pg = 2.20 MiB
armed    pc2         114          73,113      4,701,520     574 pg = 2.24 MiB
control  ctl1        113          71,309      4,586,064     564 pg = 2.20 MiB
control  ctl2        115          71,309      4,586,064     593 pg = 2.32 MiB
```

The live set is **bit-exact within a binary across runs and differs between
them**: +1,804 blocks and +115,456 bytes, which is 1,804 x 64 B exactly. So
it is the instrument, not a draw. The visible secondary signal is in the
string intern — `refuse=1190` armed against `refuse=190` control, with 1,002
more misses — so the armed binary interns about a thousand fewer strings and
keeps their objects. Chunks held is a draw of 113..115 in both arms, and the
free-page ceiling sits in 2.20..2.32 MiB across all four runs.

**Every number below is from the armed binary and carries that 2.5%.** None
of the conclusions turn on it: the routing arithmetic is a ratio of chunk
counts, and 2.5% of 73,113 survivors is 2.5% of the 83 chunks the oracle
needs.

**IT REFUSES TO REPORT A SILENT ZERO.** `ARMED` prints unconditionally,
`NO CHUNKS` and `NO DEATHS` print by name, and the exit route is both
`atexit` AND the `_Exit` interposer — these PE images run no `.CRT` teardown
and `process.exit` lowers to `_Exit`, so an `atexit`-only census compiles in
and never runs. `../pagecensus/scr_page_census.h`'s own comment records that
trap costing a whole measurement run.

### What makes a reading readable

* **Two independent walks of one chunk list.** The census rides
  `scr_cyc_ar_all`, the list `../pagecensus` already links, but recomputes the
  live bitmap itself. On the zapo reading below both walks reported
  `chunks=114 live=73113 liveBytes=4701520` — the same three numbers from two
  separate traversals.
* **Every live block must join.** A live slot whose birth the census never
  recorded is printed as `UNJOINED` and counted in `missed`. On the real
  workload `missed=0`.
* **Reconciliation against the chunk's own bookkeeping**: carved slots minus
  free-list length minus returned-page slots must equal `used`. `badUsed=0`.
* **A positive control whose answer is arithmetic.** `smoke-exit.ts` keeps
  800 of 400,000 objects and leaves through `process.exit`. The census must
  find exactly 800 pinners, attribute all 800 to `keep()` and none to
  `churn()`, and find the one `held` array **alone in its chunk** with a
  64 KiB share. It does. `smoke.ts` is the same program leaving by return:
  the runtime tears its globals down first, so that arm must report **zero**
  live and it does — an instrument that reports pinners there has not
  measured a settled arena.
* **A second run of each binary, not one.** `sole` — chunks kept by exactly
  one object — came out 8 on `pc1` and 6 on `pc2`: that row is a draw of
  0.38..0.50 MiB and is quoted as one. `93 chunks hold 16 or more` is 93 in
  both.
* **The chunk reconstruction in `segregate.mjs` is checked, not assumed.**
  It regroups the block dump into chunks by address, then requires every
  group's size to equal the `nlive` each of its own lines carries, and the
  group count to equal the walk's chunk count less its empty ones: 111 groups,
  0 disagreements, 114 − 111 = 3 = the page census's `nolive=3`.

## Arming

```sh
export SCRIPTC_PROF_CFLAGS="\
 -include <repo>/tests/perf/cycstat/scr_cyc_stat.h    -DSCR_CYCSTAT_ON \
 -include <repo>/tests/perf/pagecensus/scr_page_census.h -DSCR_PAGECEN_ON \
 -include <repo>/tests/perf/lifecensus/scr_life_census.h -DSCR_LIFECEN_ON"
node packages/cli/dist/main.js build <prog>.ts -o <out>/prog.exe
```

The four hook lines live in `scr_cycle.c` under `#ifdef SCR_LIFECEN_ON`,
exactly as `../pagecensus`'s do, so a build without the header carries no
trace of them.

`scr_life_census.h` must be `-include`d **last**: the `_Exit` interposer is a
macro chain spelled by explicit knowledge of the other reporters, and a header
read first wins and silently drops theirs. It `#error`s on the wrong order
rather than trusting the comment.

* `SCR_LIFECEN_OUT` — the report; absent, stderr.
* `SCR_LIFECEN_BLOCKS=1` — also write `<out>.blocks`, one line per live block
  in every held chunk. That file *is* the pinner population; every summary
  below is derived from it.

## The reading, zapo-rest `app182`, 2026-10-10

Dials are `../pagecensus`'s: `CHUNKS=8 CONVS=400 MSGS=6 TEXTLEN=300 ROUNDS=1
IDLE_S=60` through `../zapo-rest/harness/memrig.mts`, sqlite store, exit at
the end of the 60 s idle. Built at `b6f4a2a47`, zig 0.16.0,
`x86_64-windows-gnu`, LLVM lane. **One program and one run: app182 is one
column.** The run's own memory, naming its column:
`PEAK 92.52 MiB privateCommit / 101.88 MiB workingSet`, **`SETTLED 74.08 MiB
privateCommit / 83.59 MiB workingSet`**.

```
arena, at exit      114 chunks = 7.13 MiB of chunk address space
                     73,113 live blocks = 4,701,520 B = 62.9% occupancy
                     36,368,275 cycle allocations, 36,295,139 deaths
```

`cycstat` on the same run: `arena chunks=611 freed=497 held=114 peakheld=276`.

> **LANE — checked 2026-10-11 and CLEARED, recorded so it is not re-opened.**
> This section names no coroutine lane and sets no `SCRIPTC_STACKLESS`, which
> since the default flip at `8f4100d7a` (2026-10-09) is enough to make a
> measurement a candidate: a build taken from a tree whose `dist/` predates
> the lane gets FIBER while the shipping default is STACKLESS, with nothing
> in the command to say so (`heapcensus/evidence-postfix/LANE.txt`). **It
> does not bite here, and the proof is free and already committed.** The
> `cycstat` line above reads `held=114 peakheld=276`;
> `heapcensus/evidence-peak/abba1A.cycstat.txt` — a binary whose
> `ll-bytes 242844763` makes it STACKLESS by the discriminator
> `pagecensus/evidence-fr2/manifest.txt` declares — reads
> `arena chunks=612 freed=498 held=114 peakheld=274`; and the pre-flip FIBER
> reading quoted in the next sentence is **115 chunks**. Three readings,
> two lanes, 114 / 114 / 115. **The cycle arena's chunk accounting on this
> workload does not separate the lanes**, so this file's verdict does not
> depend on which lane built its binary. This clearance covers the cycle
> arena only; any figure here in process memory terms — the
> `PEAK 92.52 MiB` / `SETTLED 74.08 MiB` line above — is NOT covered, because
> the lane moves peak private commit by 6.90x–9.39x
> (`docs/estado-vmwalk.md`, §7, its 2026-10-11 banner).

`docs/estado-vmwalk.md`, §"The idle-floor front, 2026-10-03", recorded
**115 chunks / 7.19 MiB** for the same question on an uninstrumented binary
(the `cycle arena  115 chunks  7.19 MiB` row), and the same section's
`scr_dyn_gcfree  3,106,368  64.96%  48,537 objects` row recorded **48,537**
objects live at rest. *(Those two were cited as `:735` and `:747` until
2026-10-10; both line numbers had already drifted — to 753 and 765 — because
edits above them lengthened the file. Pointers here carry section and quoted
phrase for that reason.)* This census, with the instrument in,
reads 114 chunks and **48,537** `scr_dyn_gcfree` pinners. The agreement is
the external control on the instrument's footprint.

### P1 — the pinning population is NOT a handful of lonely survivors

```
live objects    chunks   share
  in a chunk
      0            3      2.6%     the per-class current chunks
      1            8      7.0%
      2            3      2.6%
      3..14        6      5.3%
     16+          93     81.6%     holding 73,044 of the 73,113
```

Eight chunks are kept by exactly one object — **0.50 MiB of the 7.13 MiB**,
7%; the second run of the same binary said six, so read that row as 6..8
chunks, 0.38..0.50 MiB. Sixteen chunks hold eight or fewer, 42 objects
between them, and emptying every one of those would recover **1.00 MiB**. The
64 KiB-per-survivor story is real and it is under a tenth of the arena.

### Does type predict lifetime? Only a third of it — and site adds 0.3%

Over all 36,295,139 deaths, with L = log2(lifetime in allocations):

```
key            groups          R²     omega²
KIND              218      0.3050     0.3050
SITE              398      0.3082     0.3082
KIND x SITE       398      0.3082     0.3082
```

**Site is a strict refinement of kind** — the pair table has exactly as many
rows as the site table, because every allocation site passes one `free_fn` —
so the pair key cannot add anything and does not. Site beats type by
**0.0032 of the variance**. Seventy per cent of the spread in lifetime lives
*inside* a single allocation site.

### But survival is a different question, and type predicts THAT very well

```
kind                 allocated    survive    survival%   pinners
scr_dyn_gcfree          56,924     48,537      85.27%     48,537
scr_closure_gcfree     351,174      9,313       2.65%      9,313
scr_box_gcfree         410,113      7,567       1.85%      7,567
scr_union_gcfree     1,262,832      7,062       0.56%      7,062
scr_arr_gc_free        172,301         49       0.03%         49
```

One kind at 85% survival against four at under 3% is a near-perfect
discriminator, and routing it alone captures **66.1% of all survivor bytes (3,106,368 of
4,701,520) while touching 56,924 of 36,295,139 allocations — 0.16% of the
stream**.
By allocation site the top rows are sharper still — `scr_dyn_new_num+0x6d`
92.2%, `scr_dyn_new_func_src+0x79` 94.4%, `scr_dyn_fn_prototype+0x12b` 100%.

### And it still does not pay, because the survivors are MIXED

Routing `scr_dyn_gcfree` to its own arena empties **9 of the 111 non-empty
chunks**. The other 102 keep at least one survivor of some other kind, so
they stay — and the new arena needs 54 chunks of its own.

```
route                       chunksB  chunks freed  A keeps  total  vs 114 held
scr_dyn_gcfree (66.3% cum.)      54             9      102    169        +55
everything (the ORACLE)          83           111        0     96        -18
```

The **oracle** — a perfect per-object predictor no key can reach — packs all
73,113 survivors into 83 chunks (the 64-byte class alone takes 71 of them at
**99.5% fill**) and leaves 13 current chunks on the short-lived side, which a
class never releases (`scr_cycle.c:1666`, `:518-521`). That is **96 chunks against 114:
a ceiling of 18 chunks = 1.13 MiB, 1.5% of the run's 74.08 MiB settled
privateCommit.** Pure compaction without a second arena is 83 against 114,
**31 chunks = 1.94 MiB** — and `../placement/SEGREGATION.md` §2 says this
runtime cannot move an object, so that one is not available either.

So the long-lived set **is** dense enough — for the one class that matters.
Twelve of the thirteen size classes hold 1,051 survivors and 89,552 bytes
between them and would occupy twelve chunks at **11.4% fill**, which is
exactly as sparse as what they replace.

### Lifetime is bimodal, but the cut is AGE, not type

Of 36,295,139 deaths, **97.1% have a lifetime below 2^12 allocations**, and
52.6% sit in the two buckets 2^10 and 2^11. Above 2^12 there are 1,040,858
deaths, and 73,136 objects never die. So a *perfect lifetime oracle* with a
threshold at 2^12 routes 1,113,994 objects to the long-lived arena of which
**73,136 — 6.6% — actually survive**: the other 93.4% would churn in B and
fragment it the same way.

The sharp cut is elsewhere. The pinners' ages, censored at exit:

```
n=73,113   p10=36,276,093   p50=36,330,996   p90=36,360,660   max=36,368,274
```

Against a clock of 36,368,275, that says **90% of everything still alive was
allocated inside the first 92,182 allocations — the first 0.25% of the run**,
and half of it inside the first 37,279. The retained set is a startup cohort,
not a type. A boot arena keyed on "allocated before ordinal N" would select
it with no predictor at all — and is still bounded by the same 18 chunks.

### What is not named, and why it does not reach the answer

On the LLVM lane the emitted TU carries **no PDB module stream** —
`llvm-pdbutil dump --symbols --modi=79` answers `Module stream not present`
for `zapo-rest.obj` — so per-shape `gcFree`s and emitted allocation sites
cannot be symbolised. `../pdb-symbols.mjs`'s header says static functions in
the emitted TU *are* named with code sizes; that was true of a C-lane binary
and is not true of this one. **63,215 of the 73,113 pinners (86.5%), holding
4,046,544 of the 4,701,520 live bytes (86.1%), are runtime kinds** and are all
named, so the gap costs the narrative the name of one hot emitted shape —
the one carrying 33,051,898 of the 36,295,139 deaths and essentially none of
the survivors — and costs the answer nothing.

`analyze.mjs` joins the block dump's hash-table slot indices back to the named
rows on the pair (pinner count, pinner byte sum); 171 of 197 kind slots and
310 of 349 site slots collide on that pair and are **left unlabelled rather
than guessed at**, which is why the routing tables carry `slotNNNN` rows. The
simulation itself never needs the name: it runs on the blocks.

## phase — is the startup cohort separable as a POLICY?  No.

`segregate.mjs` scored KIND and SITE and both lost to MIXING. The section
above reads a **startup cohort** off the pinners' ages and says a boot arena
"would select it with no predictor at all". `phase.mjs` tests that policy.
The answer is **no**, and the reason is the opposite of the one worth fearing.

**THE READING ABOVE IS CENSORED, AND THAT IS THE FIRST THING TO FIX.**
`n=73,113 p10=36,276,093 …` is a distribution over **survivors** — given that
an object is alive, where was it born. A policy needs the other conditional:
**given a birth window, what fraction of it is alive.** A window that
allocates a million objects and keeps 65,000 would strand a boot arena exactly
the way the type key strands the mixed one, and nothing above distinguishes
the two cases.

**THE DENOMINATOR IS FREE, WHICH IS WHY THIS NEEDED NO SECOND RUN.**
`scr_life_seq` is bumped once per cycle allocation and the `birth` stamped on
a block *is* that ordinal, so the number of objects born in `[a,b]` is exactly
`b-a+1`. The census's own accounting proves the clock is dense and
`phase.mjs` refuses on it: **`deaths + live == seq`**, `36,295,139 + 73,136 =
36,368,275`, exact. Every number below is a re-reading of the `pc1`,
`pc2` and `pr0` block dumps already on disk — no rebuild, no new run, no
RSS figure, nothing a loaded host can move.

### 1. The survival rate of the startup window — 98%, not a censored illusion

```
window (lo,hi]        born    survived   SURVIVAL%
(0,100]                100           5      5.000%
(100,1000]             900         848     94.222%
(1000,5000]           4000        3902     97.550%
(5000,10000]          5000        4903     98.060%
(10000,20000]        10000        9862     98.620%
(20000,30000]        10000        9854     98.540%
(30000,40000]        10000        9869     98.690%
(40000,50000]        10000        9839     98.390%
(50000,60000]        10000        7574     75.740%
(60000,70000]        10000        6659     66.590%
(70000,80000]        10000         708      7.080%
(80000,90000]        10000         135      1.350%
(90000,100000]       10000        2394     23.940%
(100000,120000]      20000        3843     19.215%
(120000,150000]      30000         551      1.837%
(150000,200000]      50000        1988      3.976%
(200000,500000]     300000           0      0.000%
(500000,1000000]    500000           0      0.000%
(1000000,10000000]  9e6            139      0.002%
(10000000,end]      26.4e6          40      0.000%
```

**Of everything the program allocates between ordinals 1,000 and 50,000,
98.2% is still alive at exit.** The cohort is not an artifact of censoring:
it is nearly pure. Every rate here is a **floor** — the 23 survivors that pin
no held chunk are in each denominator and in no numerator.

### 2. There IS a boundary, and it is a cliff, not a percentile

Survival sits at 98% through ordinal 55,000, falls through 53%/61%/72% in the
next three 5,000-wide buckets, and is **under 10% from 70,000 on**. After
ordinal 200,000 — 0.55% of the run — the whole remaining **36,168,275
allocations retain 179 objects**, 4.95e-4%. Past 10,000,000 it is 40.
The last survivor is born at ordinal 36,368,268, eight allocations from the
end.

Chunks are temporally coherent to match: the span of birth ordinals *inside
one chunk* is `p50=2,123` and `p70=6,345` of a 36.4-million-allocation run.
A chunk is, in practice, already a phase.

### 3. And the policy still loses, at every cut where its own bound is tight

`phase.mjs` runs `segregate.mjs`'s frame unchanged, so the rows compare
directly. `chunksB` packs B perfectly per class (a **lower** bound, as there);
`noRecyc` is the other end — the window with no slot ever reused. The gap
between them is governed by the window's purity, which is the point.

```
cut N      B surv  purity%  chunksB  noRecyc  freed  Aleft  curA  total  vsHELD
   10000     9658    96.58       16       16      7    104    13    133     +19
   30000    29374    97.91       35       36     25     86    13    134     +20
   50000    49082    98.16       55       55     45     66    13    134     +20
   70000    63315    90.45       73       77     65     46    13    132     +18
   92182    65802    71.38       75       93     72     39    13    127     +13
  120000    70395    58.66       80      112     80     31    13    124     +10
  200000    72934    36.47       83      167     95     16    13    112      -2
 1000000    72934     7.29       83      700     95     16    13    112      -2
10000000    73073     0.73       83     6704     99     12    13    108      -6
 ORACLE     73113       —        83        —    111      0    13     96     -18
```

**Against the ceiling of 18 chunks = 1.13 MiB = 1.5% of the run's 74.08 MiB
settled privateCommit.** No row beats the oracle; `phase.mjs` refuses if one
does.

Read the two halves of that table against each other and the answer is one
sentence. **Where the cohort is pure the policy costs chunks, and where the
policy shows a saving the cohort is not pure.** At `N=50,000` the window is
98.2% survivors, so `chunksB` and `noRecyc` agree at **55** — the figure is
real, not optimistic — and the boot arena must carve 55 chunks to empty
**45**. Net +20 against what is held today. The only rows with a minus sign
are at `N>=200,000`, where the window is **64% garbage**, `chunksB=83` is a
fantasy its own upper bound puts at 167, and the honest reading of `-2` is
"between -2 and +72".

The blocker is `Aleft`, not recall. At `N=200,000` the key has **99.76%
recall** and still saves 2 chunks, because 16 chunks are kept by **179
objects born in the steady state** — 13,664 bytes holding 1.00 MiB of chunk.
Twelve chunks are kept by **40 objects** born after ordinal 10,000,000. No
birth-time key reaches them; they *are* the late phase.

### The controls

* **`deaths + live == seq`**, exact, or the file refuses: the dense clock is
  the denominator of everything above.
* **The null arm.** `smoke.ts` returns normally, the runtime tears its globals
  down, the block dump is empty — `phase.mjs` prints `NULL ARM` by name rather
  than a table of zeros.
* **The positive arm, whose answer is arithmetic.** `smoke-exit.ts` keeps one
  object per 500 and leaves through `_Exit`. `phase.mjs` reads its survival
  rate as **0.200% in every single bucket**, finds no knee, reports a
  per-chunk birth span of 800,598 of 801,601 — total mixing — and shows the
  phase key freeing 1 chunk at every startup cut. An instrument that reported
  a cohort there would be reading noise; this one reports the construction.
* **A permutation null for `freed`.** Routing 99.8% of survivors frees most
  chunks whatever the key is, so `freed` alone proves nothing. Holding `|B|`
  fixed and choosing B uniformly at random, 200 trials:

  ```
  cut N        |B|   freed(phase)   freed(random, mean)   freed(random, max)
     50000   49082             45                  7.44                   11
     92182   65802             72                 13.88                   19
    200000   72934             95                 41.58                   50
  ```

  The phase key is doing real work. It is not enough.
* **Three runs, and the cohort is bit-identical across them.** `pc1`, `pc2`
  and `pr0` give the same B at every cut below 200,000 — 9,658 / 29,374 /
  49,082 / 63,315 / 65,802 / 70,395 / 72,934 — to the object. The verdict row
  is `-2 / -4 / -4` chunks: read it as a draw of **2..4 chunks of the 18**.

### What this does NOT measure, and it is the one assumption in the file

The block dump holds **survivors**. It cannot say how many chunks a boot
arena would carve to serve the window's **churn**, so `noRecyc` charges the
window's dead the run's mean physical size and splits them across classes in
the survivors' own byte proportions. **That split is an assumption** — the
census carries no per-class birth-windowed byte count, and taking one needs a
re-instrumented run. It does not reach the answer: the cuts that decide it
(`N<=70,000`) are 90-98% pure, where `chunksB` and `noRecyc` differ by 0 to 4
chunks and the assumption has almost nothing to weigh.

### A correction to the reading above

**The three armed runs are not replicates.** `pc1` ran 36,368,275 cycle
allocations; `pc2` and `pr0` ran **47,032,105 and 47,032,280** — 29% more —
and both controls (`ctl1`, `ctl2`) match `pc1`, not them (`listgive` 36.23M
against 46.90M). The visible difference in the client log is the sqlite
store's `write-behind pressure` line, 3,960 times on `pc1` against 7,728 on
`pr0`: **the allocation stream of app182 is load-dependent and varies by 29%
between runs on this host.** The `+1,804 blocks` instrument footprint above
is unaffected — it rests on `pc1` against `ctl1`/`ctl2`, which are the same
stream — but the sentence "the live set is bit-exact within a binary across
runs" is true of the **live set** and not of the **stream**, and the two runs
it cites differ by a third of the program. That the settled live set survives
a 29% longer stream unchanged is a stronger result than the one claimed, and
it is the reason the cohort replicates here.

### The verdict

The startup cohort is **real, pure and sharply bounded** — every adjective
the reading above gives it — and it is **not separable as a policy**. A boot
arena cannot pack the early survivors into fewer chunks than the chunks their
departure empties, because the chunks they leave behind are pinned by later
survivors anyway.

The oracle's own 18 decomposes, measured per class rather than reasoned at:
111 chunks pack to 83, of which **18 is the twelve sparse classes** (30 chunks
to 12) and **10 is the 64-byte class** (81 to 71); the split then gives 10 back
because three empty chunks become thirteen current ones. A birth-time key buys
that packing only for the part of each class born inside its window, and at
every window pure enough for the packing to be real it empties fewer chunks
than it carves.

**That closes the last open key on this front.** Type loses to mixing, site
is a strict refinement of type, phase loses to `Aleft`, and the per-object
oracle that bounds all three is 1.5% of a heap that is 10.9% of peak private
commit (`docs/estado-vmwalk.md:67`). There is no allocator key left to test.

> **The last clause of that sentence is wrong twice. The conclusion survives
> anyway, but on a different leg. Tagged 2026-10-10; the sentence is kept
> verbatim because it is what was quoted onward.**
>
> **(1) The denominator is pre-fix.** The 10.9% is the heap's share of an
> **855.41 MiB** peak measured before commit `be758dfa6` (2026-10-02) shipped
> `SCR_FIBER_COMMIT` 16 KiB -> 4096 and `SCR_FIBER_RESERVE` 0 -> 1 MiB. The
> citation here was written at 17:02 that day and the superseding note in
> `estado-vmwalk` landed at 19:31, so this was never punctured by it — and
> nobody came back. The shipped peak is **538.51 MiB** (`estado-vmwalk` §7,
> "What the two levers are worth, MEASURED on the real workload", the `both`
> row of the high-mode table). **The levers moved the fiber-stack and
> page-table terms and did not touch the heap, so the heap's SHARE grew while
> its BYTES did not:** §3's measured 93.13 MiB PRIVATE class against 538.51 is
> **17.3%**, and §7's residual — 538.51 minus ~389.1 MiB of stacks (16,830
> B/stack x 24,241-24,246) minus 48.68 MiB of page tables minus §3's 0.87 MiB
> IMAGE/MAPPED — is 99.9 MiB, **18.5%**. §7 reports no PRIVATE-class walk, so
> **17.3-18.5% is a bracket, not a measurement.** Do not quote a point value.
>
> **(2) The 1.5% was never a fraction of a heap.** This file's own figure is
> "1.13 MiB = 1.5% of the run's 74.08 MiB settled privateCommit" (under "And it
> still does not pay, because the survivors are MIXED", and again under "3. And
> the policy still loses, at every cut where its own bound is tight") — the
> WHOLE process at rest, a different instant and a different run from
> `estado-vmwalk`'s peak. Chaining 1.5% through 10.9% as though both
> denominators named the same heap was never valid, before the levers or after.
>
> **Why "no allocator key left to test" still holds.** What bounds the keys is
> the oracle's ABSOLUTE ceiling of **1.13 MiB / 18 chunks**, and no lever in
> `estado-vmwalk` touches the cycle arena, so that ceiling is unchanged. As a
> share of peak it went 1.13/855.41 = 0.13% -> 1.13/538.51 = **0.21%** — it got
> relatively larger and is still far from worth a key. **What is weakened is
> only the amplifier.** "The heap is a small part of the peak" is no longer
> true at ~18%, so the verdict must now rest on the 1.13 MiB ceiling alone —
> which is where it always actually rested. A reader who wants to reopen the
> heap has a better reason than before; they still have no better KEY.
