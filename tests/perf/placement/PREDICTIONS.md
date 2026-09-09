# Registered before the histogram lands

The census block is measuring the free-hole size distribution on the settled
`app/` process. This file writes down, **before that reading exists**, what
each candidate allocator ladder must produce if it is the source — so the
histogram confirms or refutes a number that was written down, rather than
being interpreted after the fact.

Everything here is arithmetic off `packages/runtime/src/` at `e6f48fb2f` and
the workload dials in `tests/perf/zapo-rest/harness/memrig.mts`. No reading is
involved and none is claimed.

## The three ladders are arithmetically distinguishable

That is the point of registering them together: they do not overlap, so the
histogram can attribute rather than merely count.

| source | request size | signature |
|---|---|---|
| `scr_arr_grow` (`scr_array.c:165`) | `cap × 8`, first cap 4, doubling | **exact powers of two**, 32, 64, 128, 256, 512, … |
| `scr_dyn_obj_put_k` (`scr_json.c:1585`) | `cap × 24`, first cap 1, doubling | **3 × 2ⁿ**, 24, 48, 96, 192, 384, 768, 1536, 3072 |
| `scr_str_alloc` (`scr_string.c:616`) | `8·⌈(cap+13)/8⌉` | **dense multiples of 8**, with modes where the workload has string lengths |

`sizeof(ScrStr)` is 12 (three `uint32` plus a flexible array member), so a heap
string's request is `cap + 13` rounded up to `SCR_POOL_GRAIN` (8).

The `3 × 2ⁿ` family is the dyn entries array, which the census block already
registered independently. **It is not on the history-sync path** — the emitted
IR of an `app/` build reaches four scalar boxing walkers per notification and
`scr_dyn_obj_set` appears zero times in emitted code anywhere in the binary —
so `3 × 2ⁿ` holes in a settled `app/` process come from somewhere else
(JSON, app-state, the island path), and finding them is not a confirmation of
boxing during the sync.

## The lead: the uncovered string band, 244 ≤ cap ≤ 511

`scr_str_alloc` takes from the size-class pool or the string arena only while
`scr_pool_bytes(sizeof(ScrStr) + cap + 1) <= SCR_POOL_MAX` (256), i.e.
**`cap <= 243`**. `scr_str_release` (`scr_string.c:783`) keeps a **single**
spare block for **`cap >= 512`**. Between those two, a heap string is a raw
`malloc` and a raw `free` with no recycling of any kind.

Predicted request sizes over the band: multiples of 8 from **264** (`cap` 244)
to **528** (`cap` 511).

### The sharp one: 328 bytes

The rig builds each message body as `'x'.repeat(TEXTLEN)` plus a suffix
` c<c> i<i> m<m>` (`memrig.mts:265`, `:275`). At the documented dials
(`TEXTLEN=300`, `CHUNKS=8`, `CONVS=400`, `MSGS=6`):

```
len = 300 + 3 + 3 + digits(i) + 3   =  309 | 310 | 311
      (i < 10: 10 convs, i < 100: 90 convs, i < 400: 300 convs)

request = 8·ceil((len + 13)/8) = 8·41 = 328     for all three lengths
```

**All three collapse to one class.** So:

> **PREDICTION.** If the uncovered string band is a material source of the
> 107,512 free holes, the histogram carries a **mode at 328 bytes** with a
> population on the order of **19,200 per round**
> (`CHUNKS × CONVS × MSGS = 8 × 400 × 6`), and that mode is **absent from a
> `CHUNKS=0` control**.

### What would refute it

* No mode at or near 328 B, and none at small integer multiples of it.
* A 328 B mode present in the `CHUNKS=0` control at a similar count — then it
  is not the sync.
* The band `264…528` carrying a negligible share of total free bytes.

### The coalescing caveat, stated in advance so it is not a rescue

NT heap free blocks **coalesce with adjacent free blocks**. A run of freed
328 B strings that are neighbours becomes one larger free block, so the
histogram may show the mode at small integer multiples instead of at 328.
The census's reported **mean hole of 710 B** is consistent with roughly two
coalesced 328s plus per-block overhead — but that is a *prediction to check*,
not a fit to be claimed afterwards. If the mode lands at neither 328 nor a
small multiple, the band is refuted and this file says so.

`HeapWalk` reports `cbData` plus `cbOverhead`; the request is `cbData` rounded
to the heap's 16-byte granularity. Compare on `cbData`, not on the sum.

## What is already excluded, and by what evidence

| excluded | evidence |
|---|---|
| dyn entries arrays on the sync path | four scalar walkers per notification (`sc_td_0` a string, `sc_td_15/17/737` a number); `scr_dyn_obj_set` count zero in emitted code |
| an 88–90 member record anywhere | largest generated proto types are 108, 81, 72, 63; `WA_APPSTATE_SCHEMAS` has 66 entries |
| sync-path records reaching the CRT heap | the four record types `settleHistorySyncChunk` builds are 3–12 fields (24–96 B), under `SCR_POOL_MAX`, so `scr_cyc_alloc` serves them from the cycle arena |
| `cachedNctSalt` contributing to any measured figure | the rig never sends `nctSalt` — see below |

## Read the histogram on EXACT sizes; bucketing destroys the answer

The census reports a real busy population at **1328 B** — 4,097 blocks,
5.31 MiB. **4 x 328 = 1312.** Those are sixteen bytes apart. Any table that
rounds, buckets, or bins by power-of-two merges them and reports a
"coalesced-body mode" at four-times-the-string-class that is not there.

So: compare on exact `cbData`, no binning, and print the two neighbours
separately. If 328 and 1328 both appear as distinct modes, they are two
populations. If only 1328 appears, the 328 prediction is refuted and must not
be rescued by calling 1328 a coalesced run of four.

1328 is also **not a multiple of 24**, so it is not the dyn entries ladder
either, and it is not a power of two so it is not an array buffer.

### A candidate for it: a bytes payload, which obeys no ladder at all

`scr_bytes_alloc` (`scr_bytes.c:42`) makes **two** allocations per bytes
object:

* `malloc(sizeof(ScrBytes))` — a small fixed header, one per live
  `Uint8Array` / `Buffer`. A candidate for part of the 161,408 busy blocks at
  64 B and under, alongside `scr_arr_new`'s `malloc(sizeof(ScrArr))`.
* `calloc(len, elem_size)` — the payload, at **exactly** the requested length.

That is the fourth signature and it is the one that explains an
unattributable size: **a bytes payload is not rounded to any class**, so it
can land on any number at all, 1328 included. It is also the only one of the
four that can produce a size which is **not a multiple of 8**.

> **PREDICTION.** Free or busy blocks whose size fits none of the three
> ladders — and in particular any size that is not a multiple of 8 — are
> `scr_bytes_alloc` payloads. If the 1328 population is bytes payloads, a
> `CHUNKS=0` control should show far fewer of them, and `profdiff.mjs` should
> attribute them to a bytes-allocating site.

Refuted if 1328 tracks the sync but no bytes-allocating site moves with it.

## `cachedNctSalt`: retracted as a live defect, and the version split is why

**It fires zero times in every measurement this objective rests on**, and that
much is version-independent and verified at both ends: `memrig.mts:281` calls
`sendHistorySync({ chunkOrder, progress, conversations })` with no `nctSalt`,
and the fake server's field is optional
(`fake-server/src/protocol/push/history-sync.ts:41`, `:92`), so the proto omits
it and the assignment never runs. It contributes zero to the 105.14 MiB
settled, zero to the live total, zero to the histogram, and it may not be used
to explain one measured byte.

**As a defect it is retracted, and the reason is the arm split again.** The
copy that removes it is present in **1.8.2** and absent in **1.6.2**:

| arm | path | copy at origin |
|---|---|---|
| `app182` / 1.8.2 | streaming field reader, `event.value.slice()` | **yes** |
| `app` / 1.6.2 | `history-sync.ts:275`, `onNctSalt(historySync.nctSalt)` | **no** |

In 1.6.2 nothing on the path copies: `onNctSalt` passes the decoded field
straight to `hydrateNctSaltFromHistorySync`, which does `this.cachedNctSalt =
salt` (`WaTrustedContactTokenCoordinator.ts:283-286`). And the decoded field
really is a view — the vendored protobufjs in `spec/proto/index.js` sets
`_slice = Array.prototype.subarray` for the base reader and
`Buffer.prototype.slice` for the buffer reader, and both alias.

So this was **fixed upstream between 1.6.2 and 1.8.2**, not left open. It is
not a finding to send anyone. What it is, is the second time in this
investigation that a conclusion turned on which arm was being read, after the
`streamProtoFields` / `downloadHistorySyncBlob` split. Any claim about zapo
source here must name its version.

### The lesson, which is worth more than the case

**Follow a value to its origin before calling a consumption site a defect.**
Storing a reference tells you what is *held*, not where it came from. The
harder half had been verified — that a `subarray` view survives compilation
with chain depth 1 to an owner — which is exactly what made the conclusion
look solid while the easy half went unchecked.
