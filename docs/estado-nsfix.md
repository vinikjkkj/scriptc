# estado-nsfix — the CJS dynamic-import namespace is filled, and three leads are left standing

Block `nsfix`, worktree `<blocks>\nsfix\wt`, branch `block/nsfix`, base main
`8927362a8`. Measured 2026-09-08 on win32 x86_64, `zig 0.16.0`
(`<zapo-work>/tools/zig`), `SCRIPTC_TARGET=x86_64-windows-gnu`,
`SCRIPTC_CC=zigcc`, `SCRIPTC_TEST_CC="zig cc"`. Built AND gated under **node
v25.9.0** (`which node` = `<home>/AppData/Local/nvm/v25.9.0/node`, the
SPAWNED binary answers `v25.9.0`), which matters here: the `module.exports`
namespace alias key is v25-and-newer interop, present on v25.2.1 / v25.9.0 /
v26.7.0 and absent on v20.20.2 / v21.6.2 / v22.18.0, all six measured
directly on this host.

---

## 1. The answer, in one line each

- **Fixed.** `--npm-static` plus `await import("pkg")` of a CommonJS
  `export =` package built a namespace of one key (`default`, a trap) where
  node has every lexed name plus `default` and the alias. The two shared no
  key, at exit 0, with zero diagnostics. It now reads the name set off the
  export table the rewrite appends, and refuses where it cannot, with
  **node's own lexer as the last word**. Commit 1.
- **Fixed.** `npm.test.ts > npmstatic-dynimport-cjs` had been red on main
  since the repro fixture landed, in the wrong lane. Commit 2.
- **Refuted.** The position gate, named in the brief as "the smallest honest
  change", is neither. See section 2.

## 2. Why the gate is not the fix, and why the corpus could not have told us

Three measurements, not three arguments:

1. Applied on the parent, it turns **5 of the 6 tests in
   `module-ns-value.test.ts`** red, every one `SC2012 'import()' of
   'purelib' in this position`. Those programs are byte-exact against node
   today. Materializing a namespace at the positions the local-module tier
   refuses is exactly what that path exists for — the suite's own header
   says `.then()` "is the one zapo's own codec writes".
2. It does not fix the defect. The CJS content stays wrong in the two
   spellings the tier *does* serve: `const ns = await import("gtdefine");
   ns.WIDTH` built green and died at run time with `expected number at
   $.WIDTH, got undefined`.
3. Its teaching points the reader at that same broken spelling.

**The instrument matters more than the verdict.** The brief said to price
the gate with a corpus run. `differential.test.ts` never passes `npmStatic`,
so **no corpus program reaches the arm** and a corpus-only measurement
reports the gate as free. The real radius was entirely in the harness
suites, and it was found by enumerating every `--npm-static`
dynamic-import site in the tree — `module-ns-value` (purelib/livelib),
`sqlite-dynimport` (its own arm, above the gate), `import-refusal`, and the
repro fixture — and then running the one suite that could move.

## 3. Three leads, recorded and not chased

### 3.1 argo-codec is still not installed, but the reason now has a name — CHANGED BY THIS BLOCK

zapo's `loadArgo()` shape (`cachedArgo = await import('argo-codec')` inside
a try/catch, into `ArgoModule | null | undefined`) reproduced against the
real package. Before: the namespace was empty, the answer was `null`, and no
reason existed anywhere. After: the `catch` arm runs and receives

    'new TextDecoder with arguments' is part of the standard library types
    but has no scriptc lowering yet [SC2020 at
    argo-codec/dist/cjs/decode.js:6]

The user-visible answer is unchanged — `installed false`, node says `true` —
but it is no longer silent, it is catchable exactly where node puts a load
failure, and it names the next construct to lower. Behind it still stands
the wall the previous block named: `new ns.Reader(...)` on a dynamically
imported namespace, where the class crosses as a trap. That is a design
call, not a bug fix.

### 3.2 The entry path disagrees with node for a dual-build package — PRE-EXISTING, worth its own block

`argo-codec` declares `"type": "module"`, `main: ./dist/cjs/index.js`, and
`exports["."] = { import: ./dist/esm/index.js, require: ./dist/cjs/index.js }`.
Node resolving `import('argo-codec')` takes the **import** condition and
loads `dist/esm/index.js`; `--npm-static` takes `dist/cjs/index.js`. Two
different dependency trees, two different export surfaces, one specifier —
and the divergence is visible in the namespace itself: node answers
`typeof ns.default === "undefined"` (an ESM module with no default export)
where the compiled side has a `default`. Nothing in this block changed
resolution; this is what the tree does today.

### 3.3 A green `--npm-static` build that exits 3 with no output at all — PRE-EXISTING

A tsc-style `defineProperty` barrel that re-exports a **class** compiles
green (`npm-static: x3 compiled statically into the program`, zero
diagnostics) and produces a binary that dies at exit 3 before its first
`console.log`, printing nothing on stdout or stderr. Node prints the value.
Reproduced identically on the parent of this block's fix, on the STATIC
import path this block never touches.

Four files reproduce it: `node_modules/x3/package.json` with
`main: ./dist/index.js` and `types: ./dist/index.d.ts`, then

```js
// dist/wire.js
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ERROR_WIRE = void 0;
exports.ERROR_WIRE = "err";
```

```js
// dist/buf.js
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Reader = void 0;
class Reader { constructor(n) { this.n = n; } read() { return this.n * 2; } }
exports.Reader = Reader;
```

```js
// dist/index.js
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Reader = exports.ERROR_WIRE = void 0;
var wire_js_1 = require("./wire.js");
Object.defineProperty(exports, "ERROR_WIRE", { enumerable: true, get: function () { return wire_js_1.ERROR_WIRE; } });
var buf_js_1 = require("./buf.js");
Object.defineProperty(exports, "Reader", { enumerable: true, get: function () { return buf_js_1.Reader; } });
```

with the `.d.ts` twins and an entry of
`import { ERROR_WIRE } from "x3"; console.log("wire", ERROR_WIRE);`, built
`--backend c --npm-static x3`. Drop `buf.js` and the `Reader` re-export and
it prints `wire err` and exits 0; that one re-export is the whole
difference. The emitted C names the cause:

```c
static ScrClassObj * sc_f__x25_unit_strand_1(void) {
  scr_throw_error_msg_code(SCR_ERR_TYPE, "undefined is not representable in a
    'typeof m1.Reader' slot (a value narrowed or asserted past the type still
    held it)", 118, "SC9004");
```

The `exports.Reader = void 0;` preamble tsc emits widens the hoisted table
value to `typeof Reader | undefined`, and the undefined arm becomes a
throwing strand that fires at module init. `gtdefine` survives the same
`exports.WIDTH = void 0;` preamble because a scalar has a representable
undefined arm; a class does not. **Two defects in one:** the strand should
not be reachable, and an uncaught init throw that prints nothing is a silent
exit.

## 4. The divergence the fix carries

`Object.keys(ns.default)` answers the table's order and includes
`__esModule` (`leaf,WIDTH,__esModule`); node answers module.exports' runtime
INSERTION order and omits it (`WIDTH,leaf`) — tsc stamps the marker
non-enumerably, and the rewrite must respell it as a plain property because
node's lexer links `import { __esModule }` there. Insertion order is a
run-time fact no static table carries. READS agree either way,
`ns.default.leaf === ns.leaf` included. The namespace's own key set matches
node exactly. Measured both sides; stated in `cjsExportTableNsOf`.

## 5. Suites

Run: `module-ns-value` (12), `module-ns-keys` + `npm-static` + `npm` +
`sqlite-dynimport` (152 together), `diagnostics` + `coverage` (176),
`differential` corpus (1866/1866, 1219 s), `llvm-differential` (1865 passed,
4 skipped, 1722 s).

Skipped, each because it neither passes `npmStatic` nor reaches
`staticDynNsBuilderOf`, with both corpus lanes already green:
`linux-differential` (container lane), `node-test`, `island`,
`island-surface`, `ffi`, `library-*`, `prettier-e2e`, `vercel-e2e`,
`oci-manifest`, and the perf suites.

One **pre-existing** lint error is left alone: `lowerer.ts:56`, `'IrLibFn' is
defined but never used`, present on the parent and untouched here.
