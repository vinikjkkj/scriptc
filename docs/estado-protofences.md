# block/protofences — the last two [SCxxxx] fences in zapo's protobuf bundle

Worktree `G:\blocks\protofences` (branch `block/protofences`, from main `2b05d613`).
Lab `G:\blocks\protofences-lab`, tmp `G:\blocks\protofences-tmp`, env in `env.sh`.

Bundle under test: `spec/proto/index.js`, **1,867,556 bytes, 0 newlines**.
`md5 680f3f54018866359344f5b9023f3aa4` — identical in
`G:\zapo-work\app\node_modules\zapo-js\spec\proto\index.js` and in the
provenance cache `caches/provenance/250f9af5.../spec/proto/index.js`.

---

## PHASE 1 — what node v25.9.0 ACTUALLY does at both sites (measured, not read)

Everything below was RUN under `node v25.9.0` (`/c/Users/vinicius/AppData/Local/nvm/v25.9.0`),
against a byte-copy of the real bundle with a 102-byte probe tail appended
(`probe-bundle.js`, exposing the bundle's own `f` = long factory and `l` = inquire factory).
zapo itself was not modified.

### Site 2 — long.js's WebAssembly accelerator: **value-identical, with ONE exception**

`long-matrix.mjs` — 8,804 rows: `mul`, `div`, `rem`, `negate().multiply()`,
`fromString`, `fromNumber`/`toNumber`, over 33 boundary values
(0, +/-1, +/-2, +/-3, +/-7, +/-10, +/-255, 256, 65535/65536, INT32 bounds,
2^32 +/- 1, 2^53-1, INT64 MIN/MAX, UINT64 MAX, 2^40, and mixed magnitudes),
for BOTH `unsigned=false` and `unsigned=true`. Two processes:
`wasm` (untouched) and `nowasm` (`globalThis.WebAssembly = undefined`, so the
`new WebAssembly.Instance(...)` expression throws and the bundle's bare
`catch {}` eats it — exactly the shape the lowering would produce).

    8,804 rows compared.  8,738 identical.  66 differ.
    ALL 66 are the same single case: Long#modulo(0).
      wasm   : THROW WebAssembly.RuntimeError "remainder by zero"
      nowasm : THROW Error                    "division by zero"
    Value diffs (non-THROW rows): **0**.

`Long#divide(0)` does NOT diverge — `divide` guards zero in JS before it ever
reaches the wasm export, so both lanes throw `Error: division by zero`.
Only `modulo` skips that guard and lets the wasm `rem_s`/`rem_u` trap.

`long-fuzz.mjs` — 200,000 deterministic pseudo-random `fromBits` pairs
(alternating signed/unsigned; every 7th divisor forced to a high=0 word to
concentrate the small-divisor path), each producing mul + div + rem:

    md5 fz-wasm.txt   = 4a1bb2f3c51efc97f4d419e31eed057a
    md5 fz-nowasm.txt = 4a1bb2f3c51efc97f4d419e31eed057a
    diff: 0 lines.

**Verdict:** the JS fallback is value-identical. The entire measured divergence
is the error *class and message* thrown by `Long#modulo(0)` — a case that
throws in both lanes.

### Site 1 — protobufjs `inquire`: never called, and would return null anyway

- **The proto bundle issues ZERO `require()` calls when it loads.** Instrumented
  `Module.prototype.require` around the load: the only entry is the load of the
  bundle itself. esbuild inlined protobufjs's `inquire("long")`; the bundle
  computes `util.Long` from its own bundled long module (`f()`), not through
  `inquire`.
- `.inquire` occurs **exactly once** in 1.87 MB: the assignment `t.inquire=l()`.
  There is **no call site for it anywhere in the bundle**.
- `rg -a -l inquire` over the whole zapo provenance tree, bundle excluded:
  only `package-lock.json`. zapo's own source never calls it.
- Resolution check from the bundle's REAL directory
  (`app/node_modules/zapo-js/spec/proto/`): `require.resolve('long')` →
  **MODULE_NOT_FOUND**. So even if it were called, node's `inquire('long')`
  returns `null` — the same answer the fallback gives.
- Node DOES resolve builtins through it: `inquire('buffer')` and `inquire('fs')`
  return real modules. So a blanket "inquire always returns null" lowering is
  NOT universally node-equivalent — it is equivalent *for every specifier this
  bundle can reach*, and the function is unreachable here regardless.

### Is there a second, load-bearing WebAssembly user in zapo?

    rg -a -l 'new WebAssembly\.'  over the whole provenance tree  -> 1 file
    rg -a -l 'new WebAssembly\.'  over app/node_modules           -> 1 file
    both: spec/proto/index.js

`packages/voip/src/media/mlow-codec.ts` (the one flagged as worth a look) has
**no `WebAssembly` reference**. It does `import('libmlow-wasm')` — a dynamic
import of an npm package that is **declared in `packages/voip/package.json`
(^0.1.1) but NOT installed in this tree**. Under node v25.9.0 today that import
rejects with MODULE_NOT_FOUND and `loadMlowModule` rethrows (it does not
swallow). A WebAssembly interpreter would not change that: the missing thing is
the npm package, not the engine.

---

## PHASE 2 — the reproduction, in 30 s instead of 928 s

`analyze()` over wam's package entry takes ~928 s (wamfences' measurement),
so both fences were reproduced in synthetic `--npm-static` packages first.
The shape that matters is NOT "a .js file": it is a .js file whose CHECKER
errors preflight suppresses (`nodeModulesJsSuppressed` /
`npmStaticFileSuppressed`, program.ts). A plain local `.js` is checked, so
`WebAssembly` there is SC0001 "Cannot find name" and the build stops before
lowering — three probes died that way before the shape was right.

    lab/app/wroot/node_modules/wprobe/index.js   long.js's accelerator, verbatim shape
    lab/app/wroot2/node_modules/gprobe/index.js  the undeclared-global matrix
    lab/app/rroot/node_modules/rprobe/index.js   protobufjs's inquire, verbatim shape

Each built `--best-effort --npm-static <pkg>`, both backends, oracle node v25.9.0.

### The two fences, exactly as the emitted C spells them

From `G:\blocks\wamfences-lab\bin\wam-entry2.BASE.c` (141,679,052 bytes, the
base-main translation unit):

    scr_throw_error_msg_code(SCR_ERR_ERROR,
      "constructing values other than classes declared in the program is not
       supported yet [SC1090 at .../spec/proto/index.js:1]", 184, "SC1090");

    bool sc_t8 = scr_require_verdict(sc_t3, sc_t4, sc_t5, sc_t6, sc_t7);
    if (sc_t8) { scr_throw_error_msg_code(SCR_ERR_ERROR,
      "'require() with a run-time specifier' is part of the standard library
       types but has no scriptc lowering yet [SC2020 at .../index.js:1]", 208, "SC2020"); }

Both sit inside `/* try */ ... goto sc_catch_0` — they are ORDINARY catchable
throws, which is why the floor is a byte-exact MATCH with six fences in it.

### What the compiler ALREADY says about WebAssembly (measured, before any change)

`gprobe`, both backends, against node v25.9.0:

| expression | scriptc (base) | node v25.9.0 |
| --- | --- | --- |
| `typeof WebAssembly` | `undefined` | `object` |
| `WebAssembly` | THROW `Error: the reference to 'WebAssembly' (a binding form with no lowering) [SC1090 ...]` | `[object WebAssembly]` |
| `WebAssembly.Module` | same SC1090 | `function Module() { [native code] }` |
| `new WebAssembly.Module(u8)` | THROW `Error: constructing values ... [SC1090 ...]` | `[object WebAssembly.Module]` |
| `NoSuchGlobalXyz` | same SC1090 reference fence | THROW `ReferenceError: NoSuchGlobalXyz is not defined` |
| `NoSuchGlobalXyz.k` | same | same ReferenceError |
| `new NoSuchGlobalXyz()` | SC1090 construct fence | same ReferenceError |

So the compiler was ALREADY telling this file that WebAssembly is absent
(`typeof` answers `undefined`) while fencing every use of it — and it was
fencing three sites where Node's answer is a plain, specified ReferenceError
this runtime already implements (`global.undefRead`, the `declare const
__VERSION__` stance).

## PHASE 3 — the change: `d646cfa2`

`lower-exprs.ts`, the identifier fallthrough one line above
`rejectUnresolved(... 'a binding form with no lowering')`: a bare name with no
value symbol, **in a JavaScript source only**, lowers to `global.undefRead` —
ECMA-262 6.2.5.5's ReferenceError "<name> is not defined".

Reach: an unresolved name in TypeScript is tsc's TS2304 → SC0001 → the build
fails at preflight and never lowers. Program `.js` is checked the same way.
What survives to that line is exactly the JS preflight suppresses on purpose:
node_modules JS, `--npm-static` packages, workspace-linked shipped JS. That is
the third-party-bundle world, which is where zapo's bundle lives.

Direction: every name reaching that line REFUSED a moment ago, so the only
thing that changes is WHICH error the site throws. A fence is never turned
into a value.

Patch applied in Python binary mode. `git diff --numstat`: **27 added, 0
removed**; `lower-exprs.ts` LF-only line count **27 before and 27 after**
(CR 20531→20558, LF 20558→20585 — the delta is equal, which is the audit).

### Measured after

| probe expression | before | after |
| --- | --- | --- |
| `NoSuchGlobalXyz` | TRAP (SC1090) | **MATCH** |
| `NoSuchGlobalXyz.k` | TRAP (SC1090) | **MATCH** |
| `new NoSuchGlobalXyz()` | TRAP (SC1090) | **MATCH** |
| `WebAssembly` / `.Module` / `new .Module()` | SC1090 throw (WRONG bytes) | ReferenceError throw (WRONG bytes, no tag) |
| `typeof WebAssembly` | `undefined` (WRONG) | unchanged |

`wprobe` — the long.js accelerator shape — before and after:

    t===null true / fallback yes      (both, unchanged)
    fences in the emitted C:  1 SC1090  ->  0

The library's own bare `catch` eats the ReferenceError exactly as it ate the
fence, `t` stays null, and the pure-JS path runs. **0 MATCH→WRONG.**

Engine scan on every probe binary: `quickjs=0 ScrDyn=0 JS_NewRuntime=0`.

## PHASE 4 — wasm3, priced

### The whole WebAssembly surface in zapo is 286 bytes

Extracted the byte array from the bundle and parsed it (`wasm-long.wasm`):

    286 bytes, five sections:
      type 13 | function 7 | global 6 | export 50 | code 191
    NO import section, NO memory section, NO table, NO start, NO data.

Six exports (`mul`, `div_s`, `div_u`, `rem_s`, `rem_u`, `get_high`), one
mutable i32 global, all arithmetic on i32 lo/hi pairs. It is the smallest
possible WebAssembly module: pure compute, no linear memory, no imports.
And it is the ONLY one — `rg -a -l 'new WebAssembly\.'` over the whole
provenance tree AND over `app/node_modules` returns this one file.

### The cost, measured

wasm3 v0.5.0, 12 core TUs (13,597 lines of C), `zig cc -target
x86_64-windows-gnu -O2 -DNDEBUG`, linked against a C main that parses the
real 286-byte module, finds `mul` and calls it (it answers 42 for 7x6):

| | bare C hello-world | + wasm3 |
| --- | --- | --- |
| image | 188,416 B | **301,056 B** (+112,640) |
| peak working set | 3,739,648 B | **3,870,720 B** (+131,072 = +128 KiB) |

(8 KiB wasm stack; the module declares no linear memory, so that is the floor.)

### The cost that decides it: it is an INTERPRETER

`w3bench.exe`, 2,000,000 calls each, two runs agreeing:

    wasm3 mul     27.5 - 28.7 ns/call
    wasm3 div_s   28.0 - 28.3 ns/call
    native int64   0.25 ns/op

In scriptc the "fallback" long.js takes is **compiled to native C**. Routing
it through a bytecode interpreter is ~110x SLOWER per operation. The only
performance argument for vendoring wasm3 runs backwards.

### And it buys nothing on values — 208,804 comparisons say so

See PHASE 1. Adopting wasm3 would recover exactly two observable things:
`typeof WebAssembly === "object"`, and `Long#modulo(0)` throwing
`WebAssembly.RuntimeError: remainder by zero` instead of `Error: division by
zero`. In exchange it opens `Module`, `Instance`, `Memory`, `Table`, `Global`,
`compile`/`instantiate`/`validate`, the three error classes, i64<->BigInt
conversion and node-exact trap messages as new byte-exactness surface.

**Verdict: not worth it.** Numbers above.

## PHASE 5 — the second target's BASE census, taken by another block today

`G:\blocks\sizespeed-lab\builds\base\messaging.bench.c` — 130,235,288 bytes,
written 2026-09-01 13:05 by the `sizespeed` block from
`bench-client5/messaging.bench.ts --best-effort --provenance-sources` on main
`2b05d613`. Its fence census over the C:

    1  [SC1090 at .../prov/250f9af5.../spec/proto/index.js:1]      <- the WebAssembly accelerator
    1  [SC2020 at .../prov/250f9af5.../spec/proto/index.js:1]      <- protobufjs's inquire
    20 other fences, all in the BENCH's own TypeScript:
       17 SC1090 + 1 SC2004 + 1 SC2002 in messaging.bench.ts / _store-factory.ts
       1  SC2011 in __inspector-stub.ts

So the two proto fences are confirmed on a second, independent translation
unit at base, on a different entry, measured by a different block.

## The floor, re-verified on this host today

    G:\blocks\twininit-lab> ./bin/wam-entry2-be.c.exe | diff - bin/wam-entry2-be.node.out
    exit=0, no diff — 17 lines byte-identical, 15 `ok` assertion lines.

Nothing in `G:\blocks\twininit-lab` was written to. My copy of the driver and
the corpus is byte-identical to it (`md5 d659086f56edf31129ee221bb4e53f1c` on
`drivers/wam-entry2.ts`; `diff -rq` clean over `pkgs/`).

## PHASE 6 — SC2020, protobufjs's `inquire`: why it does NOT come out here

Reproduced in 30 s: `rprobe`, the inquire body verbatim in an `--npm-static`
package, builds clean on both backends and emits exactly

    1  [SC2020 at .../rprobe/index.js:6]     (`var t = require(e)`)

### What the lowering already does, and where the residue is

`lowerBareRequireCall` -> `runtimeSpecifierRequire` (lower-builtins.ts) emits a
TERNARY:

    cond:  module.requireVerdict(spec, roots, from, builtins, importsScope)
    then:  error.fenceThrow            <- the [SC2020] text
    else:  dyn undefined               <- unreachable

`scr_require_verdict` (scr_require.c) already answers Node EXACTLY for
everything Node itself rejects: `ERR_INVALID_ARG_TYPE` for a non-string,
`ERR_INVALID_ARG_VALUE` for `""`, `ERR_UNKNOWN_BUILTIN_MODULE` for a bad
`node:` name, `ERR_PACKAGE_IMPORT_NOT_DEFINED` / MODULE_NOT_FOUND for `#`
imports, and the catchable require-site MODULE_NOT_FOUND for every path and
bare root the build proved absent. It returns `true` — the fence — only where
**Node hands back a module**: a real `node:` builtin, a bare root that IS in
the baked node_modules chain, a relative/absolute path that exists, or a root
NODE_PATH might serve.

### Why the tag cannot be removed without a new representation

The value the fence stands in for is a **module namespace object**, and this
compiler names that as a missing feature in six separate places
(`lower-builtins.ts:336`, `lower-namespaces.ts:1161/1188`,
`lower-exprs.ts:1398`, and the two comments at `lower-builtins.ts:546/569`):
"module namespace objects as first-class values". It is not a one-site
conservatism like the four wamfences removed; it is the feature.

And the tag is emitted **unconditionally as the ternary's then-arm**, so no
amount of build-time knowledge about the root set removes it from the
translation unit — measured two ways: `rprobe`, where `long` IS resolvable,
and the real bundle, where it is not, both emit exactly one SC2020.

Anything cheaper would be a lie in the loud direction:
* answering `null` is the WRONG ANSWER this fence exists to prevent (Node
  returns a module — measured: `inquire('buffer')` and `inquire('fs')` return
  real modules under v25.9.0);
* throwing MODULE_NOT_FOUND for `node:fs` claims Node cannot find a module it
  finds;
* dropping the `[SCxxxx]` tag while keeping the throw hides a real refusal
  from the census, which is the one thing this fleet ranks below a refusal.

### What it would take

A module-namespace value: a compiled module's exports as a dyn record, plus a
run-time table from resolved specifier to that record, for the program modules
and the supported builtins. That is the feature named above, not a fence fix.

### It is also DEAD in this bundle

`.inquire` occurs exactly once in 1.87 MB — the assignment `t.inquire=l()`.
There is no call site anywhere in the bundle, `rg -a -l inquire` over zapo's
own source (bundle excluded) matches only `package-lock.json`, and loading the
bundle under node v25.9.0 issues **zero** `require()` calls. So the fence is
compiled-in dead code today: it cannot fire in any zapo program that exists.
