# SEMANTICS.md - the deliberate divergences from Node, RECONSTRUCTED

RECONSTRUCTED from the citations in the tree on 2026-10-02, because the original
was never committed. `git log --all --diff-filter=A -- '*SEMANTICS*'` returns
empty: no commit on any branch ever added this file, and it is not gitignored.
The same command finds `RELEASING.md`'s creation commit, so the search works.

The numbering itself is real and used with discipline: 124 files cite this
document by number, the runtime C included (`SEMANTICS.md divergence 55`, twice,
in `scr_tls.c`). Only the document was missing. The README's public claim --
"the deliberate divergences from Node are documented and numbered; nothing
diverges silently" -- is therefore true about the PRACTICE and false about the
VERIFIABILITY: nobody outside the tree could read divergence 55.

This file is DERIVED, not authoritative. Every entry is rebuilt from what the
citing sites say about themselves. Nothing is inferred or filled in: a number
whose citations do not explain what diverges is listed INCOMPLETE rather than
guessed at. If the original ever appears, it supersedes this file entirely.

    numbers cited in the tree        52 distinct
    real registry entries            49
    not registry entries              3   (prose, and one work-block ref)
    DESCRIBED from their citations    46   93.9%
    INCOMPLETE                        3   (16, 27, 45)

Citations appear in three spellings -- `divergence N`, `stance N`, and a bare
`SEMANTICS.md N` -- all referring to this registry. An earlier count of "25
numbers in 1-68" was wrong twice over: it searched only one of the three
spellings, and `stance [0-9]+` also matches "in-stance 5" in ordinary prose.

---

## 1-68: the core registry

### 1 - Lone surrogates become U+FFFD

`String.fromCharCode` combines adjacent surrogate pairs and substitutes U+FFFD
for lone surrogates. Storage is UTF-8, which cannot represent an unpaired
surrogate. Printed output still matches Node byte-for-byte, because Node writing
a lone surrogate to stdout produces the same replacement bytes.

    packages/runtime/src/scr_lib.c:4275
    packages/runtime/src/scr_runtime.h:7509

### 2 - String indexing and empty-separator split inherit that policy

Indexing and `split("")` work per UTF-16 code unit, so splitting an astral pair
yields halves that store as U+FFFD. Same cause as 1.

    packages/runtime/src/scr_string.c:1571
    packages/compiler/src/frontend/lowering/surfaces.ts:402

### 4 - An invalid array index TRAPS where JS reads undefined

`xs[i]` and typed-array element reads trap on any index outside `[0, len)`,
where JS answers `undefined`. One exception: under `--npm-static`, package
files get an OOB-SAFE read answering `elem | undefined`, because package JS is
inference-typed guard-style code whose last-element probes the trap would break.

    packages/compiler/src/frontend/lowering/lower-exprs.ts:12822
    packages/compiler/src/frontend/lowering/lower-containers.ts:1386

### 11 - An uncaught error prints one line, with no stack trace

Node prints a source excerpt and a stack trace, and its display shows the
CONSTRUCTOR's name where that differs from `.name`. scriptc prints exactly
`Uncaught <toString>` -- Node's first line -- and nothing else. Exit code is 1
in both, and pre-throw stdout is intact.

    tests/corpus/1304-errors-uncaught.ts:4
    tests/harness/errors.test.ts:9

### 12 - `process.execPath` is the compiled binary's own path

Node's is the node executable's path. The compiled binary resolves its own
absolute path instead. Same family as the argv[0]/argv[1] story.

    packages/runtime/src/scr_runtime.h:2839
    packages/compiler/src/ir/nodes.ts:4786

### 13 - errno errors carry `code`, but not `errno`/`syscall`/`path`

A failing syscall throws a real `Error` with Node's message text and `code`
stamped to the errno name; `errno`, `syscall` and `path` stay unrepresented. An
exotic errno stamps its `E<num>` spelling where Node would carry the uv name.
The same stamping reaches `'error'` events (spawn, dgram).

    packages/runtime/src/scr_lib.c:1761
    packages/compiler/src/ir/nodes.ts:5967

### 16 - INCOMPLETE

Cited once, at `tests/corpus/1531-delete-optional-fields.ts:6`, as "Field names
are alphabetical (divergence 16's corpus convention)". The site uses the number
for a test-file convention and never states what diverges from Node. Not
reconstructible from its citation.

### 23 - Promisified callback builtins answer an ALREADY SETTLED promise

A compiled binary has no threadpool, so `util.promisify`'d builtins (the
fs/promises stance, zlib's async twins) run their work synchronously and return
a settled promise. The `await` still yields to the microtask queue, so ordering
against other promise work is unchanged.

    packages/compiler/src/frontend/lowering/lower-builtins.ts:3015
    packages/compiler/src/ir/nodes.ts:4675

### 27 - INCOMPLETE

Cited once, at `tests/corpus/1482-spawnsync-error.ts:1` ("divergence 27
revisited"). The comment describes `spawnSync`'s `error` property behaving
exactly like Node's uv `errnoException` -- it documents PARITY, not what
diverges. Not reconstructible from its citation.

### 34 - A keyed write outside the field's arms THROWS instead of storing

Spread or assign into a declared shape validates each key against the
destination field: a value outside the field's arms throws a catchable
TypeError, where Node's untyped copy would store it. A key naming NO declared
field is DROPPED; Node keeps it invisibly. See 68 for when dropping is honest.

    packages/compiler/src/frontend/lowering/lower-exprs.ts:12147
    packages/compiler/src/frontend/lowering/lower-exprs.ts:12332

### 35 - A width-lifted union arm is a COPY

Lifting a record or array arm into a destination arm rebuilds it, so the result
does not alias the source -- unlike the identity-preserving plain re-wrap.
Ambiguity (several liftable destination arms) declines rather than guessing.

    packages/compiler/src/frontend/lowering/lowerer.ts:11025
    packages/compiler/src/frontend/lowering/lower-containers.ts:737

### 36 - Key order is the shape's first-seen DECLARATION order

`JSON.stringify`, `Object.keys/values/entries`, record-to-dyn conversion and
`util.inspect` all emit declaration order. JS's per-object INSERTION order
matches it whenever objects are constructed in declaration order; this entry
documents the divergence when they are not.

    packages/compiler/src/ir/nodes.ts:1828
    packages/compiler/src/frontend/types.ts:7614
    packages/compiler/src/backend/emission/emit-walkers.ts:3135

### 37 - A field holding the undefined arm is SKIPPED by key walks

`for-in` and `Object.keys/values/entries` over a record iterate declaration
order with undefined-arm fields skipped at runtime. The key list snapshots at
loop entry, which IS Node's for-in contract for keys added during the walk.

    packages/compiler/src/frontend/lowering/lower-stmts.ts:9937
    packages/compiler/src/frontend/lowering/lower-stmts.ts:10021

### 38 - A lying assertion throws instead of smuggling the wrong arm

`x!` and `u as Arm` on a union are CHECKED extractions: the asserted arm's
payload comes out, any other arm throws a catchable TypeError. Node's `as` is
erasure. Unchecked erasure here would peek one arm's payload through another
arm's struct -- a segfault, or a silently wrong field.

    packages/compiler/src/frontend/lowering/lower-exprs.ts:598
    packages/compiler/src/frontend/lowering/lower-exprs.ts:5358
    packages/compiler/src/frontend/lowering/lower-exprs.ts:14905

### 44 - Bytes crossing to the static tier are COPIED, not aliased

`await r.bytes()` into a typed `Uint8Array` slot is a validated copy; writes on
the static side stay static and never reach the island's buffer.

    packages/compiler/ambient/scriptc-node-fallback.d.ts:695
    tests/fixtures/npm/cases/bytes-exit/main.ts:23

### 45 - INCOMPLETE

Cited at `packages/compiler/src/ir/nodes.ts:7118` and
`packages/compiler/src/frontend/lowering/lower-exprs.ts:17675`. Both describe
`v instanceof Uint8Array` on a dyn value as Node-EXACT (Node's Buffer IS a
Uint8Array subclass, so both worlds answer true) and then defer "the bytes
kind's other divergences" to this number without naming them. The divergence
itself is stated at no citing site.

### 46 - Absent array slots trap; `PromiseSettledResult` drops two fields

`Array.from({ length: n })` without a mapper builds absent slots: union types
carrying an undefined arm read JS-exact, every other refcounted element kind
holds NULL and TRAPS on read where Node yields `undefined`. Separately, the
`PromiseSettledResult` mapping keeps an honest subset -- `value` and `reason`
have no record-field representation -- though a dropped initializer still
EVALUATES in its source-order slot.

    packages/compiler/src/ir/nodes.ts:6474
    packages/compiler/src/ir/nodes.ts:6837
    packages/compiler/src/frontend/types.ts:4207

### 48 - A failed listen SETTLES the server; write-after-end drops

After a failed `listen`, listeners drop and the handle leaves the registry; a
later `listen()` starts fresh with the pre-failure listeners gone, where Node's
would survive. An error listener capturing its own server would otherwise cycle
forever -- the RC audit caught exactly that. On the HTTP client, a write after
end is dropped.

    packages/runtime/src/scr_net.c:3376
    packages/runtime/src/scr_http.c:2564

### 50 - An async exec rejection does not carry Node's numeric `.code`

`execFile`'s async rejection carries Node's message and `spawn <file> ENOENT`
with `.code`, but the exit status Node puts on a Command-failed rejection's
numeric `.code` is not carried. `maxBuffer` and `windowsHide` are accepted
no-ops.

    packages/compiler/src/frontend/lowering/lower-builtins.ts:3585
    packages/compiler/src/frontend/lowering/lower-builtins.ts:3684

### 51 - A nonparticipating capture group reads `""`, not `undefined`

`match`/`matchAll`/`exec` and `$1` answer `""` for a group that did not
participate, where Node distinguishes it from a participating-empty `""` by
answering `undefined`. Both are falsy, so only guarded forms are
byte-comparable. A function replacer's unprovable group parameter is refused at
COMPILE time rather than quietly answered `""`.

    packages/compiler/src/frontend/lowering/lower-exprs.ts:19739
    tests/corpus/2608-regex-named-groups.ts:49

### 54 - `pipe` has no backpressure; code-less messages leave `.code` undefined

`req.pipe(dest)` streams chunk-for-chunk with no backpressure; the body's
natural end ends the destination, which is Node's pipe default. Error codes are
recovered by parsing the message, exact over this runtime's closed message set
-- but a code-less message such as "socket hang up" leaves `.code` undefined.

    packages/compiler/src/ir/nodes.ts:4017
    packages/runtime/src/scr_child.c:3611
    packages/runtime/src/scr_http.c:391

### 55 - A field explicitly assigned `undefined` reads as ABSENT

`"a" in {a: undefined}` is `true` in JS and `false` here: an optional field is a
runtime tag test on the slot, and the undefined arm means absent. The same
answer now covers class fields, so a class field and a record field say the
same thing about the same value. On a dyn receiver `in` stores presence and
answers true -- the checked-dynamic tree does not share this stance.

    packages/compiler/src/frontend/lowering/lower-exprs.ts:18342
    packages/compiler/src/frontend/lowering/lower-exprs.ts:18764
    packages/compiler/src/ir/nodes.ts:7175

### 56 - `{ k: undefined }` in a conditional spread collapses to absence

In `...(cond ? { k: v } : {})`, a slot that already spells "absent" -- an
undefined-armed union -- is written holding that arm, so an explicit
`{ k: undefined }` true-arm becomes absence. A slot that cannot hold undefined
carries presence beside the value instead.

    packages/compiler/src/frontend/lowering/lower-exprs.ts:10792
    packages/compiler/src/frontend/lowering/lower-containers.ts:9550

### 57 - `node:http2` is a COMPATIBILITY slice over HTTP/1.1

`createSecureServer({ allowHTTP1: true, cert, key })` is the https server
without an eager handler, and ALPN advertises `http/1.1` ONLY. Every connection
is served as HTTP/1.1, so no HTTP/2 session ever exists and `'sessionError'`
can never fire.

    packages/compiler/ambient/scriptc-node-fallback.d.ts:2667
    packages/compiler/src/ir/nodes.ts:4225
    packages/compiler/src/ir/validate.ts:785

### 60 - `process.versions.node` is a COMPATIBILITY TARGET

No Node exists under a compiled binary, so this reports the version whose
semantics the runtime implements. The other components `@types/node` lists (v8,
openssl, ...) do not exist here; openssl and sqlite are declared optional, so
absence reads cleanly.

    packages/runtime/src/scr_runtime.h:2846
    packages/compiler/src/ir/nodes.ts:4794
    packages/compiler/ambient/scriptc-node-fallback.d.ts:137

### 62 - `Math.random()` matches Node's distribution, not its sequence

A uniform double in `[0,1)` at the spec's 53-bit granularity, drawn from
`arc4random_buf`. No seeded sequence exists to match, so the corpus pins
invariants and never bytes.

    packages/compiler/src/ir/nodes.ts:3352
    packages/runtime/src/scr_runtime.h:1380

### 66 - Runtime tls/https options records fence at the member

A non-literal options value reads `cert`/`key` at runtime through a dyn walk;
out-of-bounds members throw the catchable fence rather than resolving.

    packages/compiler/src/ir/validate.ts:753
    packages/compiler/src/backend/emission/emit-exprs.ts:5496

### 67 - A caught exception crossing to dyn is type-erased for non-Errors

The snapshot preserves identity for dyn payloads (retained, not copied) and
uses the identity-cached error encoding for the Error family; scalars cross by
value; EVERYTHING ELSE becomes a type-erased empty object. `v instanceof Error`
on an unknown value is true exactly for that error encoding, so a caught Error
through an `unknown` slot answers true like Node.

    packages/runtime/src/scr_async_dyn.c:609
    packages/runtime/src/scr_runtime.h:2778
    packages/compiler/src/ir/nodes.ts:7134

### 68 - A declared shape DROPS a spread's undeclared runtime keys

Merging into a DECLARED type drops source keys that name no declared field: the
shape cannot represent them, and the declared type says they do not belong.
Honest only for declared types -- for a type tsc merely INFERRED from an object
literal, dropping would be a silent wrong answer, so that path recovers the
erased index signature instead.

    packages/compiler/src/frontend/types.ts:6729
    packages/compiler/src/frontend/types.ts:7175
    packages/compiler/src/frontend/lowering/lower-exprs.ts:8055

---

## 102-138: assert, inspect, and the JS tier

### 102 - assert failures print the header line WITHOUT the value diff

Rendering Node's `+ actual - expected` value diff needs `util.inspect`, which
has no static lowering. The generated message is Node's header line alone.

    packages/runtime/src/scr_assert.c:20
    packages/runtime/src/scr_assert.c:324
    packages/runtime/src/scr_runtime.h:10260

### 103 - No colored character diff on a TTY

Node renders a COLORED character diff for string pairs when stderr is a color
TTY; this runtime always emits the plain stacked form, including the `^`
first-difference indicator.

    packages/runtime/src/scr_assert.c:13

### 104 - A non-Error thrown value PROPAGATES under an assert expectation

`assert.throws` and `assert.rejects` let a non-Error thrown value propagate,
where Node builds an AssertionError from its inspection.

    packages/compiler/src/frontend/lowering/lower-assert.ts:660
    packages/compiler/src/frontend/lowering/lower-assert.ts:804

### 105 - Assert messages read `.name`, not `constructor.name`

Node prefers `constructor.name` when reporting a mismatched or unwanted error;
this runtime carries the `name` slot. Identical for the builtin hierarchy;
differs for subclasses whose constructor name differs from `name`.

    packages/runtime/src/scr_assert.c:1414
    packages/runtime/src/scr_runtime.h:10332

### 106 - Exotic C1 and Unicode escapes are out of scope in inspection

Value inspection follows `util.inspect`'s default quoting (single, then double,
then backtick; C0 controls and DEL escaped). C1 and exotic Unicode escapes are
not modeled.

    packages/runtime/src/scr_assert.c:26

### 107 - `lastIndex` statefulness is not modeled

No regex in this runtime carries `lastIndex` state, so `g`/`y`-flagged regexes
test like their flag-free twins. This entry covers reused stateful regexes.

    packages/runtime/src/scr_regex.c:819
    packages/runtime/src/scr_regex.c:821

### 115 - A dyn value cannot ride typed storage, and dyn cycles never collect

A dyn value may be held in locals and captured by closures -- an untraced
obj-box, so cycles through dyn are NEVER collected. It cannot ride record or
class fields, array elements, union arms, or the exception cell, and most
operations on it are frontend-rejected with a hint to validate with an `as`
cast first.

    packages/compiler/src/ir/nodes.ts:474

### 116 - Surplus arguments in `.js` evaluate and DROP

tsc's arity families do not gate `.js` builds, so a `.js` call may pass more
arguments than the function takes. JS evaluates them in order and drops them;
effect-free surplus drops at compile time.

    packages/compiler/src/frontend/lowering/lower-calls.ts:736
    packages/compiler/src/frontend/lowering/lower-calls.ts:835
    tests/corpus/1760-surplus-args-drop.cjs:2

### 117 - A boxed closure adapted to a zero-argument thunk sees undefined

The thunk delivers JS's zero-argument invocation, so every parameter sees
undefined; a parameter whose type does not admit undefined fails its check and
throws the catchable TypeError.

    packages/compiler/src/frontend/lowering/lower-calls.ts:3147

### 138 - `process.emitWarning` emits SYNCHRONOUSLY

Node defers a tick through `nextTick` -- the MaxListenersExceeded precedent --
and this runtime emits at the call. The default stderr report always prints,
because a compiled binary has no `--no-warnings`.

    packages/runtime/src/scr_async_dyn.c:436
    packages/runtime/src/scr_runtime.h:6589

---

## 285-372: the island, npm-static, and the deferral entries

### 285 - An island stringify root that DROPS produces the TEXT "undefined"

The engine's own `JSON.stringify` runs, so key order, nesting, `toJSON` and
getters match Node by construction -- but the result converts through the
engine's ToString, so a root the stringify drops (undefined, a bare function, a
symbol) yields the TEXT "undefined" where Node yields the undefined VALUE.
tsc's own lib types the return as `string`, so no statically-typed consumer can
distinguish them.

    packages/compiler/src/frontend/lowering/lower-builtins.ts:4512
    tests/corpus/2171-island-json-stringify.ts:9

### 287 - The ESM startup-crash channel

Named only by contrast, at `packages/compiler/src/frontend/npm.ts:675`: an
unresolved `require` is a RUNTIME throw at the require site and is catchable --
the optional-dependency try/require pattern depends on exactly that -- UNLIKE
the ESM channel this number covers, which crashes at startup.

    packages/compiler/src/frontend/npm.ts:675

### 289 - A `Date` string stops at the GMT offset

The prelude's Date patch: quickjs-ng stops at the GMT offset where Node appends
the parenthesized timezone name.

    tests/harness/web-globals.test.ts:229

### 305 - class-to-record width is a COPY, and `instanceof` still answers true

Building a record from a class instance, or an instance from a record, produces
a FRESH value: mutations do not alias, and extra class members drop. Where Node
would hold a plain object answering false, `instanceof C` answers true here.

    packages/compiler/src/frontend/lowering/lowerer.ts:9267
    packages/compiler/src/frontend/lowering/lowerer.ts:9483

### 335 - A `return undefined` the representation cannot hold TRAPS

A declared return type with no undefined arm makes `return undefined` compile
to the stranded-unit trap -- a loud TypeError from compiled code where Node
answers undefined.

    tests/harness/npm-static.test.ts:361

### 358 - `Promise.try` has a one-tick residue on the promise-returning form

`Promise.try(f)` is an immediately-invoked async wrapper around `f`,
tick-for-tick in Node for plain results; the promise-returning form rides the
async return-adoption machinery, whose one-tick residue is this entry.

    packages/compiler/src/frontend/lowering/lower-builtins.ts:10584

### 370 - `node:module` is admitted per-member for program code

Under `--npm-static`, an opted-in package importing `node:module` admits for
PROGRAM code behind per-member fences, but marks the PACKAGE an offender:
`createRequire`'s static story covers only literal-specifier requires.

    packages/compiler/src/frontend/program.ts:2826

### 372 - Definite-assignment DEFERS instead of fencing

A `!`-asserted field assigned past the constructor's top level -- and, with
`strictPropertyInitialization` off, a field assigned only in a method -- rides
`T | undefined`, and reads extract the declared type. The fence survives only
where the deferral cannot carry the type: a MAP-typed field, since map arms
cannot join a union.

    tests/diagnostics/unassigned-fields.ts:5
    tests/diagnostics/spi-off/main.ts:6

---

## 700-701: dynamic import of the program's own modules

### 700 - Exports with no island representation cross as TRAP functions

Node's namespace holds the real class; here an export the island cannot
represent becomes a pointed trap.

    tests/harness/island.test.ts:624

### 701 - The dynamic-import namespace is a SNAPSHOT, not live bindings

Node's module bindings are live, so mutating an exported `var` after the import
is visible through the namespace. Here the namespace is taken when the import
resolves, and keeps answering the old value.

    tests/harness/island.test.ts:626
    tests/harness/island.test.ts:664

---

## Unnumbered: observed, documented nowhere

This section holds TWO kinds of entry and they are not the same thing. Most
are archaeological: behaviour that already diverged, found by reading, whose
number was lost with the original document. The rest are NEW -- divergences
this project introduced deliberately and chose to record here rather than
claim a number. Each entry says which it is, because a reader who cannot tell
them apart will read a decision we made as a fact we discovered.

### An error has no `stack` property

No error object in this runtime carries a `stack` property: the string "stack"
appears in no runtime `.c` file at all. Node appends a stack trace to every
error; here there is nothing to append and nothing to read. The uncaught
printer states it directly -- Node appends a stack trace, scriptc has none --
and divergence 11 numbers the OUTPUT shape that follows from it, but the
absence of the property itself has no number.

Measured 2026-10-02 while reading the error unit. Listed here because the
README names "error-object properties" as one of the two main divergence
classes, and this is one of them. NO number is assigned: numbering is the
registry owner's call, and inventing one would corrupt the sequence this
document was rebuilt from.

    packages/runtime/src/scr_exception.c:350
    packages/runtime/src/scr_error.c:23

### An idle event loop may hand SQLite's page cache back (CONDITIONAL, OFF by default)

KIND: NEW. Introduced 2026-10-03, not archaeological.

Node running better-sqlite3 never releases page cache on an idle event loop;
nothing in that stack does. This runtime can: when a connection has gone
untouched for a configured window, the loop calls sqlite3_db_release_memory on
it at the seam where it has no runnable work.

IT IS A MEMORY DIVERGENCE, NOT A BEHAVIOURAL ONE, and that is why it is
recorded rather than numbered. sqlite3_db_release_memory frees only UNPINNED
pages. It changes no query result, no error, no row order, no value, and no
pragma readback; a program cannot observe it except through process memory --
which is the axis it exists to move. Measured on a 129.6 MB database, the
settled floor falls 17.3 MiB with no sustained cost: a request every 100 ms
against a 1000 ms window gives a median 0.33 ms FASTER than the control, p10,
p90 and max overlapping or lower, because connections used inside the window
are skipped rather than released.

IT IS CONDITIONAL, and this is the part that makes the entry honest. The
feature ships OFF. SCR_SQLITE_IDLE_RELEASE_MS=0 is the default, the seam then
costs one integer compare, and NO BINARY DIVERGES FROM NODE UNLESS SOMEONE
SETS THAT VARIABLE. A conditional divergence is a more precise statement than
a number would be, which is the other reason not to assign one.

NO number is assigned, for the reason the entry above gives and which applies
unchanged here: numbering is the registry owner's call, this document is a
reconstruction, and inventing a number would corrupt the sequence it was
rebuilt from. The decision not to assign one was taken deliberately, not
deferred.

    packages/runtime/src/scr_async.c  (the seam tenant, and why it does not clamp)
    packages/runtime/src/scr_sqlite.c (the per-connection last-use stamp)

### `Promise.race` settles INLINE on an already-settled entry — one turn early

KIND: archaeological. The behaviour already diverged; it was found by
measuring, not by reading, on 2026-10-05.

`scr_promise_race_add` settles the result promise SYNCHRONOUSLY when the entry
it is handed is already settled — first add wins, inside the construction of
the race itself. Node subscribes to every entry with `.then`, so even an
already-settled entry delivers through a promise reaction job and the result
settles one microtask turn later.

Measured against Node v25.9.0 with a microtask ruler, both backends:

    await Promise.race([settled, settled])     Node 2 turns     scriptc 1

The VALUE is identical, the settlement ORDER among the entries is identical,
and losing entries keep their own settlements on both sides. Only the turn the
result lands on differs, which is observable exactly where a second,
independent job chain is running alongside — and nowhere else.

`Promise.all` has the same mechanism with the same measured number
(`scr_promise_all`: an already-settled entry runs `scr_promise_all_settle`
inline, and an all-settled input list fulfils the result before the function
returns). `await Promise.all([settled, settled])` is Node 2 turns against
scriptc 1. `tests/corpus/1438-promise-all.ts` describes the inline settle in
its header as a feature of the lowering; nothing recorded it as a divergence.
It is folded into this entry rather than given its own because it is one
mechanism in two surfaces, and splitting it is the registry owner's call too.

The third member of this family — `return p` from an async function, which
lowers as `return await p` and so costs one turn where Node's resolve-with-a-
thenable costs two — is already numbered: divergence 358 names the
`Promise.try` face of it.

THESE THREE ARE PINNED AS THEY ARE, not as a fault awaiting repair.
`tests/harness/microtask-turns.test.ts` asserts the scriptc number for each
with Node's beside it. Changing any of them moves observable order and is
separate work with its own differential: the stackless async re-lowering this
was measured for must not carry an ordering change in the same diff, or no
later failure can be attributed to either.

NO number is assigned, for the reason the two entries above give and which
applies unchanged here: numbering is the registry owner's call, this document
is a reconstruction, and inventing a number would corrupt the sequence it was
rebuilt from.

    packages/runtime/src/scr_async.c  (scr_promise_race_add, scr_promise_all)
    packages/compiler/src/frontend/lowering/lowerer.ts (asyncReturnFlatten)
    tests/harness/microtask-turns.test.ts (the pinned table)

---

## Numbers cited in the tree that are NOT registry entries

    2717    prose at tests/harness/node-types-divergence.test.ts:113,
            a sentence that happens to contain the number
    3921    a work-block reference at tests/corpus/3932-*.ts:32
            ("the same stance 3921 took"), not a registry number
    5       matched only through the `stance N` spelling, which also
            matches the "in-stance 5" of ordinary prose. The only real
            `stance` citations are 37 and 55, both entries above. A
            boundary-less search for this spelling additionally reports
            0, 1 and 3 from the same prose, and they are not citations
            either.
