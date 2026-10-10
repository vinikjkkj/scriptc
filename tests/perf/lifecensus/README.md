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
which chunk any of them is in; `docs/estado-vmwalk.md:745-759` reads four
kinds off it and concludes a `trace`-keyed arena would be a four-way split.
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
`docs/estado-vmwalk.md:735` recorded **115 chunks / 7.19 MiB** for the same
question on an uninstrumented binary, and `:747` recorded **48,537**
`scr_dyn_gcfree` objects live at rest. This census, with the instrument in,
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
