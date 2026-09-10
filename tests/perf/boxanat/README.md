# `boxanat` — the anatomy of a value boxed into an `unknown` slot

`2,794 bytes per retained value` was measured on one workload. It says the
boxes are expensive; it does not say **where the bytes go**, and a
representation change cannot be argued from a single scalar. This lane reads
the anatomy off the artifact the compiler emitted, and validates the model
against a physical measurement.

## The NaN literals, and why they do not touch this lane

`--emit-ir` refused to serialise zapo for 27 minutes because the IR carried a
NaN (fixed: NaN now rides the `$nonfinite` sentinel with `Infinity` and `-0`).
The follow-up question was whether that NaN sits near the event ring.

**It does not, and my own first answer was wrong.** I reported the source grep
— `Number.NaN` in `mcp-server/src/runtime.ts:510` — as though it were in the
compiled program. The artifact says otherwise: **neither
`parseEnvPositiveInt` nor `buildRuntimeConfigFromEnv` appears anywhere in the
emitted C.** `zapo-rest.ts` is a REST driver and does not wire the MCP server,
so that site is not compiled at all. A source grep names what is *written*;
only the artifact names what is *built*.

What the artifact does carry is **11 NaN literals across 10 functions**,
spelled `double sc_tN = NAN;`:

| function | source |
|---|---|
| `SignalDeviceSyncApi_parseUserDeviceJids` | JID parsing |
| `parseOsVersion` (x2) | version parsing |
| `WaKeepAlive_run`, `WaKeepAlive_normalizeJitterRatio` | the keep-alive loop |
| `WaMobileCoordinator_updateAccountKeyIndex` | account key index |
| `nowMs`, `nowSeconds` | time helpers |
| `fn462`, `fn1377_n`, `fn1389_n` | anonymous |

So they are **not** one cold env parser: the keep-alive loop and the time
helpers recur for the life of the process. The typical shape is a union
unwrap falling back to NaN as JS's "absent number" —
`if (tag == 1 || tag == 2) { x = NAN; } else { x = scr_union_get_f64(u); }`.

**None of them can interact with the boxing anatomy, and that is structural
rather than lucky.** A NaN is an `f64`. `f64` boxes through
`scr_dyn_new_num` — one 64-byte `SCR_DYN_NUM` node, no member table, no
subtree. The transitive per-leaf copy is a **record and array** mechanism and
scalars are excluded from it by construction. Checked as well as argued: a
scan for a `NAN` temp flowing into any `sc_td_` converter or `scr_dyn_new_num`
within its function finds **zero**.

Closed. The NaN was a serialiser defect worth fixing for everyone reaching for
`--emit-ir`; it is not a term in the retention story.

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

## The readout: both censuses on real zapo (app182, zapo-js 1.8.2)

`--emit-ir` build `GATE-EXIT 0 after 32.3 min`; the IR is **458 MB** and parses
in 4 s. **The reconciliation agrees exactly** — the IR counts **7,666**
union-typed record fields and the emitted `.scrh` counts **7,666** `ScrUnion *`
struct slots, two readers over two artifacts. So the numbers below may be
quoted.

### The union fix has a ceiling of 31.6%

```
1,467 union definitions behind 7,666 declared record fields

  COLLAPSIBLE      643 unions   2,425 fields   two arms, one unit + one pointer
  multi-arm        623 unions   4,287 fields   null-ness cannot encode 3 tags
  scalar-arm        10 unions     727 fields   f64/bool lives in `slot`; 0 is legal
  two-ref           54 unions      20 fields
  two-unit           1 union       31 fields
  unmodelled-arm   136 unions     176 fields   an arm kind this lane does not model
```

**2,425 of 7,666 (31.6%)** are the shape a nullable pointer could carry with no
allocation. At 64 B per populated field per instance **that is the ceiling on
the fix, not 7,666** — the other 68% genuinely need the tag and the slot.

The single largest is `u3`: two arms, **991 fields**, ref arm `string`. So
`string | null` is the most common union field in zapo and it is collapsible.
`u39` (`array`, 669 fields) follows. The largest *non*-collapsible is `u41` —
three arms, 854 fields.

### The narrowing route finds nothing on zapo

```
145 record fields declared `unknown`

  index-signature   96     Record<string, unknown> overflow values, a different slot
  opaque-write      24     written from a dyn this walk cannot attribute
  no-writer          8     read, never written by any dynFrom
  read-escapes       7     read flows somewhere this lane cannot follow
  unused             6
  polymorphic        2     genuinely two writer types
  write-only         2
  NARROWABLE         0
```

**Zero of 43 live `unknown` fields are narrowable.** The route that was ordered
first because it cannot cost a cycle also **cannot pay** on this program, and
the reasons are specific rather than a shrug:

* **96 of 145 are index-signature values** — `Record<string, unknown>`, whose
  values live in the overflow map and are not declared fields at all. The
  dominant `unknown` shape in zapo is not the shape this route addresses.
* **24 are `opaque-write`** — filled from a dyn that is not a `dynFrom`
  (JSON, the island, another slot), so no single static type flows in.
* The lane is a **floor** and covers **record fields only**, so 0 is a floor
  too — but a floor of zero with 96 of the population in a bucket the route
  structurally cannot reach is not a near miss.

`no-writer` was called `polymorphic` in the first reading, which said "two
shapes flow here" where the truth is "none this walk can see" — 8 of the 10
rows. Corrected before quoting, and now a self-test.

## SC6004 — the same shape one level up, and already someone's workstream

The build emits **77 advisories, 76 of them `SC6004`**: *"this flow COPIES the
record into a different shape."* Read against this objective the phrase *"the
program then holds two objects where JavaScript has one"* is a statement about
retained memory, and it is the same diagnosis as this lane's — **scriptc
materialises where JavaScript aliases** — one level up: a relabel in
TypeScript, a copy in scriptc.

Three questions, answered off the artifact this block already has.

**Are they hot?** Mostly yes. By directory: **33 `src/client`** (9 of them in
`WaMessageDispatchCoordinator.ts` alone), **13 `src/store`**, **10
`src/message`** (7 in `message/encode/media-payload.ts`), **7
`src/transport`**, 6 `src/signal`, 3 `src/media`, 2 `src/auth`, 1 each
`src/crypto` and `src/appstate`. Message dispatch, media payload encoding,
transport builders and signal session encoding are per-message paths, not
startup.

**How big are the copies?** 73 of the 76 name the members the copy drops. The
widest name `$unknowns, agentAction, aiThreadRenameAction,
androidUnsupportedActions, archiveChatAction, autoOrganizeBusiness…` — **the
same 88–90 member app-state mutation shapes this lane prices at 92,992 B per
box.** So the widest records in the program are on both lists.

**Does the by-reference box reach them? No — zero, and structurally.** `SC6004`
is a **record → record** flow, lowered to `%rec.width.N`: a fresh struct with
the destination's fields copied across. The box is **record → dyn**: a struct
becoming an `ScrDyn` tree. Different lowering, different helper, different
mechanism; nothing about how a dyn box is represented touches struct layout.

**And it is not uncounted.** `frontend/lowering/shape-unify.ts` is a pass that
already closes this class *at the layout* — where a narrow shape can afford to
carry the wider one's extra members, the two become **one** shape and the copy
collapses to the identity, with no runtime cost and neither backend changed.
**Its cap is +2 fields**, deliberately: *"a one-field view of a 62-field
message is what gets allocated in a loop; growing it by sixty-one to spare a
copy is a trade nobody asked for. The measured components run to +109."*

So **the 76 are that pass's documented decline set** — the edges past the cap —
and `SC6004` "falls silent at exactly the sites this closed and keeps speaking
at every one it did not". The reach of this block's fix into them is zero, and
the reach of a *different* fix into them is somebody's existing workstream, not
a new investigation.

## The trace edge, settled: the collapse is trace-neutral by construction

I called this unanswerable from the IR. That was half right and it blocked the
wrong thing: it is unanswerable from the IR **alone**, and it is already
answered in the **emitter**, which is where the lowering lives anyway.

**One predicate drives both the grading and the visit** (`emit-shapes.ts:665`):

```ts
const tracedFields = s.fields.filter((f) => E.traceAdapterC(f.type) !== null);
...tracedFields.map((f) => `  visit(o->${mangleField(f.name)}, ctx);`)
```

So a record's trace is **already per-field and already generic**. Measured on a
real artifact — `Chain { name: string; next?: Chain }` emits

```c
static void sc_rtrace_r0(void *o0, ScrTraceVisit visit, void *ctx) {
  sc_rs_r0 *o = (sc_rs_r0 *)o0;
  visit(o->sc_fld_next, ctx); /* next */
}
```

It visits the union field and emits **nothing** for the `ScrStr *` field. The
"visit only traceable fields" discipline is in place and correct today.

**And the grading is invariant under the collapse.** `traceAdapterC` has
```ts
case "union": return E.tracedUnions.has(t.unionId) ? "scr_union_trace_v" : null;
```
and the fixpoint (`emitter.ts:1153`) removes a union from `tracedUnions` when
`!u.arms.some(cycleCapable)`. A unit arm is never cycle-capable, so for a
two-arm `{unit, A}` union:

> `tracedUnions.has(U)`  ⟺  `cycleCapable(A)`

**Before** the collapse the field contributes `scr_union_trace_v` iff `A` is
cycle-capable. **After**, the field has type `A` and contributes
`traceAdapterC(A)` iff `A` is cycle-capable. **Same condition, same
`tracedFields` membership, same visit emitted or omitted, same shape grading.**

So the trace edge needs **no new mechanism and no new predicate**: replace the
field's type in the shape table and the existing fixpoint recomputes the right
answer. The hazard named for `SCR_DYN_OBJINST` — visiting an object that
carries no header — cannot arise, because the same `cycleCapable(A)` that
decides `arm_trace` today decides the visit after.

**What this does not settle**, and it belongs to the lowering rather than to
the trace: the field's **release** path. `sc_rrelease_r0` calls
`scr_union_release(o->sc_fld_next)` today; a collapsed field must call `A`'s
own release. That is the same per-field type substitution, in
`untracedRefFields`' sibling emission — mechanical, but it has to be done, and
`scr_union_release` is NULL-tolerant where `A`'s release may not be.

## Populated, not declared — and the instrument I first named was wrong

**2,425 is the declared cap and the artifact cannot turn it into a saving.**
64 B is charged per *populated* field per *instance*: a field holding its unit
arm costs nothing (the immortal singleton), and how often a hot instance leaves
a nullable field null is a run-time fact.

**I first proposed `scr_live_unions` under `SCR_RC_AUDIT`, and it answers the
wrong question.** That counter is a *leak detector*: `scr_console.c` reads it
**at exit**, prints only when some count is non-zero, and `_Exit(99)`s. On an
RC-clean program it reads **0** — which is not a small population, it is no
information at all. A check that can only say "yes" is not a check, and this
one can only say "you leaked".

**The right instrument already exists: `tests/perf/cycensus`.** It keys every
`scr_cyc_alloc` on the `ScrCycFreeFn` it is handed, which *"identifies the
object kind EXACTLY"* — and a `ScrUnion`'s free function is
`scr_union_gcfree`. Its `snap` columns are each kind's live count at the
census's own **high-water mark** (`live` is at exit), so it reports population
at peak rather than leakage at exit. It separates `live` (the program holds it)
from `pool` (the allocator kept it), which a malloc-level lane cannot.

And it is better on the axis that decides byte placement: **cycensus needs no
`SCR_RC_AUDIT`, so the cycle arena stays ON** and the run places blocks the way
a shipping binary does. The RC-audit route would have forced
`scr_cyc_arena_on()` to 0 and measured a different allocator.

### The run, and it is machine time only

`harness/memrig.mts` *"drives the binary through pairing and a history sync
with no phone"* and samples kernel-side via `harness/pmon.c`. No pairing, no
live session, nothing near the user's `zapo-state.sqlite`. So:

```
SCRIPTC_PROF_CFLAGS="-include <repo>/tests/perf/cycensus/scr_cyc_census.h"
  build app182            ->  one provenance build
SCR_CYCEN_OUT=<file> node --import tsx memrig.mts <exe> <tag>
  ->  the scr_union_gcfree row's snap liveN = POPULATED union fields at peak
```

**Every figure from it names the unserialised arm.** `PLAN-RETENTION.md` §10
measures a five-line promise gate in `WaClient.ts` taking settled from 146.87
to 76.17 MiB — forbidden to us, and *upstream of the same mechanism*: a
serialised sync bursts an eighth as hard and shreds an eighth as much heap. A
populated-union count taken on the shipped, unserialised arm is the only one
that describes what our end can be worth, and it must be labelled as such.

## MEASURED: 14,868 populated union fields at peak, and the fix is worth under 1 MiB

`tests/perf/cycensus` on the LLVM (shipping-lane) `app182` binary, driven by
`memrig.mts` at `CHUNKS=8 CONVS=400 MSGS=6` (19,200 messages), **unserialised
sync**, arena **on**, clean exit 0. Census arm validated and subtracted.

```
atPeak       objects  B/obj      atExit   held%      allocs  size   kind
951,552 B     14,868   64.0     451,968   47.50%  1,270,234    48   scr_union_gcfree
```

* **14,868 populated union fields live at peak** — one `ScrUnion` node per
  populated field per instance — costing **951,552 B (929 KiB)**, which is
  **11.46%** of the live cycle heap at peak.
* **7,062 still live at exit**, **451,968 B (441 KiB)**, 9.63% of live at exit.
* **1,270,234 allocated over the run** against 14,868 live at peak: unions
  churn hard and survive rarely.

**So the union collapse is worth at most 0.91 MiB at peak and 0.43 MiB at
exit** — and that is the ceiling with *every* union collapsed, which is not on
offer, because only 2,425 of 7,666 declared field slots are the collapsible
two-arm shape.

**The collapsible share of the POPULATED count is not measured and cannot be,
without a representation change.** `cycensus` keys on `ScrCycFreeFn`, which
names the kind (`scr_union_gcfree`) and cannot separate one union id from
another; and `ScrUnion` itself carries only a numeric `tag`, no interned type
key, so nothing at run time knows which union definition a node came from.
Adding one to find out would cost memory to measure a memory saving.

Taking the declared-slot share of 31.6% as a prior gives **≈0.29 MiB at peak
and ≈0.14 MiB at exit** — but that assumes the populated mix matches the
declared mix, and it probably does not: `u3` (`string | null`) alone is 991 of
the 7,666 slots and is the kind of field that is usually filled.

**Arms, because these numbers compose with nothing until they are named.**
This is **1.8.2** (`app182`), the arm the 2,425 cap was counted on, driven from
the **1.6.2** fake-server fixture (established practice — `census-arms.sh`
does the same), on the **unserialised** sync. The ledger's **13.63 MiB cycle
arena** row is **1.6.2** with a different sync architecture, and this run's own
cycle total is 43.4 MB at exit (4.69 MB live + 38.75 MB pool slack). **Do not
subtract 0.43 from 13.63.** They are different programs.

### What it means for the route

The union collapse is a **correctness-neutral, trace-neutral, cycle-free**
change worth **well under a megabyte** of settled bytes on this workload. Its
value is not the bytes: it is that each removed node is a potential **chunk
pinner**, and a 64 KiB arena chunk is freed only when all 1,020 of its slots
are dead. 7,062 survivors at exit can pin far more than 441 KiB — but *how
much* depends on placement, which is `pagereturn`'s measurement and not this
one's.

**Reported as a small true figure rather than a large declared one.** 2,425
ships as a cap; 14,868 / 951,552 B is the population it is capped against.

## MEASURED: a chunk list on the string arena would recover ZERO

`cycstat` on the LLVM shipping-lane `app182` binary, `memrig.mts` at
`CHUNKS=8 CONVS=400 MSGS=6`, unserialised, clean exit 0. **One run, and it
carries its own control** — the cycle arena is instrumented by the same header
in the same process:

```
arena     chunks=671 freed=556 held=115 peakheld=317 carved=527850
          listhit=46,442,561 listgive=46,897,347 callocfallback=60829
strarena  chunks=49  carved=75,645
          listhit=0  listgive=0  mallocfallback=0
```

**The cycle arena's chunk list works**: 671 taken, **556 freed**, 115 held —
83% returned, and its per-class freelists moved 46.9 million blocks.

**The string arena's freelist moved zero.** `listgive=0` — not "rarely", not
"few": **no block has ever been returned to it.** So:

> A `used` counter decremented in `scr_str_ar_give` would **never decrement**.
> No chunk can reach `used == 0`. **The chunk list recovers nothing** — it is
> inert by measurement, not by placement.

### Why, and it is one line in the release path

`scr_str_release` tries the size-class pool **first**:

```c
if (scr_pool_give(&scr_str_blocks, s, sizeof(ScrStr) + s->cap + 1)) return;
/* The pool refused: ... the arena's own list catches it first. */
if (scr_str_arena_on()) { ... scr_str_ar_give(s, r); return; }
```

`scr_pool_give` refuses only past its budget/depth. On this workload it
**never refused once in 75,645 carves**, so `scr_str_ar_give` is unreachable
in practice. The string arena is a bump allocator that feeds the pool and
never gets anything back; the blocks live on `scr_str_blocks`' freelist, which
is a different owner with a different lifetime.

### What this changes

The brief's fix — *"give the string arena the chunk list the cycle arena
already has"* — is correct about the defect and **cannot pay on this
workload**. `k` really is unrecoverable after one carve, and an arena that
cannot free a chunk even in principle really is a bug. But the reclamation it
would enable has **no input**.

Recovering the **49 chunks = 3.06 MiB** needs the blocks to come back, which
means changing where freed strings go — routing arena-carved blocks to the
arena rather than the pool, or making the pool itself return them. That is a
behaviour change to the allocation path, not a bookkeeping addition, and it
collides directly with the brief's own second hazard: *"do not let the chunk
list change quietly alter which sizes reach the arena."*

**Predicted and honoured.** This README already said the recovery might be far
under 3 MB because the cycle arena has the machinery and still holds chunks.
The measurement says worse than that and for a different reason: the cycle
arena's list is *working* (83% returned); the string arena's is *unreachable*.

## RETRACTED: the pool budget is not an unexamined term — it was measured when it shipped

I proposed `SCR_POOL_BUDGET` as *"the largest unexamined term on the board"*:
16 MiB per pool across four pools, **up to 64 MiB**, against 72.12 MB of
retention. **That is wrong, and it was knowable from this tree before I said
it.**

`7bd0e4ce3 perf(runtime): the size-class pools' byte budget ships on, because
on zapo the bound is never reached` **is the commit that set the constant**,
and it carries the control run, per pool, on zapo:

```
                 gives   rejected by depth 64   rejected by 16 MiB
cyc             80,136    20,184  25.19%                 0
jsonkey         17,946     1,192   6.64%                 0
dynext           1,722        15   0.87%                 0
str             35,521         0   0.00%                 0
TOTAL          135,325    21,391  15.81%                 0
```

* **Zero rejected gives at 16 MiB, and zero at 1 MiB.** The bound is never
  approached.
* **The largest pool's byte high-water is 614,880 B — 3.67% of the bound.**
* Turning the budget on moved pool retention **41.0 KiB → 616.7 KiB**, and
  peak WS by **+48 KiB of 27,906 KiB (+0.172%)**, inside a **+0.316%** A/A
  floor.

**616.7 KiB is 0.83% of the 72.12 MB the user sees.** The whole sweep range —
16 MiB down to depth-64 — is **~575 KiB**, and going back costs **21,391
`free()` calls and 11,976 pool misses** in a 46-second session. The trade was
measured in both directions and settled.

### What I actually got wrong

**I read a capacity as an occupancy.** `16 MiB × 4` is what the pools *may*
hold; what they *do* hold is ~600 KiB. A bound can only ever retain blocks the
program itself allocated and freed, so it cannot exceed that program's own live
peak in the ≤256 B classes — which the header says, two paragraphs above the
constant I was quoting.

**And my evidence was consistent with the true answer all along.** `listgive=0`
on the string arena is explained by the pool never refusing — and `str` is the
one pool of four with **0.00% depth rejections**, i.e. the one that never
saturates even at depth 64. I used that fact to argue the pool must be holding
a great deal; it is equally the signature of a pool that is barely used.

### What stands

The three stale descriptions are real and are now fixed: `poolstat`'s header,
the worst-case note, and the knob's own paragraph — which still said *"0, the
default, is the shipped behaviour"* after `7bd0e4ce3` turned it on, despite
that commit promising to rewrite every claim its measurement moved. Being
mis-documented in three places is how a settled question came back.

**No `poolstat` run is needed to close this.** The run would re-measure
614,880 B. The route is closed with a number, and the number was already in the
tree.

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

  loud         4   throws, aborts or refuses by name
  silent     129   returns a value, breaks, or takes the else
  nodefault    7   a kind switch with no default arm at all
```

**That `loud` figure is a LOWER BOUND and always will be.** `findDefault`
originally classified from a fixed six-line window, so `scr_sc_clone`'s throw —
sitting behind a seven-line comment — read as `silent` when it is loud. The
window is now the whole default arm (to the next `case` at the same depth, or
the end of the switch), which moved the count from 3 to 4. But a refusal
reached through a *caller* is still invisible to any scan: `scr_weak_dyn_key`
returns a refusal **descriptor**, and `scr_net_connect_opts_chk` and
`scr_process_emit_warning` are `if`-guards whose miss path throws. Those are
`loud` in fact and `silent` to the tool, which is why the verdict column is a
person's and why this number may only ever be read as "at least".

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

### Does `force` at 114 of 140 sink the lazy box? Not on this evidence

The worry is exact: if nearly every consumer materialises, a lazy box is
forced by almost anything that touches it and the prize shrinks to whatever
traffic goes through the `refonly` sites plus the sites never reached.

**I could not answer the reachability half from the artifact, and both
attempts failed in opposite directions.** Recorded because either one, taken
alone, would have been quotable and wrong:

* **Call-only** (`name(` in a body) said 2,002 of 3,743 runtime functions
  reachable and put 22 of 42 `force` sites out of reach — but it also declared
  `scr_dyn_trace` and `scr_dyn_gcfree` dead, which is impossible: they are
  installed as **function pointers** by `scr_cyc_alloc`. Every `_invoke`,
  `_ctor`, `_cb` and `_thunk` in the runtime is reached the same way. Unsound,
  and unsound in the direction that flatters laziness.
* **Identifier-level** (any mention, to catch pointer installs) said 3,743 of
  3,743 — vacuous, because `scr_runtime.h` declares every function at file
  scope and the seed swallowed the header.

The sound instrument is the **linked image** — the PDB's procedure records for
`zapo-rest.exe`, which `tests/perf/pdb-symbols.mjs` reads through WSL's
`llvm-pdbutil` — and even that answers *survived the link*, not *executes on a
sync*. **Only runtime traffic settles it**, and that needs a running
`zapo-rest`.

**What the site list does say, and it is not nothing.** Of the 42 `force` rows
classified here, 14 are the **dyn core** (`scr_json.c`, `scr_dyn_invoke.c`:
the keyed read and write, the prototype walk, `toJSON`, `String()`, the class
props table) and 28 are **library surface** — TLS/HTTP2/fs/qs/sqlite/assert
option and header walkers. The library-surface 28 receive **options objects
and headers built fresh per API call**. A retained box from an event ring
never arrives there. They inflate the static count and cannot force a
retained value.

**And the count is of operation KINDS, not of touches.** "114 of 140 force"
says almost every *kind* of dynamic operation needs the member table. It does
not say a retained box meets one. A lazy box is forced only if something
**reads** it — and the largest `unknown` population in zapo, the MCP event
ring, is written on every event and read only when a client asks for the
buffer. Laziness pays exactly in proportion to boxes that are never read, and
that is the population this ring is built to hold.

So the honest position: **`force` at 114 does not sink the route, and it does
not vindicate it either.** It relocates the question from "how many sites
force?" to "how many retained boxes are ever touched?", which is a runtime
measurement nobody has taken. If it turns out the retained boxes are read
almost exclusively through forcing consumers, then narrowing is the whole fix
— and that would be worth knowing before a lowering is written, not after.

### The teardown gaps — what a reader-shaped audit cannot see

The audit classifies every site that *reads* an OBJ dyn. **A destructor reads
nothing**, so none of its categories reach the teardown paths, and a new kind
that never gets freed produces no wrong answer anywhere a reader could be
asked. Four kind-gated sites, all in `scr_json.c`:

| line | site | what a new kind gets |
|---|---|---|
| 686 | `gcfree`: `if (static_copy && (ARR \|\| OBJ)) origin_forget` | **origin never forgotten** |
| 816 / 820 | `release`: `origin_forget` sits *inside* the `case ARR` / `case OBJ` arms | **origin never forgotten** |
| 737 / 906 | the payload tail, `if ARR free(items) else if OBJ free(entries)` | **heap payload never freed** |
| 568 / 878 | freelist selection, `ARR ? free_arr : OBJ ? free_obj : free_misc` | falls to `free_misc` — **safe**, because `scr_dyn_alloc`'s misc arm `memset`s the payload |

**They compose into something worse than a leak, and that is the part worth
stating.** The origin table is keyed by `ScrDyn *`. A box whose origin is never
forgotten is freed, its **address recycled** off `free_misc` by the next
allocation, and the table still holds that address as a live key. The next
`scr_dyn_origin_take` on the recycled node then hands back the **previous**
object's origin — retained, of the wrong type, and belonging to a different
value.

That is the WeakMap stale-key class exactly, and `scr_weak.c`'s own header
already spells out why an address-keyed table must be purged at death: *"a
WeakMap entry that outlived its key by even one allocation is not a leak but a
WRONG ANSWER: the table is keyed by address and the object that lands here next
would read the dead key's value."* The same sentence applies to
`dyn_origin_tab`, one file over.

And the un-forgotten entry holds a **strong** reference, so the source record
leaks alongside it — the retention this whole lane exists to remove.

**So the reference box's teardown is a precondition, not a follow-up.** Three
edits before it can exist at all: widen both `origin_forget` gates, extend the
payload tail, and leave the freelist arm alone. `scr_dyn_release` and
`scr_dyn_gcfree` were already `teardown` in the manifest for the origin
reason; the payload tail was not, because nothing reads it.

Together with the three ungated arm accessors (`scr_dyn_ext`, `scr_dyn_ext_w`,
`scr_dyn_obj_unset`, which read `d->v.obj.*` with no kind test and are safe
only while every caller gates), these are the two places where the design is
constrained by code the audit's categories were never shaped to find.

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
