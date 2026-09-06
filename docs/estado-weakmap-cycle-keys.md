# WeakMap, phase 2 and 3: keys whose death the release path does not see

**Status:** phase 1 + 1b are landed (`scr_weak.c`, `ScrBytes` keys, `keyobj`
as a container value). This document specifies the rest so another block can
execute it cold. Read the header comment of `packages/runtime/src/scr_weak.c`
first — the correctness argument lives there and is not repeated in full.

**Do not start phase 3 while `arenafree` is in flight.** It restructures
`scr_cycle.c`'s allocation and free paths (chunk headers, per-chunk live
counts) and phase 3 edits the same file.

---

## 1. What is left

Eight diagnostics, two sites, both in the zapo-js 1.8.2 arm:

| site | type | diagnostics | phase |
|---|---|---|---|
| `transport/binary/decoder.ts:87` | `WeakMap<readonly string[], readonly string[]>` | 4 | 2 |
| `signal/session/encoding.ts:229` | `WeakMap<object, Uint8Array>` | 4 | 3 |

Both are refused today by `isSupportedWeakKey`
(`packages/compiler/src/ir/nodes.ts`), which admits `bytes` only.

---

## 2. The rule that decides everything

A WeakMap entry is keyed by **address**, and the string and cycle arenas
recycle addresses aggressively. So an entry that outlives its key is not a
leak — it is a **wrong answer**: a later object landing on the dead key's
address finds the dead key's value. Every decision below follows from that
one fact.

A key kind may therefore be admitted **only if the runtime observes its death
at a point it owns, before the storage is handed back.** Not "has a stable
identity" — records and class instances have identity and JS allows them as
keys. The question is solely *where does this kind die, and is that one
place*.

---

## 3. Where each kind actually dies — three shapes, not two

This is the part that will be got wrong if it is not read carefully.

### 3a. `ScrBytes` — done in phase 1

`scr_bytes_release`, at `--rc == 0`. Not a cycle node. One place.

### 3b. Cycle-headered objects — records, class instances, TRACED arrays

Two entry paths, and they **converge**, which is what makes this tractable:

- ordinary release to zero: e.g. `scr_arr_release` then `scr_arr_gc_free(a)`
  then `scr_cyc_free(a)`;
- the collector: `scr_collect_cycles` walks its white list and calls
  `scr_cyc_free_of(scr_cyc_hdr(obj))(obj)` (`scr_cycle.c:831`) — the per-type
  `gc_free` — which also ends in `scr_cyc_free(obj)`.

**Both end at `scr_cyc_free(void *obj)` (`scr_cycle.c:449`).** Its own comment
says it is "reached from ~16 different teardowns". That is the hook site, and
it is one line:

```c
void scr_cyc_free(void *obj) {
  if (scr_weak_died_hook != NULL) scr_weak_died_hook(obj);   /* <-- here */
  scr_cyc_live--;
  ...
}
```

It must be the **first** statement — before the pool give-back and before the
arena give-back, since both hand the address to the next allocation.

There is no per-object `weakkey` mark available here the way `ScrBytes` has
one, so this pays an unconditional NULL test on every cycle-object free. If
that shows up in a profile, add a spare bit to `ScrCycHdr` and set it in
`scr_weak_set` — the same trick `ScrBytes::weakkey` uses, and the header has
padding. **Measure before doing it.** The hook is a predictable NULL compare,
and `scr_weak_died_hook` is NULL in every program that never builds a
WeakMap.

### 3c. UNTRACED arrays are not cycle nodes at all — the trap

`scr_arr_new_ref` (`scr_array.c:217`) allocates through `scr_cyc_alloc`
**only when `elem_trace` is non-NULL**; otherwise it is a plain `malloc`. And
`scr_arr_release` mirrors it: with no `elem_trace` it does `free(a->data);
free(a)` and **never reaches `scr_cyc_free`**.

Strings carry no trace, so **`readonly string[]` — the phase-2 key at
`decoder.ts:87` — is an untraced array.** It is a plain refcounted value with
exactly the shape `ScrBytes` has.

**So phase 2 probably does not need `scr_cycle.c` at all.** Its hook is the
untraced branch of `scr_arr_release`, beside the existing `free(a)`, exactly
as phase 1 hooked `scr_bytes_release`. If that holds, phase 2 can land while
`arenafree` is still in flight, and only phase 3 has to wait.

The catch: whether an array is traced depends on its ELEMENT type, so
`isSupportedWeakKey` cannot answer "array" with a flat yes. It must consult
the same trace fixpoint the backend uses (`emit-types.ts`, the
`arrNewC`/`arrNewCall` note around :863-871) and admit an array key only when
its element is untraced; a traced array is a cycle node and belongs to phase
3. Getting this backwards admits an array whose collector death nothing
observes, which is the wrong-answer case, not a leak.

---

## 4. Phase 3 and the bare `object` key

`encoding.ts:229` is `WeakMap<object, Uint8Array>`. Two separate problems,
and the second is the harder one:

1. **The death hook** — solved by 3b once the `scr_cyc_free` line lands.
2. **What does bare `object` even map to?** `isSupportedMapKey` admits IR
   `object` (class instance) and `record`. Its comment argues a record keys by
   reference identity honestly because "the copy a width coercion makes is the
   same documented one, and it changes identity in `===` exactly as it would
   here". **That argument is about a STRONG map.** Re-examine it for a weak
   one: a width coercion produces a new address, so a record that coerces on
   the way into `set` and again on the way into `get` misses its own entry
   AND leaves an entry keyed on a temporary that dies immediately — an entry
   that is instantly dead is exactly the address-reuse hazard. Confirm what
   TypeScript's bare `object` maps to through `mapType` (it may not map at all
   today) before assuming this site only waits on the collector hook.

---

## 5. The two ownership traps, so they are not rediscovered

Both were caught by `SCRIPTC_RC_AUDIT=1` on corpus 7782 against a strong-Map
control that exited clean. Both are invisible to every functional test: output
stays byte-exact against node while memory grows.

**Trap 1 — a container kind missing from `isRefCounted` emits no release at
all.** `weakmap` was absent, so the emitter never released the table, so its
strongly-held values were never freed: 43 live objects at exit. Any new IR
container kind must be added to `isRefCounted` in the same change that
introduces it. There is no diagnostic for this; only the audit sees it.

**Trap 2 — the value ownership convention must match the emitter.**
`scr_map_set_*_ref` TAKES ownership, so the C emitter does `E.moveTemp(v)`.
`scr_weak_set` instead RETAINS its own reference, so the weak arm must **not**
`moveTemp` — doing both double-counts. If you change one side, change the
other in the same commit. The weak arm carries a comment saying so.

Run the audit on any new corpus program: `SCRIPTC_RC_AUDIT=1 scriptc build
prog.ts`, then run it; exit 99 is a leak. Measure on an entry that RETURNS —
`process.exit()` skips the `atexit` handler, so a leaking program that ends
that way exits 0 in silence.

---

## 6. Still not implemented, in any phase: ephemerons

Values are held **strongly**, so a value that can reach its own key keeps both
alive. Real WeakMap semantics make a value reachable only *through* its key,
which needs the collector to treat the table as an ephemeron edge — strictly
more than the death hook above.

Verified that this does not bite the phase-1 caches: `xeddsa.ts:83` stores a
bigint plus a **fresh** `encodedPublic` out of `encodeExtendedPoint`, never
the `privateKey` that keys it. **Re-check it for every new WeakMap.** The
check is "can the value reach the key", and nothing automates it.

Note the trade if you do implement ephemerons: the weakmap v-adapters
register **no trace** (`emit-types.ts`), deliberately. Adding a trace over the
values alone would be the first half of ephemeron support and the wrong half
on its own — it would keep a value alive past its key.

---

## 7. Known live defect this does not fix until phase 3

A WeakMap keyed by a class instance or a record still rides the **strong**
identity Map and retains its keys — it leaks exactly what it exists to
release, for the life of the map. It predates all of this work. The note sits
in `frontend/types.ts` beside the branch; the comment there previously called
it "a documented divergence in footprint, not in behaviour", which is how it
survived review. For a cache keyed on a long-lived object, that divergence is
unbounded growth. Delete the note when phase 3 lands, and not before.

---

## 8. How to verify

- **`packages/runtime/test/test_weak.c`** — extend it. It already covers
  no-key-retain, death splicing, multi-map splicing, growth past tombstones,
  and address reuse. Add the new key kind to each. The reuse case *reports*
  when the allocator did not recycle rather than passing quietly; keep that
  property, or the case can pass without having tested anything.
- **Corpus 7782** is the in-language differential. It cannot observe weakness
  — that is the point, and it is why the C test exists.
- **`SCRIPTC_RC_AUDIT=1`** on every new corpus program.
- **Backends.** WeakMap has no LLVM lowering, so a WeakMap program demotes to
  the C backend (`LlvmUnsupportedError("weakmap:new")`). That is the expected
  lane, not a caveat: the standing objective is a pure-C zapo binary with no
  embedded engine. Do not spend effort adding an LLVM arm.
- **A distinct `-o` DIRECTORY per build variant.** The intermediate is named
  from the ENTRY basename (`index.ts:770`), and `main.ts` deletes it on
  completion unless `--keep-c`, so two variants of one entry built into one
  directory pull the file out from under each other. A distinct output
  *filename* is not enough.
