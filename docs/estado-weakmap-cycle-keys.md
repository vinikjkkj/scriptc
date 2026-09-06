# WeakMap phase 3: keys the release path cannot see

**Status: phases 1, 1b and 2 are landed.** 16 of the 20 WeakMap diagnostics
in the zapo-js 1.8.2 arm are cleared, and `scr_cycle.c` has not been touched.
Read the header comment of `packages/runtime/src/scr_weak.c` first — the
correctness argument lives there and is not repeated in full.

**Do not start phase 3 while `arenafree` is in flight.** It restructures
`scr_cycle.c`'s allocation and free paths (chunk headers, per-chunk live
counts) and phase 3 edits that file.

| phase | keys | site | diagnostics | status |
|---|---|---|---|---|
| 1 | `Uint8Array` (`ScrBytes`) | `X25519.ts:116,117`, `xeddsa.ts:73` | 12 | **done** |
| 1b | `keyobj` as a container value | (same) | — | **done** |
| 2 | untraced arrays | `decoder.ts:87` | 4 | **done** |
| 3 | cycle-allocated keys | `encoding.ts:229` | **4** | **OPEN** |

---

## 1. The rule that decides everything

A WeakMap entry is keyed by **address**, and the string and cycle arenas
recycle addresses aggressively. An entry that outlives its key is therefore
not a leak — it is a **wrong answer**: a later object landing on the dead
key's address finds the dead key's value.

A key kind may be admitted **only if the runtime observes its death at a
point it owns, before the storage is handed back.** Not "has a stable
identity" — records and class instances have identity and JS allows them as
keys. The question is solely *where does this kind die, and is that one
place*.

---

## 2. Where each kind dies — three shapes, and only the third is left

### 2a. `ScrBytes` — phase 1

`scr_bytes_release` at `--rc == 0`. Not a cycle node. One place.

### 2b. Untraced arrays — phase 2

`scr_arr_new_ref` (`scr_array.c`) routes through `scr_cyc_alloc` **only when
`elem_trace` is non-NULL**; otherwise plain `malloc`, and `scr_arr_release`
mirrors it with a `free(a)` that never reaches `scr_cyc_free`. Strings carry
no trace, so `readonly string[]` is an untraced array with exactly the shape
`ScrBytes` has. Hooked in `scr_arr_release`, no collector involvement.

### 2c. Cycle-headered objects — records, class instances, TRACED arrays — PHASE 3

Two entry paths that **converge**, which is what makes this tractable:

- ordinary release to zero: e.g. `scr_arr_release` → `scr_arr_gc_free(a)` →
  `scr_cyc_free(a)`;
- the collector: `scr_collect_cycles` walks its white list and calls
  `scr_cyc_free_of(scr_cyc_hdr(obj))(obj)` (`scr_cycle.c:831`) — the per-type
  `gc_free` — which also ends in `scr_cyc_free(obj)`.

**Both end at `scr_cyc_free(void *obj)` (`scr_cycle.c:449`).** Its own comment
says it is "reached from ~16 different teardowns". That is the hook, one
line:

```c
void scr_cyc_free(void *obj) {
  if (scr_weak_died_hook != NULL) scr_weak_died_hook(obj);   /* <-- here */
  scr_cyc_live--;
  ...
}
```

It must be the **first** statement — before the pool give-back and before the
arena give-back, since both hand the address to the next allocation.

Unlike `ScrBytes` and `ScrArr` there is no per-object mark available here, so
this pays an unconditional NULL test on every cycle-object free. If that
shows in a profile, add a spare bit to `ScrCycHdr` and set it from a new
stamp (§4). **Measure first** — the hook is a predictable NULL compare and
the pointer is NULL in every program that never builds a WeakMap.

---

## 3. BLOCKING DESIGN QUESTION — record keys and width coercion

**Resolve this before admitting record or class-instance keys. Do not admit
them on the way past.** The death hook in §2c is necessary but *not
sufficient* for `encoding.ts:229`.

`isSupportedMapKey` admits IR `object` and `record`, and argues:

> A RECORD keys the same way. Records are heap pointers whose identity is
> ALREADY observable and JS-exact … the copy a width coercion makes is the
> same documented one, and it changes identity in `===` exactly as it would
> here.

**That is an argument about a STRONG map, and it does not transfer.** Under a
strong map a width coercion produces a new address, the caller misses its own
entry, and the entry it left behind stays alive and harmless — a wasted slot.
Under a **weak** map the same coercion is materially worse:

1. `set(k, v)` coerces `k` to a fresh temporary; the entry is keyed on the
   temporary's address.
2. The temporary dies at the end of the statement.
3. Now the table either holds an entry keyed on a **dead address** — which is
   precisely the address-reuse hazard this whole design exists to prevent, and
   a later object landing there reads `v` — or, if the death hook fires, the
   entry vanishes instantly and `get` can never hit, making the cache silently
   useless.

Both outcomes are bad, and the first is a wrong answer rather than a
performance bug. So phase 3 must do **one** of:

- **(a)** admit record keys only where no width coercion can occur, and prove
  that condition statically at the `set`/`get` sites; or
- **(b)** admit only nominal class instances (which do not width-coerce) and
  keep structural records refused; or
- **(c)** establish that the lowering never coerces a value used as a weak key
  — in which case write down *why*, because the current comment does not
  establish it.

Also still open and cheaper: **what does TypeScript's bare `object` even map
to** through `mapType`? It may not map at all today. Answer that before
assuming `encoding.ts:229` is only waiting on the collector hook.

---

## 4. How to add a key kind — the mechanics phases 1 and 2 established

1. **A per-kind stamp.** `ScrWeakMap` holds a `key_mark` function pointer
   supplied at construction (`scr_weak_new(val_retain, val_release,
   key_mark)`), and each kind's stamp lives with its own type:
   `scr_bytes_weak_mark`, `scr_arr_weak_mark`. It is a pointer and not a
   switch because **the mark lives in a different struct field per kind, so a
   shared stamp would be a stray store into whichever struct it guessed
   wrong.** A cycle-headered kind would add `scr_cyc_weak_mark` writing a bit
   in `ScrCycHdr`.
2. **The flag rides existing padding.** `ScrBytes::weakkey` and
   `ScrArr::weakkey` both sit in padding that was already there —
   `sizeof(ScrArr)` is 64 and `sizeof(ScrBytes)` is 40 both before and after,
   verified by compiling a probe against each header. Check the same before
   adding a bit to `ScrCycHdr`.
3. **The death hook**, guarded by the flag, as the FIRST thing in the free
   path, before any storage is handed back.
4. **`isSupportedWeakKey`** in `ir/nodes.ts`, plus
5. **an emitter cross-check.** The predicate is a pure `IrType` function and
   cannot reach `CEmitter.traceAdapterC`, which is a MODULE-level fixpoint. So
   the predicate under-approximates (`isNeverTracedElem` lists only kinds that
   are acyclic by construction) and the emitter re-checks against the real
   fixpoint, throwing if the two disagree. **Keep both.** A predicate that only
   ever meets the cases it accepts is untested — that is why
   `tests/diagnostics/weakmap-traced-array-key.ts` pins the refusals from
   outside as well.

---

## 5. The three traps, so they are not rediscovered

The first two were caught by `SCRIPTC_RC_AUDIT=1` on corpus 7782 against a
strong-Map control that exited clean. Both are invisible to every functional
test: output stays byte-exact against node while memory grows.

**Trap 1 — a container kind missing from `isRefCounted` emits no release at
all.** `weakmap` was absent, so the emitter never released the table and its
strongly-held values were never freed: 43 live objects at exit. Any new IR
container kind must be added to `isRefCounted` in the same change that
introduces it. There is no diagnostic for this; only the audit sees it.

**Trap 2 — the value ownership convention must match the emitter.**
`scr_map_set_*_ref` TAKES ownership, so the C emitter does `E.moveTemp(v)`.
`scr_weak_set` instead RETAINS its own reference, so the weak arm must **not**
`moveTemp` — doing both double-counts. Change one side, change the other in
the same commit.

**Trap 3 — a shared key stamp is a stray store.** See §4.1. `ScrBytes` and
`ScrArr` put `weakkey` at different offsets; a single
`((ScrBytes *)key)->weakkey = 1` applied to an `ScrArr` corrupts whatever
lives there. This is why the stamp is a function pointer chosen by the
compiler from the statically-known key type.

Run the audit on any new corpus program: `SCRIPTC_RC_AUDIT=1 scriptc build
prog.ts`, then run it; exit 99 is a leak. Measure on an entry that RETURNS —
`process.exit()` skips the `atexit` handler, so a leaking program that ends
that way exits 0 in silence.

---

## 6. Still not implemented, in any phase: ephemerons

Values are held **strongly**, so a value that can reach its own key keeps both
alive. Real WeakMap semantics make a value reachable only *through* its key,
which needs the collector to treat the table as an ephemeron edge — strictly
more than the death hook.

Verified that this does not bite the phase-1 caches: `xeddsa.ts:83` stores a
bigint plus a **fresh** `encodedPublic` out of `encodeExtendedPoint`, never
the `privateKey` that keys it. **Re-check it for every new WeakMap.** The
check is "can the value reach the key", and nothing automates it.

If you do implement ephemerons: the weakmap v-adapters register **no trace**
(`emit-types.ts`), deliberately. Adding a trace over the values alone would be
the first half of ephemeron support and the wrong half on its own — it would
keep a value alive past its key.

---

## 7. Known live defect, until phase 3 lands

A WeakMap keyed by a class instance or a record still rides the **strong**
identity Map and retains its keys — it leaks exactly what it exists to
release, for the life of the map. It predates all of this work. The note sits
in `frontend/types.ts` beside the branch; the comment there previously called
it "a documented divergence in footprint, not in behaviour", which is how it
survived review. For a cache keyed on a long-lived object, that divergence is
unbounded growth. Delete the note when phase 3 lands, and not before.

---

## 8. How to verify

- **`packages/runtime/test/test_weak.c`** — 30 cases today, covering both
  admitted key kinds: no-key-retain, death splicing, multi-map splicing,
  growth past tombstones, and address reuse for each kind. Add the new kind to
  each. The reuse cases *report* when the allocator did not recycle rather
  than passing quietly; keep that, or a case can pass without testing
  anything.
- **Corpus 7782** (bytes keys) and **7785** (array keys) are the in-language
  differentials. Neither can observe weakness — that is the point, and it is
  why the C test exists.
- **`tests/diagnostics/weakmap-traced-array-key.ts`** pins the refusals.
  Extend it whenever the predicate widens.
- **`SCRIPTC_RC_AUDIT=1`** on every new corpus program.
- **Backends.** WeakMap has no LLVM lowering, so a WeakMap program demotes to
  the C backend (`LlvmUnsupportedError("weakmap:new")`). That is the expected
  lane, not a caveat: the standing objective is a pure-C zapo binary with no
  embedded engine. Do not spend effort adding an LLVM arm.
- **A distinct `-o` DIRECTORY per build variant.** The intermediate is named
  from the ENTRY basename (`index.ts:770`) and `main.ts` deletes it on
  completion unless `--keep-c`, so two variants of one entry built into one
  directory pull the file out from under each other. A distinct output
  *filename* is not enough.
