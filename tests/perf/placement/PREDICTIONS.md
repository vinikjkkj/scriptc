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

## `cachedNctSalt` does not fire in any measurement this objective rests on

`WaTrustedContactTokenCoordinator.ts:289` stores `historySync.nctSalt` — a
32-byte `subarray` **view**, which `scr_bytes.c:518` confirms aliases its
owner in the compiled runtime too — on a coordinator field with no bound and
no eviction, pinning the whole decompressed chunk for the life of the client.

**But the rig never sends one.** `memrig.mts:281` calls `sendHistorySync({
chunkOrder, progress, conversations })`, and the fake server's
`BuildHistorySyncInput.nctSalt` is optional
(`fake-server/src/protocol/push/history-sync.ts:41`, `:92`), so the field is
absent from the encoded proto and the assignment never runs.

So it contributes **zero** to the 105.14 MiB settled figure, zero to the
40.65 MiB live, and zero to the free-hole histogram. It is a real latent
defect against real WhatsApp traffic — where `nctSalt` is present — and it
must not be used to explain one byte of what has been measured here.
