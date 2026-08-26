# The `instanceof` matrix over the typed-array family

What this measures: for every value the byte-view family can produce, in
every slot shape a real program spells it in, against every constructor a
program can put on the right of `instanceof` — what does the default static
lane answer, and what does node v25.9.0 answer?

**1,160 cells**, scored MATCH / WRONG / TRAP / DID-NOT-RUN / NO-ORACLE. It
was built to answer one question the survey it came from could not: is the
`DataView instanceof Uint8Array` defect one mechanism or fifteen bugs?

The answer, at main `52e9dd38`: **seven wrong cells, all one defect.**

    MATCH  189      the answer matches node byte-for-byte
    WRONG    7      the answer differs -- a SILENT wrong answer
    TRAP   957      the compiler refused the cell BY NAME (loud; acceptable)
    DID-NOT-RUN 0
    NO-ORACLE   0

Every one of the seven is the DataView row: `dv instanceof Uint8Array` in
each of the five slot shapes, plus `Buffer.isBuffer(dv)` and
`dv.constructor === Uint8Array`, which share its mechanism. Nothing else in
the lattice answers wrongly. That is what makes it one fix and not fifteen.

## The five slot shapes

A byte value's *slot* changes the lowering, so the same value is asked in
all five:

| key | annotation | why it is here |
| --- | --- | --- |
| `D` | inferred | `const b = new DataView(...)` — the static fold |
| `U` | `Uint8Array \| ArrayBuffer \| ArrayBufferView` | zapo's own `toBytesView` parameter, verbatim — a TWO-arm union, because the view types collapse |
| `V` | `Uint8Array \| DataView` | the two arms the IR cannot tell apart at all |
| `W` | `ArrayBufferView` | the abstract base, on its own |
| `K` | `unknown` | the checked-dynamic lane — a different lowering entirely |

`P` is the sibling-predicate matrix: `ArrayBuffer.isView`, `Buffer.isBuffer`,
`Object.prototype.toString.call`, `.constructor`/`.constructor.name`,
`structuredClone`, `byteLength`/`length`, each in a typed spelling and an
`any` spelling, because an `any`-read defect must not be reported as a
defect of the property.

## How to reproduce

```sh
# the oracle: node runs the very same file the compiler compiles
node --experimental-strip-types probe-D.ts > node-D.txt

# drive the probe to a program that BUILDS, recording which cell each
# refusal belonged to (a refusal is a TRAP, and it is an acceptable answer)
CLI=<path to cli/dist/main.js> bash harness/iterate.sh D <dir> llvm

# score the compiled run against the oracle
node harness/score.mjs cells-D.json reasons-D.json node-D.txt run-D-llvm.txt scored.json
node harness/table.mjs scored.json
node harness/compare.mjs before.json after.json
```

Nothing is hardcoded as an expected answer: node runs the identical file and
its output IS the reference. A cell the compiler refuses is simply absent
from the compiled program's output and is scored TRAP with the exact
diagnostic that refused it.

Every cell is a self-contained block with its own `try`/`catch`, so one
refusal or one runtime throw cannot take another cell's answer with it, and
`harness/attribute.mjs` maps each diagnostic back to the cell that owns its
line. A diagnostic that lands on no cell is an **orphan** and stops the run
— an unattributable diagnostic would otherwise vanish and look like a clean
build.

## The instrument is armed

`node harness/selftest.mjs` runs four controls and exits non-zero if any
fails:

    ok   a faithful transcript reproduces the recorded tally  (can say "no difference")
    ok   one flipped answer is reported WRONG                 (can fail)
    ok   a missing answer is reported DID-NOT-RUN, not MATCH  (cannot pass by silence)
    ok   a cell the oracle never answered is reported NO-ORACLE

The selftest itself was armed: with `score.mjs` edited so it can never
return `WRONG`, it reports `3/4` and exits 1.

## Files

    harness/gen.mjs        generate one shape's probe + the line->cell map
    harness/gen-pred.mjs   the sibling-predicate probe
    harness/iterate.sh     build -> attribute refusals -> disable -> repeat
    harness/attribute.mjs  map a diagnostic to the cell whose lines it hit
    harness/score.mjs      MATCH / WRONG / TRAP / DID-NOT-RUN / NO-ORACLE
    harness/table.mjs      the matrix as a text table
    harness/compare.mjs    N WRONG->MATCH, M MATCH->WRONG, and every other move
    harness/selftest.mjs   the four armed controls
    runs/matrix.txt        the rendered matrix, before and after
    runs/compare.txt       every cell that moved, and the two backends against each other
    runs/node-*.txt        the oracle transcripts
    runs/{pre,post}-*.json the scored cells

`pre-*` is the compiler at `52e9dd38`, the revision the defect was found on;
`post-*` is this branch, rebased onto main `6a8fb0a8` and re-measured there.
The rebase moved no cell: the AFTER tallies are identical before and after it,
on both backends, and both backends agree on all 1,160 cells.
