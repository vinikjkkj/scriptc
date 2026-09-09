# `boxanat` — the anatomy of a value boxed into an `unknown` slot

`2,794 bytes per retained value` was measured on one workload. It says the
boxes are expensive; it does not say **where the bytes go**, and a
representation change cannot be argued from a single scalar. This lane reads
the anatomy off the artifact the compiler emitted, and validates the model
against a physical measurement.

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
copy's lifetime"). So a retained observable crossing retains **both**
representations, not one.

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

| | predicted by `boxanat.mjs` | measured by `dyncensus` |
|---|---|---|
| nodes per box | 9 | 8.96 (nine, minus the snapshot band) |
| bytes per box | 784 | 783.8 |

`anat0.ts` is the positive control and the instrument **refuses** it — no
snapshot was ever taken, because the arm with no boxing allocates essentially
no `ScrDyn` at all. A control that can only say "yes" is not a control; this
one says "nothing here".

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

## Usage

```sh
node tests/perf/boxanat/boxanat.mjs  --self-test          # 32 checks, both lanes
node tests/perf/boxanat/boxsites.mjs --self-test          # 12 checks
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
