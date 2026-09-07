# `app182` — the zapo-js 1.8.2 arm of the REST driver

`zapo-rest.ts` here is a **byte-identical copy** of `../app/zapo-rest.ts`
(`md5 0614385b3c1f10f77527225aff690e4f` for both, and `diff` between them is
expected to be empty). Only `package.json` differs:

| | `app/` | `app182/` |
|---|---|---|
| `zapo-js` | 1.6.2 | **1.8.2** |
| `@zapo-js/store-sqlite` | 1.0.2 | **1.2.0** |

`store-sqlite` moves with it because 1.2.0 is the matched partner —
its `peerDependencies` are `zapo-js: ^1.7.0`, so 1.0.2 is not a legal pair
for 1.8.x.

## Why a copy and not a symlink or an import

**The entry path selects the dependency tree.** The build resolves a
program's packages from the `node_modules` beside its ENTRY FILE, and
`--provenance-sources` then fetches attested source for whatever versions it
finds there. So the two arms have to be two directories with two
`package.json` files and two installs; one entry cannot be built against two
dependency sets.

* A **symlink** would not help: it resolves to `../app/zapo-rest.ts`, whose
  neighbouring `node_modules` is the 1.6.2 one — the arm would silently build
  1.6.2 while claiming 1.8.2, which is the worst available outcome.
* An **import** (a thin entry re-exporting the real one) moves the program's
  body back under `../app/`, so its imports resolve against 1.6.2 again, with
  the same silent-wrong-version result.
* Keeping the copy **byte-identical** is what buys back the safety a shared
  file would have given: `diff ../app/zapo-rest.ts zapo-rest.ts` is the drift
  check, and it must stay empty. If the two ever diverge, the comparison
  between arms is no longer measuring the library bump.

## Build

Same recipe as `../app`, with a **distinct `-o` directory**:

```sh
cd tests/perf/zapo-rest/app182 && npm install
cd <worktree>
node packages/cli/dist/main.js build \
  tests/perf/zapo-rest/app182/zapo-rest.ts \
  -o <out-182>/zapo-rest-182.exe \
  --provenance-sources
```

**The separate `-o` DIRECTORY is load-bearing, not tidiness.** The compiler
names its intermediate from the ENTRY basename
(`index.ts:770` — `cPath = join(opts.outDir, "<stem>.ll")`), and both arms'
entries are called `zapo-rest.ts`. Built into one directory they both write
`zapo-rest.ll`, and `main.ts` removes that file when it finishes unless
`--keep-c` — so whichever arm finishes first deletes the intermediate the
other's toolchain is still reading. A distinct `-o` filename is NOT enough;
it must be a distinct directory.

## Status — measured 2026-09-07

Both numbers below are STRICT builds (no `--best-effort`, which defers
refusals into runtime throws and would read low for no reason), counted by
call site off the build log with

```sh
rg -a -c ' - error SC[0-9]{4}: ' <log>
```

and cross-checked against the compiler's own `N errors.` summary line. Both
arms exit non-zero, so neither has a fence count — **n/a, not 0**.

| revision | log bytes | sites | roots | cascade (SC2004) |
|---|---|---|---|---|
| `2197c855` (this directory's own commit) | 38,934 | **65** | 45 | 20 |
| `0c5e3821` (main, four walls later) | 21,595 | **29** | 19 | 10 |
| `6b38b02c` (main, two more lowerings later) | 19,261 | **24** | 14 | 10 |
| `ad7b3153` (block/typerules, the two type-system rules) | 14,391 | **15** | 11 | 4 |
| `036479ce` (block/typerules on main@`874e78b8`, all four rules) | 13,436 | **13** | 9 | 4 |

The 77 that first motivated the bump was taken one commit earlier, before
`9cd9bffa` closed the 12-site WeakMap group: 77 − 12 = the 65 recorded here.

**37 sites closed, 1 uncovered, 28 unchanged** (65 − 37 + 1 = 29). Closed:
all 25 of `util/proto-stream.ts` (the `AsyncIterator` root at `:64` and the
`ProtoStreamReader` method wall it cascaded into), the 3 of
`client/persistence/history-blob.ts` (`zlib.createUnzip`), the 4 of
`transport/binary/decoder.ts` (`WeakMap<readonly string[], …>`), the 4
`.startsWith`-with-position sites in `protocol/jid.ts` and
`transport/binary/encoder.ts`, and `media/crypto/WaMediaCrypto.ts:508`
(`copyWithin`). Uncovered: `util/proto-stream.ts:256` — `stack.length -= 1`,
which the old `AsyncIterator` wall reached first and so hid.

### 29 -> 24 -> 15

`6b38b02c` is the same arm five sites lower, with no work aimed at it: the
compound-`length` lowering took `util/proto-stream.ts:256` (the site the old
`AsyncIterator` wall had hidden) and `transport/binary/encoder.ts`, and the
ES-module `require` rule took the three `crypto/nativeBackend.ts` reads that
were SC2020 refusals.

`ad7b3153` is aimed at it, and it is TYPE-SYSTEM RULES rather than missing
lowerings: **9 sites closed, 0 uncovered, 15 unchanged** (24 - 9 = 15).
Closed:

* the four of `signal/session/SignalProtocol.ts` (`:111` and `:153`, plus
  the two SC2004 on `local`) -- `Promise.all([options.localIdentity ??
  requireLocalIdentity(store), generateSerializedKeyPair()])`. The
  heterogeneous combinator already admitted a `Promise<T> | null` entry; its
  rule was written as "one promise arm and one UNIT arm" while the reason
  behind it only ever required "exactly one PROMISE arm";
* the five of `transport/node/builders/privacy.ts` (`:169` plus four SC2004)
  -- `const { pnJid, username, displayName } = target` over a union source.
  The same three reads a union RECEIVER already answers now serve the
  pattern; the identical function written as `target.pnJid` compiled before
  the change and the destructure spelling of it did not.

### 15 -> 13, and the type-system group is finished

The `15` row was taken on `ad7b3153`, i.e. before this branch was
rebased onto `874e78b8`; shape unification landed in between and was NOT
weighed against this arm on its own, so the 15 -> 13 step below is
attributed to the two rules named in it and to nothing else only
because the closed set is exactly their two sites.

`036479ce` closes the last two of the four rules. **2 more closed, 0
uncovered** (15 - 2 = 13), for **11 of the 24 closed in total**:

* `client/coordinators/WaPrivacyCoordinator.ts:383` --
  `await activeRefresh?.catch(() => undefined)` over a
  `Promise<unknown> | null`. `awaitUnionExpr`'s result must be `void` or a
  union and the checker's answer here is neither, so the refusal was about
  the NODE rather than the semantics; the lowering writes the semantics out
  as a tag test over a ternary, and closes the union-payload shape with it.
* `crypto/nativeBackend.ts:70` -- `error instanceof ReferenceError`.
  `ReferenceError` is a real runtime class now (kind 5, base `%Error`),
  because the alternative -- comparing the name -- answers TRUE for
  `const e = new Error("x"); e.name = "ReferenceError"`, which Node calls
  false. The class alone was not enough: reading `error.message` after the
  narrow was a pre-existing INTERNAL COMPILER ERROR that fired for
  `TypeError` too, and an ICE aborts `analyze()` and reports nothing at
  all, so the whole builtin hierarchy now narrows out of `unknown` through
  the runtime's identity cache.

**The remaining 13 are 9 roots and 4 cascade**, and none of them is a
type-system rule:

| file | sites | what |
|---|---|---|
| `signal/session/encoding.ts` | 4 | `WeakMap<object, Uint8Array>` |
| `crypto/nativeBackend.ts` | 5 | `:73` destructures a **dyn** source, plus its 4 SC2004 |
| `protocol/abprops.ts` | 2 | a 1,900-field record width, and `Object.freeze` of a possibly-aliased value |
| `client/coordinators/WaMessageDispatchCoordinator.ts` | 1 | SC2003: a width coercion inside a **promise payload** |
| `client/events/privacy.ts` | 1 | SC1090: `?.` over a keyed read whose IR union is wider than the checker's type |

The last three were judged and deliberately left. The dyn destructure is
the honest refusal: the only static route from `unknown` to a named
property is the checked cast, which narrows the admitted receiver from
"any JS value" to "an object" — measured, the equivalent two-line spelling
`const src = (error ?? {}) as {...}; src.code` compiles and matches Node
for an Error and for `null`, and TRAPS on a number where Node reads
`undefined`. The other two are the keyed read's width and a promise-payload
width lift, both of which live in the record-width neighbourhood rather
than in the type rules.

The streamed history-sync path — `openHistoryBlobStream` inflating through
`createUnzip`, then `streamProtoFields` walking it through
`ProtoStreamReader` — is **one diagnostic away**: `history-blob.ts`,
`history-sync.ts` and the `ProtoStreamReader` class are all clean, and the
only refusal left on the path is the `stack.length -= 1` inside
`streamProtoFields` itself.

### The record-width four: three closed, one upheld

Measured on `7adee17b` (this branch's base), strict, `--provenance-sources`,
built under node v22.18.0, counted by call site off the build log with
`rg -a -c ' - error SC[0-9]{4}: '` and cross-checked against the compiler's
own `N errors.` summary. Every build here exits non-zero, so none of them
has a fence count — **n/a, not 0**.

| revision | log bytes | sites |
|---|---|---|
| `7adee17b` (base) | 15,062 | **13** |
| `block/widthrest`, the two width rules | 11,621 | **11** |
| `block/widthrest`, plus the freeze initializer | 11,074 | **10** |

**3 closed, 0 uncovered, 10 unchanged**, and the site list is otherwise
identical line for line.

* `client/coordinators/WaMessageDispatchCoordinator.ts:867` — SC2003. The
  diagnosis held: the source is not a union. `Promise.resolve({ phash })`
  inside the sender-key fanout's `customize` hook lands in a
  `Promise<C> | C` slot, and `resolve<T>(value: T): Promise<Awaited<T>>`
  puts a conditional type between the slot and T — so the literal keeps its
  own inferred members and the value arrives as `Promise<{ phash: string }>`.
  What stands between that and `Promise<C>` is a WIDTH COERCION INSIDE A
  PROMISE PAYLOAD, the one conversion `coercibleValue` does not carry, so
  `promiseCoerceAdapter` declines and the union path reports the mismatch in
  a message about unions. Closed at the LITERAL: it is built at the slot's
  shape, exactly as `const v: C = { phash }` is, so the promise is
  constructed at the slot's payload and no conversion exists to run.
  Teaching the width family into the payload instead would have routed it
  through the adapter's `async (p) => coerce(await p)` — a microtask turn
  node does not take, which is a wrong answer and not a cost.
* `client/events/privacy.ts:114` — SC1090. The `?.` rule was not the bug and
  the keyed read was: the HEADER-FAMILY canonicalization in
  `mapRecordTypeInner` interns every index-signature shape whose slot
  carries a `string[]` arm as one shape over the canonical outgoing slot
  `number | string | string[] | undefined`, and its gate asked only that the
  array arm be present. So `Readonly<Record<string, readonly string[] |
  undefined>>` was swept into the header world and its reads handed out four
  arms where the declaration (and tsc) say two — leaving `?.` three
  surviving non-unit arms instead of one. The gate now also asks for the
  `string` ARM, which is what says header world: a parsed header value IS a
  string and the array arm is only the repeated-header case.
* `protocol/abprops.ts:55` — SC2020, `Object.freeze of a possibly-aliased
  value`. This one had been read as a reasoned refusal (an aliased target's
  later writes would need the runtime frozen bit), and the reasoning is
  sound — it just was not what refused this site. `freezeFreshLocal` proves
  freshness by requiring the binding's initializer to BE the allocation, and
  it read that initializer BARE: `const acc: string[] = []` passed and
  `const acc = [] as string[]` did not, for the same allocation at the same
  place. Measured, not argued — the two spellings differ by an SC2020 and
  nothing else. The initializer now unwraps `as`/`satisfies`/parentheses and
  the angle-bracket assertion exactly as the freeze ARGUMENT one function up
  already does. Not a style question here: `{} as Record<AbPropName, …>` is
  the only spelling tsc accepts for a bag keyed by a literal union, so the
  cast was forced and the gap was the whole fence.

`protocol/abprops.ts:47` — SC2002, `{} as Record<AbPropName,
AbPropConfigEntry>` — is UPHELD, and the completion machinery is REACHABLE
from this spelling: the identical program with `Record<Name, Entry |
undefined>` compiles today and prints Node's `0` for `Object.keys`, so
`recordWidthPlan`'s `absent` arm serves the empty-object-into-a-wide-record
case whenever the value type is optional-flavored. What refuses THIS one is
the value type. `AbPropConfigEntry` is a required record with no undefined
arm, so there is no representation of "absent" for the 1,900 completed
members and `Object.keys` would go from Node's `[]` to 1,900 keys. Nor is
the loop's own filling an answer: it writes every key before the value
escapes, but a keyed write only records presence once the per-instance
ownmask has a WRITER at every record construction — the deferred
required-added-field class, whose absence is why `ownPresentCondC` falls
back to `true` when mask byte 0 is zero. Closing `:47` is that work and
nothing smaller.
