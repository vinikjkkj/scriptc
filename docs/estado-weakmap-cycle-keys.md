# WeakMap keys: where each kind dies, and which ones that admits

**Status: phases 1, 1b, 2 and 3 are landed.** The collector hook exists —
one line at the top of `scr_cyc_free` — and traced arrays are admitted with
it. Read the header comment of `packages/runtime/src/scr_weak.c` first; the
correctness argument lives there and is not repeated in full.

**16 of the 20 WeakMap diagnostics in the zapo-js 1.8.2 arm are cleared, and
the remaining 4 are not the ones phase 3 was expected to clear.** See §3.

| phase | keys | site | diagnostics | status |
|---|---|---|---|---|
| 1 | `Uint8Array` (`ScrBytes`) | `X25519.ts:116,117`, `xeddsa.ts:73` | 12 | **done** |
| 1b | `keyobj` as a container value | (same) | — | **done** |
| 2 | untraced arrays | `decoder.ts:87` | 4 | **done** |
| 3 | the collector hook + **traced** arrays | — | 0 | **done** |
| — | `encoding.ts:229` | `WeakMap<object, …>` | **4** | **needs an upstream one-token change** — §3 |

---

## 1. The rule that decides everything

A WeakMap entry is keyed by **address**, and the string and cycle arenas
recycle addresses aggressively. An entry that outlives its key is therefore
not a leak — it is a **wrong answer**: a later object landing on the dead
key's address finds the dead key's value.

A key kind may be admitted **only if the runtime observes its death at a
point it owns, before the storage is handed back — on every route the value
can die by.** Not "has a stable identity", and not "has one *common* death
path". The second clause is what phase 3 turned out to be about twice over.

---

## 2. Where each kind dies

### 2a. `ScrBytes` — phase 1

`scr_bytes_release` at `--rc == 0`. Not a cycle node. One route.

### 2b. Untraced arrays — phase 2

`scr_arr_new_ref` routes through `scr_cyc_alloc` **only when `elem_trace` is
non-NULL**; otherwise plain `malloc`, and `scr_arr_release` mirrors it with a
`free(a)` that never reaches `scr_cyc_free`. One route.

### 2c. Cycle-headered objects — phase 3, and the hook is where the spec said

Two routes that **converge**:

- ordinary release to zero: `scr_arr_release` → `scr_arr_gc_free(a)` →
  `scr_cyc_free(a)`;
- the collector: `scr_collect_cycles` walks its white list and calls
  `scr_cyc_free_of(scr_cyc_hdr(obj))(obj)` — the per-type `gc_free` — which
  also ends in `scr_cyc_free(obj)`.

Both end at **`scr_cyc_free(void *obj)`**. `arenafree`'s rewrite moved it
(it is no longer at line 449) and restructured everything under it into a
provenance route — carved block to its chunk, else pool, else `free` — but
the convergence argument is untouched: the hook sits above all three
give-backs and the collector's call site is `scr_cyc_free_of` exactly as
before.

```c
void scr_cyc_free(void *obj) {
  scr_cyc_live--;
  ScrCycHdr *h = scr_cyc_hdr(obj);
  if ((h->blk & SCR_CYC_WEAKKEY) != 0 && scr_weak_died_hook != NULL) {
    scr_weak_died_hook(obj);           /* <-- here, above every give-back */
  }
  if (h->pad != 0) { ... scr_cyc_ar_give(h); return; }   /* arena  */
  if (cls != 0 && scr_pool_give(...)) { ... return; }    /* pool   */
  free(h);
}
```

**The stamp is a bit in `ScrCycHdr::blk`, and §4.2's check came back
negative.** The spec said to add a bit and verify `sizeof` was unchanged.
There is **no padding in `ScrCycHdr`**: it is exactly 16 bytes with all six
fields assigned (4+4+1+1+1+1+4), and the one byte that used to be slack —
`pad` — is now `arenafree`'s block→chunk offset. Growing it costs 8 bytes
on every cycle-headered object, because 16 is the last size that keeps the
object pointer 16-byte aligned. So the bit rides `blk`'s top: `blk` holds
the pool size class, whose range is `[0, SCR_POOL_MAX/SCR_POOL_GRAIN]` =
`[0, 32]` — six bits — and it is written in exactly one place,
`scr_cyc_stamp`, once per allocation. `color`, `buffered` and `buf_index`
are all written on hot paths by single-instruction stores that a packed
flag would turn into read-modify-writes, which their own comments forbid.
A `_Static_assert` guards the range, and every read of the class masks.

Two consequences worth keeping:

- **The unconditional NULL test the spec offered was not taken, and should
  not be.** For `ScrBytes` and `ScrArr` the per-object mark means only a
  real key pays the registry walk; without a mark here, *every* cycle-object
  free in a program that owns any WeakMap would walk it. zapo owns three and
  frees cycle objects by the million during a history sync.
- **The stamp is cleared on reuse, and that half is mandatory.**
  `scr_cyc_stamp` rewrites `blk` wholesale at every allocation, so a block
  coming back out of the pool or the arena arrives clean. `ScrBytes` and
  `ScrArr` keep their mark for life because their storage is malloc'd
  afresh; a recycled cycle block is the case that argument does not cover.

`sizeof` probe against the edited header, zig 0.16.0,
`x86_64-windows-gnu`: `ScrCycHdr=16 ScrArr=64 ScrBytes=40` — all unchanged.

---

## 3. WHAT `encoding.ts:229` ACTUALLY NEEDS — and it is not this

The spec's §3 asked, "what does TypeScript's bare `object` even map to
through `mapType`? Answer that before you decide." The answer changes the
whole shape of the question.

**`object` is the `NonPrimitive` intrinsic and `mapType` lowers it to
`DYN`** (`frontend/types.ts`, beside `Unknown`). So
`WeakMap<object, Uint8Array>` is a **dyn-keyed** WeakMap. It is not a
record-keyed one, and the record/width-coercion argument the spec framed as
blocking is *moot for this site*. The four diagnostics are the declaration,
the `new`, the `.set` and the `.get` — reproduced exactly.

And what the site actually passes is an **array**. zapo-js 1.8.2,
`src/signal/session/encoding.ts`:

```ts
const prevSessionsSuffixCache = new WeakMap<object, Uint8Array>()
...
let suffix = prevSessionsSuffixCache.get(prevSessions)   // readonly RawSignalSessionSnapshot[]
```

`SignalSessionRecord.prevSessions` is
`readonly RawSignalSessionSnapshot[]`. The doc comment above the function
says the cache is "per array instance". The bare `object` is a spelling
convenience, not an intent.

**A dyn key cannot be keyed on its box, and that is not a limitation to
work around — it is a wrong answer.** `scr_dyn_strict_eq` says so
explicitly: the box is a boundary artifact and the JS value is the
*payload*; two boxes of one instance compare `===`-equal. An address-keyed
table over boxes would miss every lookup a program makes. **A silently
useless cache is not an acceptable outcome**, so `dyn` is refused with the
reason named in the hint.

**So `encoding.ts:229` closes on a one-token upstream change**, from
`WeakMap<object, Uint8Array>` to
`WeakMap<readonly RawSignalSessionSnapshot[], Uint8Array>` — the type the
call sites already hold and the doc comment already describes. That key
kind is admitted as of this phase. zapo's source is not ours to edit, so
the four stay open and are recorded here as *what it takes*, not as a wall.

### The blocking design question, resolved

The spec's three candidates were (a) admit records only where no coercion
can occur and prove it at the set/get sites, (b) admit only nominal class
instances, (c) establish that the lowering never coerces a weak key.

**Taken: (a), relocated to the site where the copy would actually be
inserted.** The hazard is not a property of the key *kind*, it is a property
of the key *argument position* — and `lowerExprExpecting` inserts the
coercion at exactly one place per weak-map method. So `weakKeyArgIsIdentity`
(`lower-containers.ts`) discharges the obligation there: the argument's own
mapped type must be `typeEquals` to the map's key type, or the site is
refused by name. One mapped type against another; no fixpoint, no
whole-program reasoning.

- **(c) is provably false**, and that is worth stating rather than leaving
  as an open option. `widthCoerce` has a record→record arm *and an
  array→array arm* (`arrayWidthHelper`). The spec's §3 discussed only
  records; **phase 2 shipped untraced-array keys with the array arm
  unguarded**, and this check closes that gap as well as the one it was
  written for. The array copy is *measured*: a function taking
  `readonly Wide[]`, called twice with the same `readonly Narrow[]`
  binding, receives two different arrays — scriptc answers `false` to
  `first === second` where node answers `true`. The strong-Map version of the failure is a recorded
  measurement, not a hypothesis — corpus m32, where `m.set(k1,"a");
  m.get(k1)` answered `undefined` (see the inferred-key fence in
  `lower-classes.ts`).
- **(a) as originally posed — proving it at admission — is not available.**
  Admission happens in `mapType`, a pure type→type function that cannot see
  a call site; the sites can be in other functions and other modules. This
  is the same reason `isNeverTracedElem` was a hand-written list.
- **(b) is rejected on its own terms**: class instances are *not* uniformly
  safe here. See below.

### What is admitted, and what is still refused

**Admitted: `bytes`, and ANY array.** The trace fixpoint no longer decides
admission — it decides only which **stamp** the emitter hands
`scr_weak_new`: `scr_arr_weak_mark` (ScrArr's own byte) for an untraced
array, `scr_cyc_weak_mark` (the header bit) for a traced one. Exactly one
of the two hooks fires for any given array, because the untraced arm never
gets a header and the traced arm never sets `ScrArr::weakkey` — pinned from
outside by `test_weak.c` case 10.

**Still refused, and no longer for want of the collector hook:**

- **`record`.** Width-coerces. The type-level half of the hazard above.
- **`object` (a class instance).** *Not* for coercion — `upcast`/`downcast`
  are pointer reinterprets that copy nothing, so (b)'s premise holds. It is
  refused because **an acyclic class is emitted with `calloc` and a lean
  one-word header** (`emit-shapes.ts`: `s.traced ? scr_cyc_alloc : calloc`)
  and therefore never reaches `scr_cyc_free` at all. Which classes those are
  is `CEmitter`'s module-level fixpoint. Admitting the kind would mean
  admitting a value whose safety depends on a fixpoint the predicate cannot
  reach — the exact thing the under-approximation rule forbids. Unlike the
  array case the emitter cannot rescue it, because there is no second stamp
  to pick: a headerless class instance has **no** field to mark.
- **`dyn`.** §3 above.

Refusing these three costs **no reach**: all of them still compile, on the
strong identity Map. What they keep is the leak in §7, narrowed.

---

## 4. How to add a key kind — the mechanics

1. **A per-kind stamp.** `ScrWeakMap` holds a `key_mark` function pointer
   supplied at construction. It is a pointer and not a switch because **the
   mark lives in a different struct field per kind, so a shared stamp would
   be a stray store into whichever struct it guessed wrong.**
   `scr_cyc_weak_mark` is shared across cycle-headered kinds and that is not
   an exception to the rule but the point of it: the field it writes is in
   the *header*, at a fixed negative offset from every `scr_cyc_alloc`'d
   object and from no other. Handing it a headerless value is precisely the
   stray store the rule forbids, which is why the emitter picks from the
   real fixpoint.
2. **Check the padding, and be ready for the answer to be no.**
   `ScrBytes::weakkey` and `ScrArr::weakkey` rode padding that was already
   there. `ScrCycHdr` had none — see §2c.
3. **The death hook**, guarded by the flag, as the FIRST thing in the free
   path, before any storage is handed back.
4. **`isSupportedWeakKey`** in `ir/nodes.ts`, plus
5. **an emitter cross-check.** The predicate is a pure `IrType` function and
   cannot reach `CEmitter.traceAdapterC`, a MODULE-level fixpoint. It used
   to under-approximate and the emitter threw on disagreement; now the
   emitter *selects* from the fixpoint instead. **Both halves still matter,
   and `tests/diagnostics/weakmap-refused-keys.ts` pins the refusals from
   outside — a predicate tested only on what it accepts is untested.**

---

## 5. The traps, so they are not rediscovered

The first two were caught by `SCRIPTC_RC_AUDIT=1` on corpus 7782 against a
strong-Map control that exited clean. Both are invisible to every functional
test: output stays byte-exact against node while memory grows.

**Trap 1 — a container kind missing from `isRefCounted` emits no release at
all.** `weakmap` was absent: 43 live objects at exit.

**Trap 2 — the value ownership convention must match the emitter.**
`scr_map_set_*_ref` TAKES ownership so the C emitter does `E.moveTemp(v)`;
`scr_weak_set` RETAINS its own, so the weak arm must **not**.

**Trap 3 — a shared key stamp is a stray store.** See §4.1.

**Trap 4 (new) — `scr_arr_push_ref` MOVES ownership in.** Building a test
cycle with `push_ref(a, b); push_ref(b, a)` builds a *chain*: releasing `b`
frees it, its teardown releases `a` to zero, and the entry is spliced by the
ordinary release path with the collector never involved. That is a case-10
pass wearing case 11's name. Retain explicitly.

**Trap 5 (new) — the collector paces itself off the candidate-root buffer.**
A "the key is still alive before I collect" assertion can be defeated by an
*earlier unrelated case* pushing the buffer over the threshold. Drain with
`scr_collect_cycles()` first, or the assertion that separates the collector
path from the release path silently stops separating them.

Run the audit on any new corpus program: `SCRIPTC_RC_AUDIT=1 scriptc build
prog.ts`, then run it; exit 99 is a leak. Measure on an entry that RETURNS —
`process.exit()` skips the `atexit` handler.

---

## 6. Still not implemented, in any phase: ephemerons

Values are held **strongly**, so a value that can reach its own key keeps
both alive. Real WeakMap semantics need the collector to treat the table as
an ephemeron edge.

**Phase 3 does not make an ephemeron case reachable that was not before**,
and the reason is worth writing down because it is also what makes the new
hook safe inside the collector's free loop. The weakmap v-adapters register
**no trace** (`emit-types.ts`), so `markGray` never decrements a value's
refcount for the table's reference, so `scan` always sees `rc > 0` and
blackens it: **a weakmap value can never be white.** That is why dropping an
entry from inside `scr_collect_cycles`'s teardown loop cannot touch a
white, already-accounted edge — the one thing that loop's own comment says
teardowns must not do. Adding a trace over the values alone would be the
first half of ephemeron support, the wrong half on its own, and it would
break this argument at the same time.

Verified that the non-ephemeron rule is exact for the new site too:
`prevSessionsSuffixCache`'s value is a fresh `Uint8Array` out of
`RecordStructure.encode(...).finish()` and never reaches the array that keys
it. **Re-check it for every new WeakMap.** Nothing automates it.

---

## 7. Known live defect, narrowed

A WeakMap keyed by a **class instance** or a **record** still rides the
strong identity Map and retains its keys. It predates all of this work. In
the 1.8.2 tree that is `media.ts:478` and `ffmpeg.ts:40` (both
`Logger`-keyed, so records) and `FakeWaServer.ts:193` (a class instance).

The collector hook these were waiting on has landed and it was not enough
for either — see §3. The note in `frontend/types.ts` narrows to those two
kinds and stands until each has its own answer:

- **records** need the coercion question answered at the *type* level, or a
  guarantee that a record weak key is never reshaped. The site check in
  `weakKeyArgIsIdentity` is most of the machinery; what is missing is the
  argument for why refusing the coercing sites is better than refusing the
  type, given a record-keyed WeakMap compiles today.
- **class instances** need the acyclic case to have a chokepoint. Two
  routes: give a weak-keyed class a cycle header (the emitter can see which
  classes are weak-map key types, but forcing `traced` also changes the
  release path and the collector's view of the class), or emit a `weakkey`
  field plus a hook line in the acyclic class's own `release` — a per-class
  cost paid only by classes used as keys.

---

## 8. How to verify

- **`packages/runtime/test/test_weak.c`** — 45 cases, covering all three
  admitted key kinds. Cases 10-12 are phase 3's: the stamp lands in the
  header and *not* in `ScrArr::weakkey`, a key held only by a **cycle** is
  spliced when `scr_collect_cycles` reclaims it, and a recycled cycle block
  neither inherits the dead value nor the dead stamp. Case 11 is the only
  thing in the tree that tests the collector route at all — nothing a
  compiled program can write makes a collection happen at a point it can
  then look at. The reuse cases *report* when the allocator did not recycle
  rather than passing quietly; keep that.
- **Corpus 7782** (bytes), **7785** (untraced arrays), **7786** (traced
  arrays) are the in-language differentials. None can observe weakness —
  that is the point, and it is why the C test exists. 7786 also puts all
  three stamps in one TU.
- **`tests/diagnostics/weakmap-refused-keys.ts`** pins the refusals,
  including the `WeakMap<object, …>` shape verbatim from `encoding.ts:229`
  and a key argument the lowering would have to copy. It replaces
  `weakmap-traced-array-key.ts`, whose headline cases are now admitted.
- **`SCRIPTC_RC_AUDIT=1`** on every new corpus program.
- **Backends.** WeakMap has no LLVM lowering, so a WeakMap program demotes
  to the C backend (`LlvmUnsupportedError("weakmap:new")`). Expected lane.
- **Size class.** `scr_cycle.c` is always linked, so a change there moves
  every program. This one does not: static 676,864 and regex 818,688,
  **byte-for-byte identical** between the branch and its base (binaries
  differ in content, so the rebuild was real). zig 0.16.0,
  `x86_64-windows-gnu`. The bit fitted in `blk`'s existing slack and the
  hook fitted in existing padding.
- **A distinct `-o` DIRECTORY per build variant.** The intermediate is named
  from the ENTRY basename and is deleted on completion unless `--keep-c`, so
  two variants of one entry built into one directory pull the file out from
  under each other.
