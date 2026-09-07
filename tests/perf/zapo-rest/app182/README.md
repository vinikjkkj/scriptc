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

Remaining per file (sites): `crypto/nativeBackend.ts` 6,
`signal/session/encoding.ts` 4, `protocol/abprops.ts` 2, and one each in
`client/coordinators/WaMessageDispatchCoordinator.ts`,
`client/coordinators/WaPrivacyCoordinator.ts` and
`client/events/privacy.ts`.

The streamed history-sync path — `openHistoryBlobStream` inflating through
`createUnzip`, then `streamProtoFields` walking it through
`ProtoStreamReader` — is **one diagnostic away**: `history-blob.ts`,
`history-sync.ts` and the `ProtoStreamReader` class are all clean, and the
only refusal left on the path is the `stack.length -= 1` inside
`streamProtoFields` itself.
