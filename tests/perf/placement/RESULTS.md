# RESULTS — the two-run difference, 2026-09-09

`app/` (zapo-js 1.6.2), `--provenance-sources`, `-DSCR_PROF_ALLOC
-DSCR_PROF_LIVE`. One binary, two runs through `memrig.mts`: `CHUNKS=0`
(control) and `CHUNKS=8` (burst), both `CONVS=400 MSGS=6 TEXTLEN=300 ROUNDS=1
IDLE_S=60`, both clean-exit 0, `events-captured n=0` and `n=8`.

Raw: `profdiff.mjs run/ctl.prof.txt run/bst.prof.txt`.

## The noise floor is not a problem

I flagged in advance that the control still pairs, logs in and idles, so the
difference might be dominated by startup churn. It is not:

| | control | burst | ratio |
|---|---|---|---|
| bytes | 23.87 MiB | 1,745.57 MiB | **73.1×** |
| alloc calls | 214,950 | 4,871,991 | **22.7×** |

61 sites moved; the top eleven carry 1,700 of the 1,721.70 MiB.

## What the burst allocates

| allocMiB | liveMiB | live% | count | meanB | site |
|---|---|---|---|---|---|
| **1285.01** | 0.01 | 0.00 | 1,350,463 | 998 | `scr_array.c:172` `realloc(a->data, cap * 8)` |
| 89.71 | 0.00 | 0.00 | 301,903 | 312 | `scr_string.c:634` `malloc(r)` — the uncovered band |
| 72.00 | 0.00 | 0.00 | 1,179,723 | **64** | `scr_array.c:179` `malloc(sizeof(ScrArr))` |
| 68.81 | 3.13 | 4.54 | 1,101 | 65536 | `scr_cycle.c:592` cycle-arena chunk |
| 59.41 | **10.52** | 17.70 | 11,737 | 5,308 | `sqlite3.c:28035` page cache |
| 30.14 | 0.01 | 0.03 | 41,616 | 759 | `scr_cycle.c:755` `calloc(1, phys)` |
| 20.91 | 0.00 | 0.00 | 1,079,760 | 20 | `scr_lib.c:4279` utf16→utf8 |
| 20.24 | 0.13 | 0.66 | 241,519 | 88 | `scr_json.c:1636` **entries array realloc** |
| 20.17 | 0.00 | 0.00 | 24 | **881,193** | `scr_zlib.c:152` the decompressed blob |
| 19.72 | 0.00 | 0.00 | 136,055 | 152 | `scr_async.c:2091` |
| 14.58 | 0.36 | 2.47 | 969 | 15,782 | `scr_bytes.c:52` payload `calloc` |
| 3.19 | **3.19** | **100.00** | 51 | 65536 | `scr_string.c:595` string-arena chunk |
| 1.06 | 1.06 | 100.00 | 85,798 | 13 | `scr_json.c:94` key pool |

## Verdicts against the registered predictions

### 328 B / 19,200 — REFUTED, on the criteria registered before the run

The site is real and hot: `scr_string.c:634` is the uncovered band's
`malloc(r)`, it fires **301,903** times during the burst for 89.71 MiB, and it
is all but absent from the control (**29 → 301,932** raw). The band being
uncovered and heavily used is confirmed.

The **prediction** is refuted. I registered "a mode at 328 B with population
near 19,200 per round" and "a population off by more than 2× with no
coalescing account refutes it". The count is **15.7×** the prediction and the
**mean is 312 B, not 328**. The 19,200 message bodies I named would be roughly
6 MiB of the 89.71 MiB — about 7% of that site's traffic. The band is right;
the member of it I named is not what drives it.

Refused rescue, as registered in advance: 1328 does not save this and neither
does coalescing.

### The magnitude of my lead was wrong

The string band is **5.2%** of what the burst allocates. **`scr_array.c:172`
is 74.6%** — 1.28 GiB through one `realloc(a->data, cap * 8)`, 1,350,463
times, mean 998 B, and 0.00% of it survives. With 1,179,723 arrays created
(`scr_array.c:179`), that is about 1.15 reallocs per array and a typical
capacity near 125 elements. **The array data buffer is the story; the string
band is a footnote to it.**

### The entries ladder IS on the sync path — my exclusion refuted by measurement

`scr_json.c:1636` is the `cap × 24` doubling `realloc`. Control 25,665 →
burst 267,184: a **delta of 241,519 reallocs and 20.24 MiB** during the sync.
So `3 × 2ⁿ` holes during the burst are real, not merely ambiguous. This
confirms the correction by measurement rather than by symbol count.

### The blob, settled

`scr_zlib.c:152`, 24 reallocs, mean 881,193 B: the decompressed history-sync
chunk is about **0.84 MiB**, and the whole burst moves 20.17 MiB through that
buffer. Closes the open item; no log line was needed.

### The ≤64 B busy population has a strong candidate

`scr_array.c:179` mints **1,179,723** `ScrArr` headers at exactly **64 B**
during the burst — the right size class and the right order of magnitude for
the census's 161,408 busy blocks at ≤64 B.

## The survivor fraction: 1.22%

**21.00 MiB live at the dump out of 1,721.70 MiB allocated.** The burst
allocates 1.7 GiB and keeps 21 MiB — so the retention is not unfreed burst
allocations, it is the holes they left, exactly as the heap census said from
the other end.

Concentrated in four places: the SQLite page cache (10.52 MiB, 17.70% of its
own allocation), the string arena's chunks (3.19 MiB, **100%** — that arena
returns nothing), the cycle arena's chunks (3.13 MiB), and the JSON key pool
(1.06 MiB, 100%).

**1.22% is twelve times the ~0.1% at which `placement.c` shows the damage
saturating.** So a per-phase region is reachable only if it handles
survivors — precondition 2 of `REGION-DESIGN.md`, now measured on the real
workload rather than assumed.

## What this run cannot say

* **Not a size histogram.** `PROF` gives count and total bytes per site, so
  `meanB` is a mean. It cannot adjudicate 328 vs 1328, and a site mixing sizes
  sits between classes. The census block's exact-`cbData` histogram is still
  what settles the hole distribution.
* **Sites are C source lines, not TS call sites.** The dump carries a
  call-site RVA (`rva2`) that was not resolved here, so "which TypeScript
  allocates the 1.28 GiB of array buffers" is not answered.
* **The peak RSS in these dumps is instrumented.** `profTableBytes` is 53 MiB
  and burst `peakRSSbytes` is 264.5 MiB against the control's 82.4 MiB. These
  must not be compared with the 105.14 MiB clean settled figure.
* **One run per arm.** Allocation counts are load-independent and the ratio is
  73×, so the attribution is safe; nothing here is a timing claim.

## Addendum — the array target, read after the run

### Symbol resolution: the route works, but there is nothing to resolve

`llvm-pdbutil` **is** installed in this host's WSL Arch image at
`/usr/sbin/llvm-pdbutil`, and `scr_prof_base()` is `GetModuleHandleW(NULL)`,
so the dump's RVAs are true image-relative and `pdb-symbols.mjs` would map
them. That wall is not ours.

**But the allocation lane records no call site.** `rva2` is **0 on all 208
PROF rows**; `key2` is only ever filled by `scr_prof_row2` under
`SCR_PROF_EDGES`, which instruments `__cyg_profile_func_enter/exit` — the CPU
lane, not the malloc interposer. So "which TypeScript allocates the 1.28 GiB"
needs the alloc hook to capture `__builtin_return_address(0)` and a rebuild.
It is an instrument change, not a symbolisation problem.

### The growth shape: true by count, false by bytes

Static, from the 1.6.2 artifact — 4,738 `scr_arr_new` / `scr_arr_new_ref` call
sites:

| initial_cap | sites |
|---|---|
| **1** | **3,147** |
| 0 | 254 |
| 2 | 110 |
| 3 | 37 |
| 4 | 22 |
| 5..256 | 22 |
| non-constant | 9 |

`scr_arr_grow` floors at 4, so `initial_cap = 1` means **cap 4, a 32-byte
buffer**, in one realloc.

Dynamic: 1,350,463 grows over 1,179,723 arrays. If ~1.18M of those grows are
the initial 32-byte sizing, that is 37.7 MiB — leaving **~170,740 grows
carrying ~1,247 MiB, a mean near 7.7 KB**.

> **By COUNT the arrays are one-shot: ~87% of grows are the initial cap-4
> sizing. By BYTES they are not: ~97% of the 1.28 GiB is repeated doubling on
> the minority of arrays that are pushed into.**

Both halves matter and they point at different fixes. A presize helps only if
the FINAL size of a push-built array is knowable, and the compiler currently
emits `initial_cap = 1` at two thirds of its call sites. Nothing should be
proposed until the size distribution of that 170,740 is known, and this dump
cannot give it — `PROF` carries count and total bytes per site and no
histogram.

### Retraction: the 64 B headers are not the census's ≤64 B busy population

`scr_array.c:179` `PROFLIVE` in the burst dump: **snap 4,621,632 B (72,213
headers) at peak RSS, live 12,608 B (197 headers) at the dump.** They do not
survive.

The candidate is withdrawn — with the caveat that this dump cannot actually
adjudicate it either way: `snap` is sampled at peak RSS and `live` at exit,
and **neither is the SETTLED point** where the census counted 161,408. The
exit dump is after shutdown teardown. So "they do not survive to exit" is what
was measured; "they are not the settled population" does not follow from it.

### A third arm split, in my own reading

The sync-path IR exploration that produced "four scalar boxing walkers per
notification" was read off `nobuffer/out-buf/zapo-rest.ll`, which is **1.8.2**
— while the measurement in this file is **1.6.2**. `streamProtoFields` does
not exist in the 1.6.2 artifact at all. That reading describes the other arm
and must not be carried over to this one without redoing it against a 1.6.2
artifact.

### Concentrated or spread? The static list cannot say, and here is how far it gets

Read from `rest182-out162nw/zapo-rest.ll` (**arm: zapo-js 1.6.2, `app/`** — the
arm the measurement was taken on).

**7,569 array-growing call sites** (`scr_arr_push` / `push_ref` / `set_slot` /
`unshift`) spread across **1,683 emitted functions**. The concentration curve:

| share of static sites | functions |
|---|---|
| 50% | 67 |
| 90% | 927 |

A long tail, and the largest single holder is `sc_f__x25_init_193` with 1,263
sites — an **init** function that builds static tables once, not the sync path.
The `Object.keys` / `Object.entries` helper family is 23 functions holding 556
sites between them.

**But static site count is not dynamic byte attribution, and this question is
about bytes.** One push inside a hot loop outweighs a thousand sites that run
once — `init_193` is exactly that shape in reverse. So the honest answer is
that the static list **cannot** settle whether the ~170,740 large grows are
concentrated: it says only that the *opportunity* is spread, which is
consistent with either outcome.

The thing that settles it is per-site caller attribution, which is the
`SCR_PROF_STACKS` half of the queued build. That is the same instrument the
concentration question and the "which TypeScript" question both need, so one
build answers both — and if the answer is "concentrated", a targeted fix may
be available; if "spread", a growth-policy change is the only lever and its
blast radius is corpus-wide.

## Pass 2 — the size shape, 2026-09-09 (artifact: `out/zapo-rest-prof2.exe`, arm: `app/` 1.6.2)

Same two-run protocol, `-DSCR_PROF_SIZEHIST -DSCR_PROF_STACKS`. Both arms
clean-exit 0, `events-captured n=0` and `n=8`.

**The stack half failed and is reported as a failure, not a result.**
`lost=5,409,633` of 5,426,047 — 99.7%. The 16,384-slot table saturated during
startup, so both arms recorded an identical 16,414 allocations and the
difference between them is exactly zero. No attribution came out of this run.
The instrument is fixed (a site filter, and `tablefull` counted separately
from a failed walk so a saturated table can never again read as data); the
re-run is not launched.

### `scr_array.c:172` is bimodal, and both modes are now visible

Octave histogram of the burst's 1,436,752 grows at that site (bucket *b*
covers [2^b, 2^(b+1)); `cap` is always a power of two so a grow lands on the
bucket floor):

| octave | bytes | grows | ≈ MiB |
|---|---|---|---|
| 5 | 32 | 365,846 | 11.2 |
| 6 | 64 | 883,666 | 54.0 |
| 7 | 128 | 25,944 | 3.2 |
| 8 | 256 | 22,558 | 5.5 |
| 9 | 512 | 22,187 | 10.8 |
| 10 | 1,024 | 21,446 | 20.9 |
| 11 | 2,048 | 20,100 | 39.3 |
| 12 | 4,096 | 18,845 | 73.6 |
| 13 | 8,192 | 17,648 | 137.9 |
| 14 | 16,384 | 15,533 | 242.7 |
| 15 | 32,768 | 14,506 | 453.3 |
| 16 | 65,536 | 8,473 | 529.6 |

**87.0% of the grows are ≤64 B** — the first sizing, exactly as the ratio
predicted. **And 2.7% of the grows (octaves 14–16, 38,512 of them) carry
~1,226 MiB, about 77% of the site's bytes.** The tail is remarkably *flat*
from octave 7 to 15 — 15,000–26,000 grows in every octave — which is the
signature of arrays climbing the whole ladder rather than of a few big ones.

So the mean of 998 B described neither population, as suspected. A presize
would have to know the final size of arrays reaching **8,192–16,384 elements**,
and there are tens of thousands of them per run.

`scr_array.c:179` is monomorphic: **1,254,966 allocations, all in octave 6** —
every `ScrArr` header is exactly 64 B.

### The exact table: 328 B is real, and the multiplicity was 4

Top exact sizes the burst added (bucket covers [lo, lo+8)):

| lo | delta | MiB |
|---|---|---|
| 64 | 2,440,080 | 148.9 |
| 24 | 948,928 | 21.7 |
| 32 | 530,474 | 16.2 |
| 152 | 135,882 | 19.7 |
| 128 | 87,926 | 10.7 |
| **328** | **76,796** | **24.0** |
| **336** | **71,526** | **22.9** |

**328 is a real, sharp exact mode.** The registered prediction named the size
correctly and the count wrongly: 76,796 is **4.00×** the 19,200 message bodies
(76,796 / 19,200 = 3.999), and 336 carries another 71,526. So the message body
produces about four heap strings of that class each, not one.

The registered criterion was "population within 2×", and 4.00× fails it, so
**the prediction stays refuted** — but for a far more informative reason than
the first reading suggested. The site-total of 301,903 was never the 328
population; the exact table separates them and the site is a mixture.

`over8k=58,701` in the burst: allocations at or above 8 KiB are outside the
exact table and are in the octave histogram only.

### Caveats

* **Attribution lane, not a timing lane.** The stack walk ran on every one of
  5.4M allocations. Instrumented peak, `profTableBytes` and cycle counts from
  this build mean nothing and must never be compared with the clean 105.14 MiB.
* Burst allocation count moved 4,871,991 → 5,426,047 (+11%) between pass 1 and
  pass 2. Run-to-run variation on a workload with timers; the shape is stable,
  the absolute counts are not to three digits.

## Correction: the array change is a THROUGHPUT change, not the fragmentation fix

The `perf(array)` commit that removes the doubling ladder from the CRT heap is
titled "the doubling ladder stops shredding the heap". **That over-claims, and
the free-side census is what corrects it.**

| registered prediction | share of committed-free bytes |
|---|---|
| powers of two (`scr_arr_grow`) | **9.6%** |
| `3 × 2ⁿ` entries ladder | 0.1% |
| the 328 B mode | **refuted — zero holes at 328, either arm** |
| **1,344 B × 15,766 holes** | **57.3% = 20.21 MiB** |

**A site can allocate three quarters of everything and leave a tenth of the
holes.** Allocation volume and residue are different measurements, and only
the free-side one describes what is *retained*. The octave histogram in this
file was a measurement of the allocation stream, and it stands — the
bimodality, the flat tail, the 1,582.6 MiB reconciling both ways. The step
that does not follow is from that to "therefore this is the retention", and
nothing on the allocation side could have caught it.

So the change should be read as:

* **a throughput change on its own terms.** Every doubling today `memcpy`s the
  whole array; reserve-and-commit removes that outright, on 1,449,126 grows
  per sync. That is independent of residue share, and "no performance loss" is
  half the objective — a change that is *faster* is worth having where its
  memory share is modest.
* **with a 9.6%-of-residue memory side-effect** that moves **commit**, which
  the discard route cannot touch.

It is **not** the fragmentation fix. The dominant population is 1,344 B ×
15,766, sync-created, all dead, and unidentified.

### On reconsidering the complexity against a 9.6% target

Reviewed, and the honest answer is that it does not shrink usefully:

* The reserve-and-commit core is ~40 lines and is exactly what delivers the
  throughput win. There is no smaller way to stop copying on grow.
* **The exceeded-reservation fallback is correctness-required, not
  scale-required.** Any fixed reservation can be exceeded; the alternative to
  copying back out is trapping. It stays whether the target is 9.6% or 96%,
  and the fixture exercises it deliberately because no ordinary workload does.
* The one genuinely scale-tunable number is `SCR_ARR_VM_RESERVE` (16 MiB).
  Measured peak concurrent array data at this site is under 1 MiB and the
  largest array is 64 KiB, so 16 MiB is ~256× headroom — but address space is
  free on x64 and lowering it only makes the fallback fire more often, which
  costs copies and gives back part of the win.

No simplification is being performed for its own sake. What changed is the
claim, not the code.
