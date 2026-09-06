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

## Status at the time of writing

1.8.2 does not compile yet: 77 diagnostics against 0 on the 1.6.2 arm. The
WeakMap group (12 of the 20) is fixed; `AsyncIterator`
(`util/proto-stream.ts:64`, 1 root plus 24 cascade) and `zlib.createUnzip`
(`client/persistence/history-blob.ts:102`) are owned by other blocks, and
both sit on the streamed history-sync path that motivated the bump.
