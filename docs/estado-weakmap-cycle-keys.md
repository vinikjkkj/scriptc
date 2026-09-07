# WeakMap keys: where each kind dies, and which ones that admits

**Status: phases 1, 1b, 2, 3 and 4 are landed.** The collector hook exists —
one line at the top of `scr_cyc_free` — traced arrays are admitted with it,
and **`dyn` keys are admitted as of phase 4**, keyed on the payload. Read
the header comment of `packages/runtime/src/scr_weak.c` first; the
correctness argument lives there and is not repeated in full.

**All 20 WeakMap diagnostics in the zapo-js 1.8.2 arm are cleared.** The
last four needed the thing §3 said they needed and said was a bigger change
than phase 3 — it is, and it is phase 4. §3 is rewritten below to say what
it turned out to be.

| phase | keys | site | diagnostics | status |
|---|---|---|---|---|
| 1 | `Uint8Array` (`ScrBytes`) | `X25519.ts:116,117`, `xeddsa.ts:73` | 12 | **done** |
| 1b | `keyobj` as a container value | (same) | — | **done** |
| 2 | untraced arrays | `decoder.ts:87` | 4 | **done** |
| 3 | the collector hook + **traced** arrays | — | 0 | **done** |
| 4 | **`dyn`, keyed on the payload** | `encoding.ts:229` | **4** | **done** — §3 |

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

### 2d. A `ScrDyn` used as its own key — phase 4, and the route the rule almost missed

A dyn array or object built in dyn-land has no second representation, so
`scr_dyn_strict_eq`'s default arm answers `a == b` and the box IS the JS
value. It is `scr_cyc_alloc`'d, so §2c's stamp fits it — and §2c's hook does
**not** cover it, because a dead `ScrDyn` usually never reaches
`scr_cyc_free` at all.

`scr_dyn_release` at `--rc == 0` **PARKS** the node on a per-shape freelist,
up to `SCR_DYN_FREE_MAX` (8,192) deep, with its items/entries buffer intact;
`scr_dyn_alloc` pops it and hands the SAME ADDRESS back out. Three
consequences, and each is why the hook goes in `scr_dyn_release` rather than
being left to §2c:

- an entry surviving the park is read by the next node at that address —
  §1's wrong answer, on the shortest possible reuse cycle;
- `scr_cyc_stamp` never runs on the park route, so the mark would be
  inherited too. The hook clears it as it fires;
- **`SCR_RC_AUDIT` compiles the freelist out**, so the audit binary
  exercises the one route this hook does not exist for. `weak.test.ts`
  therefore builds `test_weak.c` twice; case 17 is behind
  `#ifndef SCR_RC_AUDIT`.

The collector's route into a dyn value (`scr_dyn_gcfree`) still ends at
`scr_cyc_free` and needed nothing.

**The general lesson is §4.3's, sharpened: "the free path" means every route
by which the storage becomes available again, and a cache of dead nodes is
one.** The three earlier kinds each had exactly one `free`, which is what
made the rule easy to state and easy to under-apply.

---

## 3. WHAT `encoding.ts:229` ACTUALLY NEEDED — phase 4

The spec's §3 asked, "what does TypeScript's bare `object` even map to
through `mapType`? Answer that before you decide." **`object` is the
`NonPrimitive` intrinsic and `mapType` lowers it to `DYN`**
(`frontend/types.ts`, beside `Unknown`). So `WeakMap<object, Uint8Array>`
is a **dyn-keyed** WeakMap, and the four diagnostics are the declaration,
the `new`, the `.set` and the `.get`.

The previous revision of this section concluded that the four therefore
stood on an upstream one-token change to
`WeakMap<readonly RawSignalSessionSnapshot[], Uint8Array>`, and recorded
the payload-keyed design as "a bigger change than phase 3". **The
conclusion was wrong and the estimate was right.** It is a bigger change,
and it is done: nothing upstream moved.

### The fact the old §3 was missing

**A dyn key cannot be keyed on its box** — that part stands, and
`scr_dyn_strict_eq` still says it in as many words: the box is a boundary
artifact, the JS value is the payload, and two boxes of one instance
compare `===`-equal. What the old §3 then inferred is what was wrong. It
reasoned that the static array `prevSessions` crossing into `dyn` produces
a fresh copy per crossing, so `set` and `get` in adjacent statements hold
two different boxes, so any table over them misses every lookup.

Both premises are true. **The copy is not anonymous.** `dynCopyIsObservable`
is true for exactly the lvalue spellings a caller still names, and at those
sites `lowerExprExpecting` emits not a bare conversion but

```c
scr_dyn_origin_mark(sc_td_0(rows), (void *)rows, "array<record:r0>",
                    scr_arr_retain_v, scr_arr_release_v)
```

— the copy **records the object it was made from**, retained for the copy's
lifetime, in the side table `scr_dyn_origin_take` already reads for the
identity recovery on the way back out (corpus 7480). So the payload of a
boundary-copied array is not the copy: it is the **origin**, the `ScrArr`
the caller still holds, which is the identity Node uses and the one the
program means. Two crossings of one array make two boxes and **one** key.

That is the whole difference between this and the width coercion
`weakKeyArgIsIdentity` refuses. A width-coerced record is a temporary that
names nothing; a boundary copy names its source.

**Measured, not argued.** Corpus 7787 sets through one box and reads
through another in the next statement, and prints `hit: 3 true` — matching
node byte for byte. Keyed on the box that line would print `hit: -1 false`
and the program would still exit 0, which is exactly why it is a corpus
line and not a comment.

### What phase 4 is, in three pieces

**1. The key stamp switches on the runtime kind.** `scr_weak_new` takes
`NULL` for a dyn-keyed table and `scr_weak_dyn_set/get/has` resolve each
value in `scr_weak_dyn_key`, one switch in which **every arm derives the
address and its stamp together**. That locality is what the
statically-chosen `key_mark` function pointer was buying (§4.1) and it is
the only property phase 4 gives up, deliberately: a dyn key's kind is not
knowable until it arrives. The array arm reads `elem_trace` **off the
object** to choose between `scr_arr_weak_mark` and `scr_cyc_weak_mark`, so
it is the trace fixpoint's own answer rather than a second guess at it —
strictly better than the emitter's `traceAdapterC` call for the static
array kinds.

**2. A fourth chokepoint, and it is one the spec's rule would have
missed.** A dyn `ARR`/`OBJ` built in dyn-land has no second representation,
so `scr_dyn_strict_eq`'s default arm answers `a == b` and the **box is the
value** — it keys on itself. But a dead `ScrDyn` is usually **PARKED on a
freelist**, not freed: `scr_dyn_release` pushes it onto a per-shape list up
to `SCR_DYN_FREE_MAX` (8,192) deep and `scr_dyn_alloc` hands the same
address straight back out, `scr_cyc_free` never involved. An entry
surviving the park would be read by the next node at that address — the
wrong answer this design exists to prevent. So the hook sits above **both**
of `scr_dyn_release`'s exits and clears the stamp as it fires, because
`scr_cyc_stamp` (which is what makes a recycled cycle block arrive clean)
does not run on the park route. The collector's route into a dyn value
(`scr_dyn_gcfree`) still ends at `scr_cyc_free` and needed nothing.

**3. `set()` refuses loudly; `get`/`has` do not.** That split is Node's,
measured on v25.9.0: `wm.set(1, v)` throws
`TypeError: Invalid value used as weak map key` while `wm.get(1)` answers
`undefined` and `wm.has(1)` answers `false`. A key the table can never hold
cannot be present, so only the write side has a lie to tell. Two refusal
families, and the difference is deliberate:

- **the primitives** (`null`, `undefined`, bool, number, **string**,
  bigint) get **Node's text verbatim**, because Node refuses them for the
  same reason this runtime does — there is no address. A string is refused
  even though `ScrStr` is a heap object: JS says a string is a primitive,
  and the arena interns and recycles them besides;
- **the kinds with an address this runtime cannot key on soundly** get
  their own text naming the kind and the reason, because Node's text would
  be a lie there — each is a perfectly good weak key in JS. A class
  instance, a closure, a native handle, a promise, an island value and a
  Map have no death this runtime observes on every route. A **record** or
  **tuple** boundary copy has one, but its origin is a record — the kind
  refused at the type level for width coercion. And an **ArrayBuffer** is
  refused for a reason of its own that is worth stating separately: its
  payload is deliberately the *same* `ScrBytes` a typed array over it
  holds, so one address would name two JS values that `===` tells apart by
  comparing the KIND first. This table has one `void *` per entry and the
  death hook is handed a bare address, so it has nowhere to put the kind.
  Not reachable today (`.buffer` is frontend-fenced — "no free-standing
  ArrayBuffer value exists", measured), but soundness would then rest on a
  frontend fence this file cannot see, which is the acyclic-class refusal's
  shape and gets its answer.

**And the refusal is split across compile time and run time on purpose.**
`weakKeyArgIsIdentity` refuses a key argument whose **static type already
answers** — a record, a class instance, a Map, a number — because a
diagnostic beats a throw whenever the type is enough to give one. Only what
arrives as a genuine `dyn` reaches the runtime switch. The admitted
argument kinds are exactly three: `dyn` (nothing happens), `bytes` (the
crossing SHARES the `ScrBytes`), and `array` (the crossing copies, and the
copy names its origin).

**THE COST, AND IT IS A REAL ONE.** `WeakMap<object, V>` used to ride the
strong identity Map, so a record- or class-instance-keyed call site
compiled and leaked. It now takes a diagnostic. That is the trade the rules
here name explicitly — refusing a safe key costs a diagnostic, admitting an
unsafe one is a wrong answer that ships green — and it is recorded in
`tests/diagnostics/weakmap-refused-keys.ts`, whose first case is now those
sites rather than `encoding.ts:229`. Note that the two SPELLINGS diverge as
a result: `WeakMap<Rec, V>` still compiles on the strong Map with its
documented leak, while `WeakMap<object, V>` refuses a `Rec` argument. That
is deliberate. A table declared over a record is a promise this runtime
cannot keep at all, so it is kept as a strong Map and written down; a table
declared over `object` is a promise it CAN keep for the payload kinds it
can watch die, so it keeps it and refuses the rest by name.

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

**Admitted: `bytes`, ANY array, and `dyn`.** The trace fixpoint no longer
decides admission — for the static array kinds it decides only which
**stamp** the emitter hands `scr_weak_new`: `scr_arr_weak_mark` (ScrArr's
own byte) for an untraced array, `scr_cyc_weak_mark` (the header bit) for a
traced one. Exactly one of the two hooks fires for any given array, because
the untraced arm never gets a header and the traced arm never sets
`ScrArr::weakkey` — pinned from outside by `test_weak.c` case 10. A `dyn`
key picks neither at compile time: `scr_weak_new` takes `NULL` and
`scr_weak_dyn_key` picks per value, reading `elem_trace` off the array it
just resolved.

**Still refused as a KEY TYPE, and no longer for want of the collector
hook:**

- **`record`.** Width-coerces. The type-level half of the hazard above.
  A record-keyed WeakMap still compiles, on the strong Map, with §7's leak.
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
- everything else (map, set, promise, func). No demand, and each owes its
  own value/ephemeron argument.

**Refused as a dyn ARGUMENT or PAYLOAD** — the same two kinds and their
neighbours, met again one level down, because admitting `dyn` as a key type
does not admit every value that can be one. The static half is
`weakKeyArgIsIdentity`, the runtime half is `scr_weak_dyn_key`, and §3 lists
both families with their reasons. The rule that decides every arm is
unchanged from §1: **an address, and a death the runtime observes on every
route.**

Refusing these costs **no reach for a record- or class-keyed table**: both
still compile, on the strong identity Map. It does cost reach for a
`WeakMap<object, V>` fed one of them — see the last paragraph of §3.


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

   **`dyn` is the one key type this cannot serve, and phase 4 replaces the
   pointer rather than weakening it.** A dyn key's kind is not knowable
   until the value arrives, so `scr_weak_new` takes `NULL` and the stamp
   moves into `scr_weak_dyn_key`, where **every arm derives the address and
   its stamp together from the same inspection**. That is what the function
   pointer was actually buying — "you cannot pick a stamp for a struct you
   did not just read the kind of" — enforced by locality instead of by
   type. If you add an arm there, derive both or neither; an arm that sets
   `k.addr` and leaves `k.mark` NULL crashes on the next `set`, which is
   the failure you want rather than a silent stray store.
2. **Check the padding, and be ready for the answer to be no.**
   `ScrBytes::weakkey` and `ScrArr::weakkey` rode padding that was already
   there. `ScrCycHdr` had none — see §2c.
3. **The death hook**, guarded by the flag, as the FIRST thing in the free
   path, before any storage is handed back. **"The free path" means every
   give-back route, and a freelist PARK is one** — phase 4's fourth
   chokepoint exists because a dead `ScrDyn` usually never reaches
   `scr_cyc_free` at all. Before adding a kind, find every place its
   storage becomes available again, not just the one named `free`.
3b. **If the kind can REFUSE, register the throw in `computeMayThrow`.**
   `scr_weak_dyn_set` is the first throwing map intrinsic, and the emitter
   places a caller-side `scr_exc_pending()` check only for callees the
   analysis marked. Skipping this does not fail loudly: the throw unwinds
   the frame it happened in and the caller carries on with it pending. See
   Trap 7.
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

**Trap 5 — the collector paces itself off the candidate-root buffer.**
A "the key is still alive before I collect" assertion can be defeated by an
*earlier unrelated case* pushing the buffer over the threshold. Drain with
`scr_collect_cycles()` first, or the assertion that separates the collector
path from the release path silently stops separating them.

**Trap 6 (phase 4) — A DYN NODE'S KIND DOES NOT TELL YOU WHAT ITS ORIGIN
IS.** `dynCopyIsObservable` answers true for `array` and `record` and
nothing else, and the crossing lowers an array to `SCR_DYN_ARR` and a record
to `SCR_DYN_OBJ` — so "an ARR node's origin is an `ScrArr *`" reads like a
theorem. **It is false for a TUPLE**, which is an IR *record* whose to-dyn
converter builds `scr_dyn_new_arr()` (`emit-walkers.ts`, the record arm's
`if (shape.tuple)`). Phase 4 carried that invariant in a comment for one
afternoon before a review caught it; it was then *compiled* rather than
argued, which is what turned a plausible objection into a fact.
`const t: [number, string] = [1, "a"]` passed to a function taking `object`
emits

```c
static ScrDyn *sc_td_0(sc_rs_r0 *v) { ScrDyn *d = scr_dyn_new_arr(); … }
…
scr_dyn_origin_mark(sc_td_0(sc_t6), (void *)sc_t6, "record:r0", …)
```

— an ARR node whose origin is a record struct. Casting it to `ScrArr *`
reads `elem_trace` at offset 48 of a record and stamps offset 28, or writes
sixteen bytes *before* a calloc'd acyclic record. **Trap 3 exactly,
re-entered through the one kind pair where the node and its origin
disagree**, and `weakKeyArgIsIdentity` cannot stop it because the crossing
happens at a different call site than the `set`:

```ts
function put(k: object, v: Uint8Array) { cache.set(k, v) }  // k is dyn: admitted
put(t, bytes)   // `t` crosses HERE, and this is not a key position
```

The fix is to ask the ORIGIN what it is, not the box: `scr_dyn_origin_peek`
reports `is_array` from the entry's recorded **release function**
(`release == scr_arr_release_v`), which is the function that will actually
free the object and therefore *is* the statement "this is an ScrArr". Every
array type gets that exact pair from `rcAdapters` unconditionally, so the
test is total; if the adapters are ever renamed the answer becomes NULL and
the caller refuses, which is a cache miss rather than a stray store. Pinned
by `test_weak.c` case 15's tuple arm, which stands the shape up with a
non-array release adapter and requires the refusal.

**Trap 7 (phase 4) — A NEW THROW MUST BE REGISTERED IN `computeMayThrow`,
or it is swallowed at the call boundary.** `scr_weak_dyn_set` is the first
throwing `mapIntrinsic`, and the emitter places a caller-side
`scr_exc_pending()` check only for callees the analysis marked. Without the
`mapIntrinsic` arm in `may-throw.ts` the `put` helper above unwound
correctly *inside itself* and its caller carried on with the exception still
pending: the program printed a cache MISS and **exited 0** where it owed a
TypeError. That is the failure shape `may-throw.ts`'s own header describes
one paragraph up, and it is invisible to every test that does not check the
exit code. get/has are deliberately NOT registered — the read side answers
undefined/false silently, which is what Node does.

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

**Phase 4 does not reach one either, and the answer is the same one turned
around.** A dyn-keyed table holds the same strong value slot, so the same
argument applies unchanged: the v-adapters register no trace, so a weakmap
value can never be white, so the new hook in `scr_dyn_release` is as safe
inside a teardown as `scr_cyc_free`'s is. It also inherits the same
obligation: `prevSessionsSuffixCache`'s value is still a fresh
`Uint8Array`, and it never reaches the array that keys it.

---

## 7. Known live defect, narrowed

A WeakMap keyed by a **class instance** or a **record** still rides the
strong identity Map and retains its keys. It predates all of this work. In
the 1.8.2 tree that is `media.ts:478` and `ffmpeg.ts:40` (both
`Logger`-keyed, so records) and `FakeWaServer.ts:193` (a class instance).

The collector hook these were waiting on has landed and it was not enough
for either — see §3. **Phase 4 did not free them either, and it is worth
saying why not, because it looks as if it should have.** A dyn-keyed table
resolves its key at run time, and at run time a record boundary copy DOES
name its origin — so the address is available. What is not available is a
FIELD TO STAMP: a record has no `weakkey` byte and an acyclic one has no
cycle header, so nothing can be marked and no free path would consult the
registry. The origin table gave phase 4 an identity for arrays; it gives
records an identity they still cannot be watched by. Those sites are also
declared over `Logger` and a class, not over `object`, so they never reach
the dyn lowering at all.

The note in `frontend/types.ts` narrows to those two kinds and stands until
each has its own answer:

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

- **`packages/runtime/test/test_weak.c`** — 80 checks, covering all four
  admitted key types. Cases 10-12 are phase 3's: the stamp lands in the
  header and *not* in `ScrArr::weakkey`, a key held only by a **cycle** is
  spliced when `scr_collect_cycles` reclaims it, and a recycled cycle block
  neither inherits the dead value nor the dead stamp. Case 11 is the only
  thing in the tree that tests the collector route at all — nothing a
  compiled program can write makes a collection happen at a point it can
  then look at. Cases 13-17 are phase 4's: two boxes of one payload are one
  key, a boundary copy keys on its **origin** and an untraced origin takes
  a different stamp from a traced one, a refused `set` **inserts nothing**
  (asked on the RAW address, because the `_dyn` read refuses the same kinds
  and would answer false without consulting the table), a TUPLE-shaped
  origin is refused rather than stamped (ARMED: reintroducing the bug turns
  that case red), and a dyn box keys on itself. The reuse cases *report*
  when the allocator did not recycle rather than passing quietly; keep that.

  **`weak.test.ts` builds the source TWICE and the second build is not
  redundant.** `SCR_RC_AUDIT` compiles the ScrDyn freelist out, so the
  audit binary exercises exactly the route the park hook does *not* exist
  for; case 17 is behind `#ifndef SCR_RC_AUDIT` and runs only in the plain
  one. `scr_json.c` is on both link lines because a dyn key's identity
  lives there (`scr_dyn_origin_peek`), and it is always linked in a real
  binary, so this is the same link set a compiled program has.
- **Corpus 7782** (bytes), **7785** (untraced arrays), **7786** (traced
  arrays) and **7787** (`WeakMap<object, …>`) are the in-language
  differentials. None can observe weakness — that is the point, and it is
  why the C test exists. 7786 puts all three static stamps in one TU; 7787
  puts three payload provenances (a shared `ScrBytes`, an array origin, a
  dyn-land box) into one table and checks the runtime refusals' **messages**
  against node's, which is the half no C test can pin.
- **`tests/diagnostics/weakmap-refused-keys.ts`** pins the refusals: the
  key ARGUMENTS a dyn-keyed table refuses by static type (a record, a class
  instance, a Map), a key argument the lowering would have to copy, a
  scalar value, and the surface a weak table cannot answer. Its first case
  used to be `encoding.ts:229` itself; that now compiles and is corpus
  7787. It replaces `weakmap-traced-array-key.ts`, whose headline cases are
  admitted.
- **`SCRIPTC_RC_AUDIT=1`** on every new corpus program. Clean on 7787 (exit
  0, not 99).
- **The whole corpus, because the park hook is in an always-linked file and
  every program that releases a dyn value now runs it.** Grepping emitted C
  would read zero by construction for a runtime-side change, so the reach
  was measured by RUNNING it: `tests/harness/differential.test.ts`,
  **1,856 program lines, 0 failure markers** (counted off the log --
  1,857 check marks, and `x`/`FAIL`/`failed` all zero -- rather than taken
  from the exit code).
- **Backends.** WeakMap has no LLVM lowering, so a WeakMap program demotes
  to the C backend (`LlvmUnsupportedError("weakmap:new")`). Expected lane.
- **Size class.** `scr_cycle.c` is always linked, so a change there moves
  every program. Phase 3 did not: static 676,864 and regex 818,688,
  **byte-for-byte identical** between the branch and its base (binaries
  differ in content, so the rebuild was real). zig 0.16.0,
  `x86_64-windows-gnu`. The bit fitted in `blk`'s existing slack and the
  hook fitted in existing padding.

  **Phase 4 costs +0 static and +512 regex**, and where the bytes went is
  the point. `scr_weak.c` is GATED on `moduleUsesWeakMap`, so all 250 lines
  of the dyn switch and its refusal texts are free to a program with no
  WeakMap — the entire phase was written into that file for exactly this
  reason, even though `ScrDyn` lives elsewhere. What is always-linked is the
  two additions to `scr_json.c` -- `scr_dyn_origin_peek` and the park hook,
  about twenty lines of code under seventy of comment. The park hook is one
  already-loaded bit test on the hottest release path in the runtime.

  A/B on one box with a **separate `SCRIPTC_CACHE_DIR` per variant** (or
  the second build reuses the first's runtime objects and the delta reads
  zero by construction), zig 0.16.0,
  `SCRIPTC_TARGET=x86_64-windows-gnu`, base and head each measured twice
  and byte-stable:

  |  | static | regex |
  |---|---|---|
  | base (`7adee17b`) | 677,888 | 818,688 |
  | head | 677,888 | 819,200 |
  |  | **+0** | **+512** |

  **THE CODE GREW BY THE SAME AMOUNT IN BOTH, and the +512 is carry.**
  Section by section the two programs agree to the byte — `.text` +208,
  `.rdata` +8, `.pdata` +12 — and all 208 bytes are `scr_json.c`. Compiled
  alone its `.text` goes 122,240 → 122,448, and removing one addition at a
  time splits it exactly: **`scr_dyn_origin_peek` 176 bytes**, **the hook in
  `scr_dyn_release` 32 bytes** (a bit test, a clear, and one indirect call).
  `scr_weak.c` grew by 316 lines and costs both programs nothing, because
  neither constructs a WeakMap and `opts.weak` keeps the unit off the link
  line — checked rather than assumed, and positive-controlled, because a
  byte scan that only ever answers zero has proved nothing: three strings
  the kind switch cannot run without appear ONCE each in corpus 7787's
  binary and ZERO times in either size-class program.

  What differs is only the PE file alignment's slack. In the base tree the
  static program's `.text` ends 474 bytes below its 512-byte boundary and
  the regex program's ends 42 below: +208 fits in one and not the other, so
  the static image keeps every section's file offset and the regex image
  shifts the five sections after `.text` by one unit. Deriving either
  class's delta from the other's here would be 512 bytes wrong.

  Both keep 7,168 bytes under `STATIC_CLASS_MAX`/`REGEX_CLASS_MAX`. The two
  recorded figures are now treated DIFFERENTLY, once the base drift beside
  them was bisected. The
  static class was 677,376 at `874e78b8` and at `37781755` — reproducing
  the recorded entry to the byte — and 677,888 from `036479ce` onward: the
  `%ReferenceError` prototype fix, 48 bytes of always-linked `scr_json.c`,
  which landed one commit AFTER the size entry was written and so was never
  weighed. The regex class was 818,688 at all four revisions, so it never
  moved at all and its recorded 818,176 simply does not reproduce on this
  configuration. So the STATIC figure is now anchored at 677,888 — growth,
  explained, with a named commit — and the REGEX figure is deliberately
  left at 818,176, because anchoring it would record a discrepancy as if
  it were growth.

  The two changes are mirror images, which is the arithmetic to keep: 48
  bytes carried the static file 512 and left regex alone, 208 bytes carried
  the regex file 512 and left static alone, because slack under the
  512-byte boundary was 10/90 at one revision and 474/42 at the next.
  Neither class's file delta is its code delta.
  `tests/harness/size-class.ts` carries the full entry.
- **A distinct `-o` DIRECTORY per build variant.** The intermediate is named
  from the ENTRY basename and is deleted on completion unless `--keep-c`, so
  two variants of one entry built into one directory pull the file out from
  under each other.
