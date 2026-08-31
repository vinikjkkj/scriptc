# Upstream probes: evidence, not coverage

Differential programs taken from `vercel-labs/scriptc` during the upstream
survey (merge-base `938f9128`, upstream head `837f6bc6`, 2026-08-31).

**Nothing in this directory is collected by any test glob.** `vitest.config.ts`
includes `tests/harness/**`, `packages/*/src/**` and `packages/*/test/**`;
`differential.test.ts` globs `tests/corpus` only. These programs live here on
purpose: every one of them **fails today**, and the corpus IS the merge gate.
Landing six known-red entries would have taken the base failure set from eight
to fourteen and left every later block to learn which reds to excuse.

Each one is ready to move into `tests/corpus` the day someone closes the gap —
renumber at the tail of the corpus when you promote it, and check the
high-water mark first (the numbers move fast; this set was renumbered once
mid-flight after a sibling took 7330-7332).

Node is the oracle for all of them, exactly as in the corpus: no golden files.

## What each one is, and the exact diagnostic it produces

Measured 2026-08-31 on node v25.9.0, `SCRIPTC_CC=zigcc`,
`SCRIPTC_TARGET=x86_64-windows-gnu`, C backend.

### `top-level-await-implicit-module.ts`, `top-level-for-await-implicit-module.ts`, `top-level-await-ambiguous/`, `top-level-await-module-scope/`

Upstream **#94** (`782d3b84`, "fix(compiler): support implicit top-level await
modules"). Node runs all four.

    SC0001: 'await' expressions are only allowed at the top level of a file
            when that file is a module, but this file has no imports or
            exports. Consider adding an empty 'export {}'.
    SC0001: 'for await' loops are only allowed at the top level of a file
            when that file is a module, but this file has no imports or
            exports.

The two directory cases additionally report:

    SC0001: Cannot redeclare block-scoped variable 'value'.

which is the same defect seen from the other side: a file classified as a
script puts its top-level `const`s in global scope, so two sibling modules
collide on a name that is module-local in Node.

Root cause in our tree is one expression. `isNodeEsmFile7`
(`packages/compiler/src/frontend/program.ts`) ends in
`return ts.isExternalModule(sf)`, which is true only for a file that already
has an import or export. A file whose only module marker IS the top-level
await is therefore classified CommonJS. See the survey report for the sizing:
the fix needs `moduleDetection: Force` **and** a `nearestPackageType` +
syntax-marker replacement for that line, because Force is what makes
`ts.isExternalModule` stop being usable as a runtime-format oracle. ~70 lines
of code, but **1,177 of 1,724 corpus entries change checker scope** in the
same commit. That wants its own block with a corpus budget.

### `filter-truthy-predicate.ts`

Upstream **#153** (`729f8090`). `Array.prototype.filter` applies ToBoolean to
its predicate's result; the predicate need not return `boolean`.

    SC2001: values of type '() => null' cannot be compiled yet
    SC2001: values of type '(n: number) => "" | "yes"' cannot be compiled yet
    SC2001: values of type '(n: number) => number' cannot be compiled yet

A **refusal**, not a wrong answer — which makes it the lowest-value item of the
three. It is here because it is cheap evidence, not because it is urgent.

### `array-isarray-tuples.ts`

Upstream **#154** (`1e4f71dd`). A fixed tuple lowers to a positional
record-shaped IR representation, but it is still a JavaScript array.

    SC1090: element access on non-array values are not supported yet
    SC2004: uses of 'tuple' inherit the blocker on its declaration
    SC2009: values of type 'ReadonlyTupleResult & any[]' cannot be compiled:
            the union shape is supported, but its arm 'TupleModel & any[]'
            does not compile

Note this is a **refusal for us**, not a silent wrong answer. Upstream's own
commit fixed a wrong answer in *their* tree (`Array.isArray` folding to
constant `false`); we refuse the program instead, so the value of taking #154
is lifting a capability limit. It was split out of
`tests/corpus/1549-array-isarray-unions.ts` so that a previously green corpus
entry did not start reading as a regression.

## Programs deliberately NOT taken, and why

These are the ones most likely to be re-imported by someone reading upstream's
corpus and assuming a red means a gap. They do not.

**`2676-indexed-read-strict-equality.ts` and `2677-runtime-optional-closure.ts`
(upstream #95)** abort here with

    scriptc: RangeError: array index 1 out of bounds (length 0)

That is not a defect. It is our documented position, from
`docs/src/app/limitations`:

> **Arrays are dense — invalid indices trap.** scriptc arrays have no
> `undefined` elements. Where JS would produce `undefined` (out-of-bounds
> read, `pop()` on empty), the runtime prints a `RangeError` message and
> aborts. [...] but READING one is a trap naming the index and the length, not
> `undefined`. This catches real bugs — but it means `process.argv[2]` with no
> third argument is a trap, not `undefined`.

The quickstart repeats it. Upstream chose `undefined`; we chose the trap. Those
two programs encode **their** stance, so importing them would park two
permanent reds against a decision we made on purpose. The same reasoning
retires upstream #95's `runtime-optional` fix as a candidate for us: the whole
class depends on `values[0]` yielding `undefined`.

**`2691-retained-lowering-record-order.ts` (upstream #178)** is the same shape
one layer up:

    SC1090: Object.keys over a record this program does not build the way its
            shape enumerates (a record enumerates in its shape declared order,
            not per-object insertion order)

`limitations` documents that too: *"`Object.keys`/`values`/`entries` and
`JSON.stringify` report a record's declaration order, not per-object insertion
order."* By design.

## `2675-process-self-reexec.ts` — excluded entirely, and worth its own block

Upstream #95's self re-exec program. Node answers it in under a second:

    status: 0
    child args: child

The **compiled binary hangs**. With `differential.test.ts`'s `retry: 1` and a
300s `testTimeout`, one such entry costs ten minutes of gate wall-time per
run — a landmine, not coverage, so it is not in this directory either.

It is a real finding and nobody has chased it. The suspects are
`process.execPath` and `process.argv[1]` inside a compiled binary: the program
spawns `spawnSync(process.execPath, [process.argv[1], "child"])`, and in a
compiled scriptc executable `execPath` is the binary itself while `argv[1]` is
not the script path it is under Node. If `argv[1]` is absent or wrong, the
child is spawned with garbage and the parent waits on it forever. Reproduce it
by compiling upstream's program directly rather than through the harness, so a
hang costs seconds instead of ten minutes.
