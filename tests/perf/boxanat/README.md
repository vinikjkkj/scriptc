# `boxanat` — the anatomy of a value boxed into an `unknown` slot

`2,794 bytes per retained value` was measured on one workload. It says the
boxes are expensive; it does not say **where the bytes go**, and a
representation change cannot be argued from a single scalar. This lane reads
the anatomy off the artifact the compiler emitted, and validates the model
against a physical measurement.

## Which zapo, and which figures depend on it

**Every claim about zapo source names its arm.** Two conclusions in this
investigation have already turned on it, and the wrong version was convincing
both times.

| figure | arm | version |
|---|---|---|
| 1,905 / 1,904 converters, 1,158 copying, 747 by reference, 218 cyclic | `app182` | zapo-js **1.8.2** |
| median 304 B, mean 3,142–3,143 B, max 92,992 B | `app182` | **1.8.2** |
| the 88–90 member app-state mutation shapes | `app182` | **1.8.2** |
| 26,469 crossings, 88 origin-marked, 16,023 entries-array writes | `app182` | **1.8.2** |
| the 178 `unknown` slots outliving their statement | provenance `757a8071b819` | **1.8.2** |

Both artifacts read here are 1.8.2 — the `.ll` from another block's rig and
the `.c` built in this one — confirmed by the entry path recorded in each.

**The settled-memory figures this objective started from are `app/`, which is
zapo-js 1.6.2**: 2,794 B per retained value, 163.39 → 104.50 MiB, the 105.14
MiB the census itemised. 1.6.2 downloads and decodes a history blob whole;
1.8.2 streams proto fields. They are different programs with different sync
architectures.

**So the mean of 3,143 B is NOT "an independent bracket on the 2,794".** That
claim, made in an earlier revision of this file, crosses an arm boundary: it
compares a 1.8.2 converter graph against a 1.6.2 heap. The agreement in order
of magnitude is worth noting and nothing more, and it is withdrawn as
corroboration.

**What does NOT depend on the arm**: the anatomy of a box, the cost model and
its 784 B validation, the three divergences (`rt1`, `snap2`, `cyc1`/`cyc2`),
and the 140-site audit. Those are properties of the **compiler and the
runtime**, and they hold for any program either arm compiles.

`narrowcensus.mjs` is about **the compiler's behaviour**, and it has no zapo
reading yet. If its result is ever used to argue about the measured
retention, it has to be taken on **1.6.2** — the arm those numbers came from.
A slot that is narrowable in one version and not the other is a finding to
name, never a union to take silently.

## What a crossing actually emits

A static value flowing into an `unknown` slot is lowered to `dynFrom`, and
both backends emit the same thing for it: a call to the per-type converter
`sc_td_<n>` (`emit-walkers.ts`'s `toDynHelper`, and `llvm/dyn.ts`'s
line-for-line port), optionally wrapped in `scr_dyn_origin_mark` when the
source is an lvalue the program still names.

Six kinds box **by reference** — string, bytes/ArrayBuffer, Map/Set, bigint,
promise, closure, class instance. Their payload is the same object on both
sides and the crossing costs only the node that names it.

**Arrays and records COPY**, because their two representations are physically
different memory (a packed `ScrArr` / a C struct against a `ScrDyn**` vector /
a `ScrDynEntry` table). And the copy is **transitive**: `sc_td_` recurses into
every field, so a record's dyn image is **one 64-byte heap node per scalar
anywhere in the reachable tree**, plus a table per composite. A wrapper whose
payload "lives elsewhere" does not box as a wrapper — it boxes as the whole
subtree.

## The cost model, and where each constant comes from

| term | bytes | source |
|---|---|---|
| a dyn node | 64 | `ScrCycHdr` 16 + `ScrDyn` 48, `scr_pool_bytes` grain 8 |
| an OBJ member table | `cap * 24` | `sizeof(ScrDynEntry)`; `cap` is 1 for one member and the next power of two above that (`SCR_DYN_OBJ_FIRST_CAP` is 1, then doubling) |
| an ARR items vector | `cap * 8` | same capacity rule, `SCR_DYN_ARR_FIRST_CAP` 1 |
| a malloc block | `(n + 8)` up to 16 | `tests/perf/dyncensus/mallocgrain.c`, measured for `x86_64-windows-gnu` |
| the origin slot | 45.7–91.4 | `sizeof(ScrDynOriginEnt)` 32 in a power-of-two table under a 0.7 load factor. **Root only** |

**The origin also holds a strong reference to the source** for the box's whole
life (`scr_json.c`'s `dyn_origin_tab`: "the static origin, RETAINED for the
copy's lifetime"), so such a crossing retains **both** representations.

**But it is rare, and an earlier revision of this file overstated it.** The
mark is emitted only where `dynCopyIsObservable` holds — the operand must be
an lvalue the program still names. Counted on the artifact (`app182`, 1.8.2):
**88 `scr_dyn_origin_mark` call sites against 26,469 crossings, 0.33%.** The
mechanism is real and it doubles the cost of the crossings that carry it; it
is not a term on the typical box, and "it doubles the honest cost of every
retained box" is withdrawn.

`sizeof(ScrDyn)` is **48**, not the 104 the comment above `ScrRva` in
`scr_runtime.h` still names; that comment is stale.

## The validation

`anat1.ts` retains 1,000 boxes of

```ts
{ id: string; n: number; inner: { a: number; b: string }; tags: string[] }
```

with the sources alive in a parallel typed array, so the dyn population *is*
the boxes. `anat0.ts` is the same program with the boxing removed.

Build both with `tests/perf/dyncensus` linked in:

```sh
SCRIPTC_PROF_CFLAGS="-include <win>/tests/perf/dyncensus/scr_dyn_census.h \
                     -I<win>/tests/perf/dyncensus -DSCR_DYNCEN_ARM=64"
node packages/cli/dist/main.js build tests/perf/boxanat/anat1.ts -o <out>/anat1.exe --backend c --keep-c
SCR_DYNCEN_OUT=<out>/anat1.txt <out>/anat1.exe
node tests/perf/dyncensus/dyncensus.mjs <out>/anat1.txt
```

At the snapshot the census holds **996** boxes and reports:

```
8,963 live ScrDyn x 64 B                       = 573,632   ScrDyn blocks
OBJ entries buffers                              175,296   physical (143,424 requested)
ARR items buffers                                 40,048   physical ( 24,112 requested)
```

Subtracting the one cap-1024 items buffer that belongs to the `boxes`
container rather than to any box (8,208 B physical), per box:

| | nodes | bytes |
|---|---|---|
| OBJ (root + `inner`) | 2 x 64 | 128 + 176 table = 304 |
| NUM (`n`, `inner.a`) | 2 x 64 | 128 |
| STR (`id`, `inner.b`, 2 tags) | 4 x 64 | 256 (the `ScrStr` is shared) |
| ARR (`tags`) | 1 x 64 | 64 + 32 items = 96 |
| **total** | **9** | **784** |

| | predicted by `boxanat.mjs` | measured by `dyncensus` |
|---|---|---|
| nodes per box | 9 | 9 (8,963 live / 996 boxes, the container aside) |
| bytes per box | 784 | **784** |

`anat0.ts` is the positive control and the instrument **refuses** it — no
snapshot was ever taken, because the arm with no boxing allocates essentially
no `ScrDyn` at all. A control that can only say "yes" is not a control; this
one says "nothing here".

### Re-verified against the build-cache defect

`bin/<key>` and `obj/<set>` did not fold the contents of a `-include`d
instrument header, so a build after a header edit could hit the cache and hand
back a binary carrying the **previous** instrument (fixed in
`fix(cache): the build cache could not see an instrument header's bytes`).

Both readings above were retaken with that fix in the tree and a **cold**
`SCRIPTC_CACHE_DIR`, and the two raw `dyncensus` reports are **byte-identical**
to the originals — `anat1` reproduces every per-kind count and every physical
byte figure, and `anat0` still refuses. The model stands unchanged.

It could not have bitten this lane, and the reason is worth writing down
rather than trusting: `scr_dyn_census.h` was never edited here (it is
untouched from the branch point), and the flag *string* — which does not
witness a header edit but does name one — is already part of `identityArgs`,
so the instrumented probes and the uninstrumented ones (`rt1`, `snap1`,
`snap2`) could never have shared a cache entry either. The defect bites on a
header **edit**, and there was none. Re-measured anyway, because the argument
is not the check.

## The identity divergence the representation already causes

`rt1.ts` crosses one source twice and compares. Against node v25.9.0:

```
back0===src        true   true    (the recovery hands the ORIGIN back)
back1===src        true   true
back0===back1      true   true
after mutate       42     42
kept[0]===kept[1]  false  TRUE    <-- divergence
```

Two crossings of one source produce two distinct `ScrDyn` nodes, so the two
boxes compare unequal where node compares them equal. **Materialising is not
only expensive here, it is already observably wrong on identity** — a
by-reference box would answer node's `true`.

## The staleness divergence, which is the sharper one

`snap1.ts` mutates the source *after* the crossing and then reads the box
dynamically. `snap2.ts` does both readings in one program. Against node
v25.9.0:

```
                                scriptc   node
recovered at the static type:   42        42
read through the box:            1        42     <-- divergence
JSON of the box:                {"id":"m0","n":1}
                                          {"id":"m0","n":42}
agree?                          false     true
```

**One box, two answers, exit 0, no diagnostic.** The crossing takes a
*snapshot*; the recovery hands back the *origin*. So a value recovered at its
static type sees a write made since the crossing and the same box read
dynamically does not — and node's answer is the origin's, both times.

The `static_copy` mark already refuses a write made *through* the box, for
exactly this reason ("a silently dropped write is the one answer worse than a
refusal"). The refusal covers one direction only: a write made through the
**original**, which is what an ordinary program does, is silently invisible to
every dynamic read of the copy.

So materialising is not a memory cost with a correctness cost attached. It is
the **cause** of two silent wrong answers — this one and the `===` one above —
and a by-reference or lazily-materialised box would answer node on both. The
memory is the side effect.

## What the C lane can and cannot attribute

`boxsites.mjs` on `app182` (zapo-js **1.8.2**, 14-part split build, 163 MB of
emitted C, 1m52s):

```
26,469 static-to-dyn crossings in 10,195 emitted functions
    88 of them mark an ORIGIN                    (0.33%)
 5,963 RETAINED (field/global/container)
   418 ESCAPING (returned/passed)
 9,969 TRANSIENT
10,119 UNCLASSIFIED
```

The crossing count and the origin count are **ground-truthed against the
artifact**: `grep -c 'scr_dyn_origin_mark('` is exactly 88, and `sc_td_N(`
appears 37,438 times of which 1,904 are definitions and 1,904 declarations.

**The retention split is NOT reportable yet, and the per-site attribution is
not available from this lane at all.** Two reasons, both measured:

1. **38% unclassified.** A bucket census with more than a third undecided
   cannot support "how many boxes are retained". The floor — at least 5,963
   crossings outlive their statement — is all it currently says.
2. **The compiler stamps every `/* file:line */` with the ENTRY file.** All
   106,161 loc comments in the artifact name `zapo-rest.ts` and not one names
   a zapo-js source file, so the "one row per source line" grouping
   degenerates: the top row claims 17,622 crossings on a single entry-file
   line. That is the back-scan latching onto the nearest available comment,
   not an idiom.

Both are stated rather than worked around because the alternative is a table
that looks like an answer. Per-idiom attribution needs the IR, where the slot
and its shape are still named — the same place `narrowcensus.mjs` reads.

## Which `unknown` slots never needed to be dynamic

`narrowcensus.mjs` reads the serialized IR (`scriptc build <entry> --emit-ir`)
and asks, per `unknown`-typed record field, the one question the narrowing
pass has to answer:

* is **every write** a `dynFrom` of the same static type `T`?
* is **every read** consumed directly by a `dynCheck` back to that same `T`?

If both, the slot was never dynamic. It can carry the pointer, and the box,
its member table, its whole subtree and its origin-table entry all cease to
exist — with **no run-time mechanism at all**, which is why this route cannot
cost a cycle and why it goes first.

It reads the **IR**, which is the only level that can answer it: the emitted
C and `.ll` still have the crossings but have lost which record *field* a
value came out of, and a census over the frontend's 122 `dynFrom` creation
sites would be a census of the lowering rather than of the program.

**It under-counts on purpose.** A read that lands in a local and is cast on
the next line is two expressions; this lane sees only the first and scores it
`read-escapes`. Every such miss moves a slot *out* of the narrowable set, so
the number is a floor.

`narrow1.ts` is the shape, and the three instruments agree on it end to end:

```
narrowcensus  record:r1.data   NARROWABLE   written as record:r0
boxanat       record:r0        3 nodes, 256 B per box
boxsites      1 crossing, RETAINED in a field, and it marks an ORIGIN
              (so the box also pins the source for its whole life)
```

One slot, 256 B of box plus 45.7–91.4 B of origin slot plus a pinned source,
per envelope — and all of it removable at compile time.

## A union-typed field allocates — a different lever entirely

**CONFIRMED from the emitted code, not reasoned about.** A field typed
`T | null` / `T | undefined` / `T?` is not a nullable pointer. It is emitted as

```c
struct sc_rs_r0 {          /* interface Chain { name: string; next?: Chain } */
  size_t rc;
  ScrStr *sc_fld_name;
  ScrUnion *sc_fld_next;   /* <-- a pointer to a SEPARATE allocation */
};
```

and a **populated** arm reaches `scr_union_new_ref` →`scr_union_alloc` →
`scr_cyc_alloc(sizeof(ScrUnion), …)`: its own cycle-headered heap block. There
is no nullable-pointer case and no inlining.

A **unit** arm costs nothing. It is an immortal static singleton taken by
address:

```c
ScrUnion sc_unit_0 = { .rc = SIZE_MAX, .tag = 0 };   /* u506 unit arm */
```

**That is where the `−1` comes from.** The reading that prompted this — 3,000
`Node` records with two `Node | null` fields reporting **8,999** live arena
slots — resolves exactly: `3,000` records plus `5,999` *populated* union
fields, i.e. one null field in the whole structure taking the singleton. The
arithmetic holds under the confirmed mechanism.

### The price

`sizeof(ScrUnion)` is **48** (measured by `sizes.c`, not computed: `rc` 8 +
`tag` 4 + pad 4 + three RC/trace function pointers 24 + `slot` 8). With the
16-byte `ScrCycHdr` and the 8-byte pool grain that is

> **64 bytes per *populated* union-typed field, per instance** — the same 64
> as a dyn node.

The three function pointers are the reason it is 48 and not 16: `arm_retain`,
`arm_release` and `arm_trace` are stored **per instance**, although for a
given field they are a property of the *type*.

### The prevalence, on `app182` (zapo-js 1.8.2)

```
 2,306 record shapes with a struct definition
24,058 declared fields across them
 7,666 of those are ScrUnion *              (31.9%)
 1,521 shapes carry at least one            (66.0%)
13,207 union constructor call sites         (12,218 ref + 682 f64 + 307 bool)
 1,736 unit-arm singletons, over 1,229 distinct unions
```

For scale, the same artifact has **26,469** static→dyn crossings. The two are
the same order — but a union field allocates in ordinary statically typed
code, with no `unknown` anywhere in sight.

### Can a `ScrUnion` reach malloc? Yes — twice, at two very different sizes

Traced through the runtime source, not inferred.

`scr_union_alloc` calls `scr_cyc_alloc(48, …)`, which computes
`phys = scr_pool_bytes(16 + 48) = 64` and size class `blk = 8`. From there:

**The default path — 64 KiB chunks.** The arena is ON in every shipping build
(`#define SCR_CYC_ARENA 1`, and `SCR_CYC_ARENA_BUDGET 0` means *no* budget).
A node is bump-carved out of the class-8 chunk; when that chunk is full,
`scr_cyc_ar_new` calls **`malloc(64 << 10)`** for the next one. So union nodes
DO reach the CRT heap — as **one 64 KiB block per 1,020 nodes**, never as a
64-byte block.

**The fallback path — 64 B `calloc`.** `scr_cyc_alloc_miss` goes arena →
`scr_pool_take` → **`calloc(1, 64)`**. It is taken when the arena is off
(`SCR_CYCLE_ARENA=0`), under **`SCR_RC_AUDIT`** (which forces
`scr_cyc_arena_on()` to 0), past a budget if one is set, or if the chunk
`malloc` fails.

**So the census's attribution is safe, and for the reason suspected.** In a
default build union nodes cannot appear among busy blocks at exactly 64 B —
`3,596` there is consistent with union nodes being absent from that bucket
entirely. **But that holds only while the arena is on.** A binary measured
under `SCR_RC_AUDIT`, or with `SCR_CYCLE_ARENA=0`, puts every union node into
the CRT heap as its own 64-byte block. Any histogram compared across those two
configurations is comparing two different allocators.

### The chunk is the retention story, not the node

A chunk goes back to `free()` only when `--c->used == 0` **and** it is not its
class's current chunk (`scr_cyc_ar_give`). At a 64-byte stride a 64 KiB chunk
holds **1,020** nodes, so:

> **one live union node can pin 65,536 bytes** — a 1,020x amplification, and
> it lands on the CRT heap, which is where the retention this objective is
> chasing was measured.

That is a sparse-survivor fragmentation shape, and it is a *different* claim
from "64 bytes per field".

**AND IT IS BOUNDED, BY MEASUREMENT, AT ABOUT 10 MiB — SO IT IS NOT THE
SETTLED RETENTION.** The census measured **161 cycle-arena chunks held at
exit = 10.06 MiB**, corroborated independently by a heap histogram finding
**218 blocks of exactly 65,536 B** (161 cycle + 55 string = 216, agreeing to
99.1%). Those blocks sit on the **busy** side of the heap — part of the
40.65 MiB live, not of the 72.84 MiB committed-but-free. Chunk pinning by
sparse survivors therefore **cannot be the 72.84 MiB**, and the settled
plateau is not where this finding pays.

The bound is written here rather than left as "would land here" for a specific
reason: a reader who finds the 1,020x amplification convincing and does not
know the arena is 161 chunks will over-read it — which is the same shape as
reading the string arena's inability to call `free()` as an explanation for
105 MiB when it is 3.44 MiB of it.

So, relocated rather than softened:

| number | verdict |
|---|---|
| **live bytes** | **real, and possibly large** — 64 B per populated union field across 31.9% of declared fields, in every shipping build |
| **peak** | **real**, same mechanism |
| **settled committed-free** | **bounded at ~10 MiB by measurement**; not the plateau |
| a cohort workload | **pays neither** — the chunk empties and is returned |

### It is NOT the mechanism this lane has been costing

| | `unknown` boxing | union-typed field |
|---|---|---|
| what triggers it | a **crossing** (`dynFrom`) into a dyn slot | the **representation** of an ordinary typed field |
| shape | transitive deep copy of the reachable tree | one flat 64 B node per populated field |
| where it happens | only at `unknown` slots | every `T?` field in every record |
| the fix | narrow the slot, or box by reference | collapse the union into the field |

Different lever, different fix, and a **much larger blast radius**: 66% of
shapes carry a union field, against the 178 `unknown` slots the source survey
found.

### The route, and the number that is missing

For a **two-arm** union of one unit arm and one pointer-shaped ref arm, the
tag is implied by null-ness and the three RC hooks are constant for the field,
so the field could be a plain nullable pointer with the hooks emitted
statically at each use site — no allocation at all. The edges to settle first:
the record's own trace has to gain an arm, because removing the `ScrUnion`
removes a node from the collector's graph; and a union with three or more
arms, or with any scalar arm, genuinely needs the tag and the slot.

**The number that sizes that fix — how many of the 7,666 union fields are the
collapsible two-arm shape — is NOT in this report.** Arity lives in the union
*definitions* (`mod.unions[].arms`), which the IR carries and the emitted C
does not; the tag histogram of the constructor calls hints at it and cannot
settle it. It needs an `--emit-ir` build of `app182`, which has not been run.

`unioncensus.mjs` is the reader that answers it, written and self-tested (18
checks) against the `IrUnionDef` schema and **not yet run on a real
artifact** — so the window is one command, not an exploration. It classifies
each union as `COLLAPSIBLE` (exactly two arms, one unit and one
pointer-shaped) or one of the four shapes that genuinely need the tag and the
slot: `multi-arm`, `scalar-arm` (an `f64`/`bool` payload lives in `slot`, and
0 is a legal value), `two-ref`, `two-unit`. It weights by **declared field**,
not by union, because one collapsible union behind forty fields is worth forty
allocations. Its first real run must be checked against the **7,666**
`ScrUnion *` field count this README records, which is the cross-lane control.

It deliberately does **not** answer whether a collapse is *sound* for a given
field: removing the `ScrUnion` removes a node from the collector's graph, so
the owning record's trace has to visit the field directly, and per-shape cycle
grading is not in the IR. The lane reports the ref arm's kind so that
follow-up has a list, and claims nothing about it.

## The cycle trap: a third divergence, and it is a hard abort

`cyc1.ts` / `cyc2.ts`, recorded in `cyc-baseline.txt`. A cyclic value crossing
into `unknown` meets `scr_dyn_from_enter`'s re-entry fence — a cyclic value has
no finite deep copy — and the process **aborts**:

```
scriptc: cannot convert a circular structure into a checked-dynamic value
         (unknown-typed slots deep-copy; break the cycle first)
exit -1073740791          (0xC0000409, the fast-fail path, after the fence prints)
```

node runs both programs to completion. **218 of zapo's 1,905 converters reach
a cycle**, so this is a fifth of the shapes that cross, not a corner.

`cyc2` is the case that decides the route. It crosses the cycle and then
**only recovers it at its static type** — the box is never read dynamically.
node prints `recovered a same=true`; scriptc aborts before reaching the line.
The deep copy the fence is protecting is a copy **nothing in the program ever
looks at**: the recovery hands back the origin, which is the same pointer node
would have passed.

So under a lazy box the trap does not move to a better place — **it was never
owed**. The fence stops a deep copy that cannot terminate; where no deep copy
is attempted, refusing is a false positive.

`cyc1` keeps its own entry because it distinguishes a half fix from a whole
one: its only use of the box is `typeof`, which `objaudit.tsv` classes
`refonly`. If `cyc2` stops trapping and `cyc1` does not, materialisation was
deferred but the table-free operations were not taught to answer without
forcing.

Both must move to `tests/corpus/` when the fix lands, where the differential
compares them against node automatically. They are not there today for the
honest reason: they fail, and a failing corpus program is a red gate, not a
record.

## The audit surface for a by-reference box — and a premise that does not hold

`objaudit.mjs` enumerates every place the runtime decides something about an
`SCR_DYN_OBJ`, and classifies **how each one fails for a kind it has never
heard of**.

```
140 functions in 19 files
  kind decisions   161
    if (kind != OBJ)     66   miss = the default value / the else branch
    if (kind == OBJ)     72   miss = the else branch
    case OBJ:            23   miss = the switch's default arm
  direct v.obj reads    121

  loud         3   throws, aborts or refuses by name
  silent     130   returns a value, breaks, or takes the else
  nodefault    7   a kind switch with no default arm at all
```

A new dyn kind was chosen over a lazily-emptied `SCR_DYN_OBJ` on the argument
that a missed reader would then **refuse loudly** rather than answer `{}`.
The argument is right; the premise is **not**. Only **3 of 140 sites (2.1%)**
refuse a kind they have not been taught. The rest answer it, because the
overwhelming majority are not switches at all — they are
`if (d->kind != SCR_DYN_OBJ) return <default>;` guards on inbound library
options.

Two are worse than a default, and both are one-line answers to very common
questions:

| site | default | what a new object-like kind gets |
|---|---|---|
| `scr_dyn_truthy` | `return false` | an object that is **falsy** |
| `scr_dyn_typeof_native` | `return "undefined"` | `typeof o === "undefined"` |

The runtime already knows. `scr_dyn_truthy`'s own comment says the default's
unconditional false "**is a wrong branch in silence, not a fence**".

Others fail silently in ways a caller cannot see: `scr_tls_opts_validate`
returns `true` (= valid, options ignored), `scr_stream_parse_dyn_opts` returns
`true`, `scr_qs_stringify` returns `""`, `scr_dyn_obj_has_own_prop` returns
`false`.

**So the loudness has to be built, not inherited.** That is the real size of
the by-reference route, and this file makes it a number instead of an
impression.

One case shows why the verdict column is a human's and not the scanner's:
`scr_weak_dyn_key`'s default *returns* a refusal **descriptor** that
`scr_weak_dyn_set` turns into a throw. It is genuinely loud; the scan reads it
as silent. Widening the pattern until it caught that would have made it catch
things that are not refusals — in the direction that flatters the argument
this lane is correcting. So a person overrides, with a reason, in the
manifest.

### The manifest is a guard, not a census

`objaudit.tsv` holds the mechanical columns plus a human `verdict` and `note`.
`--check` fails if a site **appears, disappears, changes how it fails, or is
still `REVIEW`** — so a new decision site cannot reach a merge without someone
classifying it, and a rescan cannot go green by forgetting (verdicts carry
across `--tsv --merge`).

It currently fails, correctly: **25 of 140 classified, 115 at `REVIEW`.** The
25 are the ones actually read; the rest are the job.

| verdict | n | meaning |
|---|---|---|
| `force` | 42 | reads members, so it needs the table materialised first |
| `refonly` | 6 | answers from the node with no table — name the new kind in its list |
| `teardown` | 4 | an RC/collector arm; must drop the origin |
| `creator` | 3 | the origin table's own kind gate |
| `unreachable` | 1 | the new kind cannot arrive here, with the argument for why |
| `loud-at-caller` | 1 | already refuses, somewhere the scan cannot see |
| `REVIEW` | 83 | undecided |

**How a verdict is reached, so a second pair of hands can match it.** Open the
function and answer one question: *does it read `v.obj.entries`, directly or
through `scr_dyn_obj_get` / `scr_dyn_ext`?* If yes it is `force`, whatever its
miss path looks like. If it answers from the node itself — a flag, the kind, a
name — it is `refonly` and the only work is naming the new kind in its list.
`teardown` and `creator` are the two closed sets: the RC/collector arms, and
the three origin-table entry points.

Two verdicts exist because the mechanical scan cannot see the answer, and both
are arguments rather than classifications:

* `loud-at-caller` — `scr_weak_dyn_key` returns a refusal **descriptor** its
  caller throws on. Genuinely loud; the scan reads it as silent.
* `unreachable` — `scr_dyn_mark_module_ns` sets a flag on a namespace snapshot
  its own caller built. A boundary reference box never arrives, and the kind
  gate is not what keeps it out.

**Two rows carry a warning the family does not share.** `scr_net_connect_opts_chk`
is a `force` whose miss is **loud** (`scr_dyn_arg_type_fail`), unlike every
other options guard — a missed teaching there is a visible error, not a wrong
answer. And `scr_cls_props_ensure` is a `force` whose miss builds a **fresh
empty** props table and discards the live one: silent, and destructive rather
than merely wrong. Neither is deducible from the guard shape, which is the
whole reason the column is a person's.

`scr_dyn_json_write_raw` is the sharpest of the 25: its default **is** loud,
and that is the **wrong** answer — `JSON.stringify` of a boxed record must
serialise. Inheriting the refusal there would be a regression, which is why
"loud by default" is not a safe resting state either.

## Usage

```sh
node tests/perf/boxanat/boxanat.mjs  --self-test          # 32 checks, both lanes
node tests/perf/boxanat/boxsites.mjs --self-test          # 12 checks
node tests/perf/boxanat/objaudit.mjs --self-test          # 20 checks
node tests/perf/boxanat/narrowcensus.mjs --self-test       # 13 checks
node tests/perf/boxanat/narrowcensus.mjs <program.ir.json> [--list]
node tests/perf/boxanat/objaudit.mjs packages/runtime/src [--list] [--class silent]
node tests/perf/boxanat/objaudit.mjs packages/runtime/src --check tests/perf/boxanat/objaudit.tsv
node tests/perf/boxanat/objaudit.mjs packages/runtime/src --tsv --merge tests/perf/boxanat/objaudit.tsv
node tests/perf/boxanat/boxanat.mjs  <program.c|.ll> [--top N] [--names] [--json]
node tests/perf/boxanat/boxsites.mjs <program.c>    [--top N] [--bucket <b>] [--json]
```

`boxanat.mjs` prices every converter in an artifact. It reads **either**
backend and must produce the same numbers from both — the site count and the
price are properties of the IR and the runtime, not of the emitter — and the
self-test checks exactly that on one fixture written out in both spellings.

A type that reaches a **cycle** has no bounded box at all, and this lane
reports `bytes: n/a` with a per-level floor rather than a total. The first
version of this file summed such a graph anyway and printed `72,722,288 B` for
a five-field record; that is the shape of wrongness this lane exists to avoid,
so the refusal is a self-test case.

`boxsites.mjs` answers the other half: **which** crossings outlive the
statement that made them. It buckets each into `field` / `global` /
`container` / `returned` / `passed` / `transient` / `unclassified`, and it
never folds `unclassified` into either side. It reads the **C lane only** —
the buckets key on the emitted ownership moves, which the LLVM lane spreads
across basic blocks — and refuses a `.ll` rather than half-answering it.

The bucket that a naive classifier gets wrong is `container`: `kept.push(e)`
*releases* the crossing temp, because the push retained it. "Released,
therefore transient" would call a permanently retained box transient, and
that case is a self-test.

## Measured on zapo (`zapo-rest`, 1.8.x, LLVM artifact)

```
1,905 static→dyn converters
1,158 of them COPY (record/array); 747 box by reference
  218 reach a cycle — no bounded box size
1,687 have an exact one: median 304 B, mean 3,142 B, max 92,992 B
```

The mean of **3,142 B** is an independent bracket on the 2,794 B measured on
the workload, arrived at from the emitted converter graph rather than from a
heap.

The 92,992 B shapes are the app-state mutation records
(`schema, operation, source, collection, version, timestamp, _raw, starAction,
contactAction, muteAction, …`, 88–90 members).
