# The expected magnitude, written before the run

Recorded before any A/B repetition was taken, so the measurement can **confirm
or refute a number** rather than produce one. Every figure below is read off
the runtime's own struct definitions, not estimated.

## What one ring entry costs

`Ev` is `{ readonly seq: number; readonly at: number; readonly type: string;
readonly data: unknown }`.

| part | bytes | why |
|---|---|---|
| `Ev` struct body | 40 | `size_t rc` + `double seq` + `double at` + `ScrStr *type` + `ScrDyn *data`, all 8-wide and 8-aligned — `emit-shapes.ts:276,299-301`, `emit-types.ts:19,23,146` |
| cycle header | 16 | a `dyn` field makes the shape cycle-capable, so it is `scr_cyc_alloc`, not `calloc` — `llvm/shapes.ts:113-119`, `emit-shapes.ts:429`; `ScrCycHdr` is exactly 16 bytes, `scr_runtime.h:503-564` |
| **one heap `Ev`** | **56** | `roundup8(16 + 40)`, `scr_cycle.c:654-657`, grain 8 at `scr_runtime.h:348` |
| one array slot | 8 | every `ScrArr` slot is 8 bytes; the backing store is pointers, never inlined structs — `scr_array.c:118-131,172` |
| the `ScrDyn` box for `data` | 64 | `roundup8(16 + 48)`; body is `rc` 8 + `kind` 4 + 4 bools + a 32-byte union — `scr_runtime.h:4317-4525`, allocated through `scr_cyc_alloc` at `scr_json.c:615` |
| the `type` string | **0** | every `push()` call site passes a string *literal*, so it is an interned `SCR_STR_LIT` immortal shared by every entry — `scr_runtime.h:714,739-740` |

**≈ 128 bytes per ring entry, exclusive of the payload.**

Plus the array itself: `ScrArr` is 64 bytes and is cycle-headered because its
element type is traced, so 80 physical (`scr_array.c:221-222`); the backing
store is `cap * 8` and grows by doubling from 4 (`scr_array.c:165-176`), so a
1,000-entry ring sits at cap 1,024 = 8,192 bytes.

## The payload is NOT freed by this change

`wireEvents` calls `push(sess, "message", e)` and `rememberMessage(sess,
sess.seq, e)` with **the same `e`**. The ring's `data` and `msgEvents[i]` are
two references to one object, both capped at 1,000, both shifted at the same
rate — so they hold the same 1,000 objects. Removing the ring frees the `Ev`,
the slot and the `ScrDyn` box. **It frees no message payload at all.**

## The prediction

### Documented workload (`CHUNKS=8 CONVS=400 MSGS=6`) — DRAW, with certainty

Its 19,200 messages arrive as a **history sync**, and `zapo-rest` deliberately
pushes only `{received, progress, syncType}` per chunk rather than parking the
payload in the ring. A preserved run of this exact workload
(`rest182-memrig/nn8`) ends at **seq 29** — the ring reaches 29 of its 1,000
cap and never fills.

29 × 128 B ≈ **3.7 KB**, against a peak working set of ~186 MiB and a settled
~104 MiB. That is **0.003%** — four orders of magnitude below the ±0.92 MiB A/A
floor previously recorded for this rig. It cannot be seen, and no amount of
repetition will make it visible.

### Ring-loaded workload (`LIVEMSGS=1500`) — the discriminating case

The ring reaches its 1,000 cap, all `message` events:

* 1,000 × 128 B = 128,000 B, plus the 8,192-byte backing store and the 80-byte
  array object = **0.13 MiB**.
* Against a settled ~104 MiB that is **0.12%**, still about **7× below** the
  ±0.92 MiB floor.

**So the prediction is DRAW here too** — with one stated way to be wrong.

The 64-byte `ScrDyn` figure assumes boxing a record into `unknown` keeps a
**reference** to it. If instead the box **materialises** the record — one
24-byte `ScrDynEntry` per property (`scr_runtime.h:4266-4271`) plus a nested
`ScrDyn` per value — a `WaIncomingMessageEvent` of ~50 reachable properties
would cost ~4.4 KB per entry, and 1,000 of them would be **~4.4 MiB**: comfortably
above the floor, and the ring would be a real cost after all. I could not settle
which it is from the sources, so it is written down as the fork it is.

**Therefore: `ablive` DRAW ⇒ boxing is by reference and the ring is genuinely
negligible. `ablive` showing ~4 MiB ⇒ boxing materialises, and the finding is
about `unknown`, not about the buffer.** Either outcome is a result.

### `msgkeep` (`ZAPO_MSG_KEEP` 1000 vs 0) — the one that may move

This is the buffer the change did *not* remove, and it is the one holding the
message payloads. 1,000 retained `WaIncomingMessageEvent` records at 300 bytes
of text plus their protobuf structure — order 1–3 KB each — is **1–3 MiB**,
which is above the floor. If any arm in this experiment moves, the prediction is
that it is this one.

## Summary, in one line

**Removing the event buffer is predicted to be a DRAW on peak and settled RSS
in both workloads, because the ring's exclusive retention is ~128 bytes per
entry and it holds at most 1,000 entries — ~0.13 MiB against a ~104 MiB settled
process, some 7× under this host's own A/A floor.**
