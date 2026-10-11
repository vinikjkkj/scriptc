# The 1,344 has a name — and it was never a coalescence question

> **Gate.** `tests/perf/placement/SEGREGATION.md` §5 ends with *"Nothing
> else until the 1,344 has a name."* This file names it, sizes it against the free
> side it belongs to, and retires the mechanism two documents had registered
> for it.

Measured with `tests/perf/heapcensus/holemap.c`, out of process, against the
**committed** census artifacts. Nothing was rebuilt and no zapo run was
repeated, so no number here moved because an instrument was added to the
thing it measures.

## 1. The registered claim, and what actually happens

`SEGREGATION.md` §4's REGISTERED block — *"The 15,766 sync-created 1,344-byte
holes were not allocated at 1,344 bytes"* — and
`settled-census/reconcile.mjs:496-511` both register the same thing:

> There is no 1,344-byte request anywhere in the run — the 8-byte-bucket
> allocation-side table shows 1320:6, 1328:16, **1344: absent**, 1352:10.
> **REFUTED if an allocation site is found requesting ~1,344 bytes ~15,766
> times.**

and `reconcile.mjs` draws the conclusion that gated everything:

> The NT heap coalesces a freed block with adjacent free neighbours, so a hole
> of size X may be several smaller dead blocks merged... **Nothing requests
> 1,344 bytes, so 15,766 holes of it cannot be an allocation site.**

**The premise is true and the conclusion does not follow.** The two tables are
keyed on two different quantities, and `scr_heap_census.h:365-371` says so in
its own comment without noticing the consequence:

| | what `HeapWalk` puts in `cbData` |
|---|---|
| a **busy** block | the size the caller **asked for** — the NT heap stores the user size |
| a **free** block | the block's **data extent** — once it is free there is no request left to report |

So `HCSIZE` is a histogram of *requests* and `HCFREE` is a histogram of
*blocks*, and the census keys the free table on `cbData` **specifically** so
it would "be comparable with a REQUEST an allocation site made". It is not.

## 2. The map, measured

`holemap.c` plants a **known** population: `2N` blocks of one request size,
then frees every other one, so every hole has live neighbours on both sides
and cannot merge with anything. A census that cannot see its own plant is not
believed when it reports someone else's.

```
R=1296  FREEROW size=1344 n=4003     R=1344  FREEROW size=1344 n=4003
R=1304  FREEROW size=1344 n=4003     R=1352  FREEROW size=1344 n=4003
R=1312  FREEROW size=1344 n=4003     R=1353  FREEROW size=1408 n=4039
R=1328  FREEROW size=1344 n=4003     R=1288  FREEROW size=1280 n=4000
```

> **`malloc(1328)`, freed, is a hole the census reports as 1,344.** The block
> is 1,360 bytes: 1,328 of request, 16 of tail padding to the bucket, 16 of
> header. The busy table subtracts 32 of that and the free table subtracts 16.
> **The two tables are 16 bytes apart on the same block.**

The whole band collapses: **every request in [1296, 1352] leaves a 1,344-byte
hole.** The bucket boundary is sharp — 1,288 goes to 1,280 and 1,353 to 1,408.

So the registered claim survives *only in its literal wording*. No site asks
for 1,344. **Every one of those 15,766 holes is nevertheless exactly one dead
`malloc`,** and the number it asked for was 1,328.

## 3. Coalescence: refuted, and the instrument proves it could have said yes

`holemap.c` has two more arms, and they are the control the attribution needs.

| arm | what it does | result |
|---|---|---|
| `trip` | frees **3 of every 4 adjacent** blocks, N=20,000 | **30,173 holes of exactly 1,344** — *zero* merged |
| `bulk` | frees **all 40,000** adjacent blocks | **85 free blocks total.** The population is annihilated, not merged into mid-sized holes |
| `iso`, **N=5** | 5 blocks, LFH never activates | `R=1328` → **one hole of 2,096** — a merge of two neighbours |

Two facts, and the second is what makes the first a measurement:

1. **In the LFH (≤ 16 KiB) the NT heap does not coalesce at all.** Three
   adjacent freed 1,328-blocks stay three 1,344-byte holes.
2. **The instrument can see coalescence — at N=5 it saw it.** Below the LFH
   activation threshold the same request lands in the backend, which *does*
   merge, and the probe reported the merged 2,096 instead. So "no coalescence"
   here is a reading, not a blindness.

A population of 15,766 holes at *one* exact size is the signature of
non-coalescing fixed-bucket reuse. Adjacency-summing produces a spread; it
produced one row.

## 4. The owner

> ***CORRECTED 2026-10-10 — see `WHICH-BUFFER.md`, and the correction is in
> THIS FILE's own evidence.*** The section below names the 1,344 class a freed
> `scr_bytes.c:52` payload, from the site table in
> `settled-census/evidence-trace1344/prof.txt`. **Two lines below that table in
> the same file is the site's SIZE HISTOGRAM, and its octave for 1,024–2,047
> bytes reads `3`** — three payloads in the whole run, against 15,766 holes and
> 4,097 live blocks. A run on 10-10 carrying the allocation side and the free
> side in ONE process (which was a compile *error* until `21facf366`)
> reproduces that `3` exactly, puts **60** allocations in the whole
> [1296, 1352] band, and resolves **all 60** to SQLite's own
> `dbMallocRawFinish`. The lockstep cohort this section reads was real and is
> **gone** on main — 1,328 is 4,097 then and **1** now, 40 and 24 are back at
> their no-sync levels — but `scr_bytes.c:52` was never its owner, and the
> 19,091 it is read against is a different run from the 15,766 anyway. The
> reasoning below is kept and marked rather than deleted, for the same reason
> §1 keeps the comment that caused it.



Three busy populations move in lockstep between the no-sync control and the
sync arm (`evidence-llvm182/{nosync,main}/n1.heapcen.txt`):

| busy request size | nosync | main | delta |
|---:|---:|---:|---:|
| **1,328** | 76 | 4,097 | **+4,021** |
| **40** | 3,700 | 7,738 | **+4,038** |
| 24 | 6,488 | 10,521 | +4,033 |
| *(every other size ≤ 192)* | | | +10 .. +37 |

`sizeof(ScrBytes)` is **40**, and `scr_bytes_alloc` (`scr_bytes.c:43,52`) makes
exactly two allocations per object — the 40-byte header and a `calloc` payload
at the raw requested length, on no ladder at all. The site table confirms the
pairing directly:

```
scr_bytes.c:43   n=19091   bytes=763640      avg=40.0     <- malloc(sizeof(ScrBytes))
scr_bytes.c:52   n=19091   bytes=20892983    avg=1094.4   <- calloc(len, elem)  THE PAYLOAD
```

> **The 1,344-byte holes are freed `ScrBytes` payloads** — `scr_bytes.c:52`,
> one per `Buffer`/typed array, requesting 1,328 bytes (band 1296–1352).

This is `PREDICTIONS.md:137`'s own registered prediction, and it comes out
**HIT**: *"Free or busy blocks whose size fits none of the three ladders are
`scr_bytes_alloc` payloads."* It was not read as confirmed because the 1,328
busy row and the 1,344 free row were filed as two separate mysteries.

**What is still open:** *which* TS-level buffer is 1,328 bytes. The payload
site allocates a distribution (avg 1,094 on the 1.6.2 arm); 1,328 is its mode
on 1.8.2. Naming the producer needs the allocation-side exact table on
**app182**, which this slice did not build.

### Why the old cross-check missed it

The "near buckets are identical in both arms" table in `SEGREGATION.md` §4 —
the one whose `1344` row reads *"absent"* in both columns — is from arm `app/`
**1.6.2**, which that file's own header banner marks as
retired. On 1.6.2 the entire band [1296,1352] holds **60** allocations:

```
PROFEXACT 1296 2   1304 23   1312 1   1320 6   1328 16   1352 12
```

The producer is not in that program. The registered negative was measured on
an arm that does not contain the thing it was looking for.

## 5. The share, and the other 44%

Denominator stated on every line: `heap 0 CRT free = 38,278,480 B = 36.51 MiB`
in 81,414 holes, from `evidence-llvm182/main`.

| class | bytes | share | holes |
|---|---:|---:|---:|
| **A — the 1,344 class** (`ScrBytes` payload, req 1296–1352) | 21,441,760 | **56.02%** | 15,766 |
| C — backend > 16 KiB (coalescing; sums **are** possible here) | 8,838,896 | 23.09% | 46 |
| B — 64 KiB blocks (65,504/65,520 — arena-chunk shaped) | 3,211,232 | 8.39% | 49 |
| D — small LFH ≤ 256 B (headers and nodes) | 2,985,280 | 7.80% | 65,070 |
| E — mid LFH 257..16,384 B, everything else | 1,798,496 | 4.70% | 483 |
| | **38,275,664 / 38,278,480 = 99.99%** | | 81,414 |

The structural line through it: **68.51% of the free bytes sit in the LFH**,
where no hole is ever a sum — every one of those 81,319 holes is exactly one
dead request. Only the 95 backend holes (31.48%) can be merges, and that is
where the six singleton mega-holes (1,015,632 / 794,656 / 532,496 / 466,960 /
426,016 / 401,376 B) live.

### Two denominators that must not be swapped

The often-quoted **72.84 MiB in 107,512 holes, mean 710 B** is from
`settled-census/evidence/n1.heapcen.txt`, the 09-06 C-backend arm — and **that
file has zero `HCFREE` rows**, because the free-side size table did not exist
when it was taken. The 1,344 population is known only in the 09-10 LLVM arm,
whose free side is 36.51 MiB in 81,414 holes. Dividing 21.2 MiB by 72.84 MiB
gives **29%**, and it is a numerator from one run over a denominator from
another. In its own run the class is **56.02%** of free bytes (57.31% against
the `HCFREE` sum, which is the figure commit `178ca19f0` quotes).

## 6. What this changes

* **The gate is answered, and the actionable half of it was the right half.**
  The holes have one owner, found at a different number. There is no layout
  problem to solve and no adjacency artifact to chase.
* **The shares in `reconcile.mjs:505-509` are disjoint after all.** That
  comment forbids ranking the 1,344 against the powers-of-two ladder on the
  grounds that one may be the coalesced remains of the other. Inside the LFH
  that cannot happen, so the classes above can be ranked and summed.
* **The string-allocator band fix (244–511, `cap + 13`) is not this.** The
  owner is a bytes payload, not an `ScrStr`. `SEGREGATION.md` §5's conditional
  *"If it turns out to be an `ScrStr` payload"* resolves to *no*.

## 7. Reproduce

```sh
zig cc -O2 -target x86_64-windows-gnu tests/perf/heapcensus/holemap.c -o holemap.exe
holemap.exe 1328 20000 iso    # 20,178 holes at 1,344 -- the plant
holemap.exe 1328 20000 trip   # 30,173 holes at 1,344 -- adjacency does not merge
holemap.exe 1328 20000 bulk   # 85 free blocks         -- what merging looks like
holemap.exe 1328 5     iso    # one hole at 2,096      -- the backend DOES merge
```

`zig 0.16.0`, `x86_64-windows-gnu`. The probe is a standalone process: its
footprint on any zapo figure quoted here is **zero**, because no zapo binary
was rebuilt or re-run for this file.

---

## BAND, 2026-10-11 — THE BYTES IN THE BIG HOLES ARE MOSTLY NOT COMMITTED. Nothing above is edited or re-run.

This file maps holes by SIZE and by SITE, and that work is unaffected. What it
shares with every other `HCFREE` reader is the assumption that a free block
`HeapWalk` reports occupies memory the process is paying for.

`tests/perf/pagecensus/evidence-rest/TWO-INSTRUMENTS.md` refutes that for the
LARGE end of the distribution. Measured from outside the process, in the same
runs, the whole committed private non-stack total is 17-22 MiB while the same
runs' `HeapWalk` reports `busy + free` of 32-37 MiB; and
`pagecensus/heapsplit.c` shows directly, with a negative control, that 74.6% /
93.7% / 92.7% of the bytes in free blocks of >= 64 KiB are **MEM_RESERVE** —
address space the heap has already handed back.

**The small end is where this file works and it is the end that survives.** In
the same `heapsplit` arms, free blocks BELOW 64 KiB are 0.030 / 0.032 / 0.019
MiB of commit against 0.000 / 0.008 / 0.008 MiB of reserve — essentially all
committed. So a hole population of 15,766 blocks at 1,344 B is real memory and
this document's identification of it stands; a population of 43 blocks
averaging 361 KiB is mostly not.

**Lines of this file not named above are not thereby in force — they are merely
UNAUDITED by this band.**
