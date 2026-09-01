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

## PHASE 7 — the first target: wam's package entry, on this branch

`drivers/wam-entry2.ts --backend c --provenance-sources --best-effort`,
`SCRIPTC_PROVENANCE_AUTHORED_JS=1`, compiler at `d646cfa2`. Provenance
resolved on every package (no `fetch failed` anywhere in the full log):

    provenance: @vinikjkkj/wa-wam@2.3000.1041713829-1ec0d3b <- ... (source compiles statically)
    provenance: zapo-js@1.6.2 <- ... (source compiles statically)
    provenance: argo-codec@0.2.1: no provenance attestation published; island path used

Emitted C: `bin/wam-entry2.c`, **141,042,754 bytes**. Fence census over the C
(`rg -a -o '\[SC[0-9]{4} at [^]]*\]'` — the `.ll` interns identical string
constants and under-reports):

    1  [SC2020 at .../prov/250f9af5.../spec/proto/index.js:1]

**One fence. Total.**

    6  at base main (wamfences' record: 1 SC1090, 1 SC2012, 4 SC2020)
    2  after wamfences merged      (the two proto fences)
    1  here                        (SC1090 gone)

---
# NEW SCOPE — implement WebAssembly

## STAGE 1 — the artifact check on `libmlow-wasm`. It IS WebAssembly, and only that.

Installed copy: `G:\blocks\twininit-lab\app\node_modules\libmlow-wasm@0.1.1`
(it is NOT in `G:\zapo-work\app\node_modules` nor in the provenance checkout —
my earlier "not installed" note was true of those two trees and wrong about
the corpus app, which is the one that matters).

    dist/index.js                     28,846 B   the public API
    dist/generated/libmlow.generated.mjs  642,918 B   Emscripten glue  <- the ONLY one index.js imports
    dist/generated/libopus.generated.mjs  559,526 B   Emscripten glue  (dead: nothing imports it)
    dist/discordjs.js                  3,299 B

**No `.wasm` file. No `.node` native addon. No download, no `locateFile`.**
The module is embedded in the glue as a JS string literal and decoded by the
package's own two-line `binaryDecode` (`o[i] = ~c>>8 & c`).

Verified by RUNNING it, not reading it: `WebAssembly.instantiate` was
instrumented and the package's own code path exercised end to end under node
v25.9.0 —

    package exports: Application, Bandwidth, Bitrate, DecoderCtl, EncoderCtl,
      OpusError, OpusErrorCode, Signal, createDecoder, createEncoder,
      getMlowPacketInfo, getPacketInfo, isOpusError, loadLibopus,
      opusGlobalCreate, opusGlobalFree
    loadLibopus() -> {"version":"libopus 1.0.1"}
    encode(960 Int16 samples)  -> 586-byte packet, first bytes 187,131,252,11,...
    decodeFloat(packet)        -> 960 Float32 samples, [100] = 0.002840107074007392

**Exactly ONE module is instantiated**, 544,879 bytes. So a WebAssembly engine
is exactly the right thing; there is no native fallback to prefer.

## STAGE 2 — the module's inventory (`cap-0.wasm`, 544,879 bytes, version 1)

Full parse, 214,692 opcodes decoded across 339 function bodies, **zero
unknown**, 148 distinct opcodes.

| section | bytes |
| --- | --- |
| type | 605 (65 types) |
| import | 37 (6 functions) |
| function | 341 (339 funcs) |
| table | 5 (funcref, min=max=11) |
| memory | 7 |
| global | 9 (1 global) |
| export | 188 (38 exports) |
| element | 26 (1 segment) |
| datacount | 1 (119) |
| **code** | **421,219** |
| **data** | **122,404** (119 segments) |

### The number that decides the whole project

    memory: min=386 pages = 24,704 KiB, max=32768 pages (2 GiB), not shared

Measured at run time, not read: the instantiated module's exported memory is
**25,296,896 bytes = 24.13 MiB**, and node's `process.memoryUsage().external`
rises from 2.33 MiB to 26.99 MiB across `loadLibopus()` — +24.66 MiB.

**The user's target is ~20 MB peak RSS. This module's linear memory ALONE is
24.13 MiB**, before any interpreter, before scriptc's own runtime, before the
544,879 bytes of module that has to be held to run it. Running libopus and
holding a 20 MB RSS ceiling are arithmetically incompatible. That has to be
settled before any engine work, because no engine choice changes it.

### Feature set beyond the MVP — small, and fully enumerated

    bulk-memory (memory.copy / memory.fill / memory.init / data.drop)  408 occurrences
    sign-extension-ops (i32/i64.extend8_s/16_s/32_s)                   313 occurrences
    nontrapping-float-to-int (i32/i64.trunc_sat_f32/f64_s/u)           182 occurrences

    SIMD:                    0 occurrences   (no 0xfd prefix anywhere)
    threads/atomics:         0 occurrences   (no 0xfe prefix anywhere)
    reference-types beyond the MVP funcref table: 0
    multi-value, tail-call, GC, exception-handling: 0

So the requirement is **WebAssembly 1.0 + three finished proposals**, all three
of which are shallow: sign-extension is five opcodes, non-trapping float→int is
eight, bulk-memory's four memory ops are the only ones used (`table.*` bulk ops
do not appear).

Arithmetic is overwhelmingly **i32 and f32**; i64 appears (i64.store 701,
i64.const 508) but is not the hot path. Top opcodes: local.get 57,773 ·
i32.const 30,880 · i32.add 14,559 · local.tee 13,413 · local.set 11,264 ·
i32.load 5,378 · i32.shl 5,173 · br_if 4,834 · f32.load 3,994 · f32.mul 3,507.
664 `unreachable`.

### The JS boundary is REAL — six imports, all Emscripten runtime, captured live

    a.a  _emscripten_set_timeout(which, ms)   -> setTimeout, and the callback
                                                RE-ENTERS wasm (__emscripten_timeout)
    a.b  emscripten_resize_heap(size)         -> memory.grow driven from JS
    a.c  proc_exit(code)                      -> throws ExitStatus
    a.d  _emscripten_runtime_keepalive_clear
    a.e  fd_write(fd, iov, iovcnt, pnum)      -> walks HEAPU32/HEAPU8 and prints
    a.f  abort("")

No imported memory and no imported table — both are module-declared and
exported. But `fd_write` and `resize_heap` read and write the linear memory
through JS typed-array views, and `set_timeout` schedules a host callback that
calls back into the instance. Any engine has to serve all three faithfully.

## STAGE 3 — the half that is not WebAssembly at all

`mlow-codec.ts:30` is `import('libmlow-wasm')` — a DYNAMIC IMPORT OF A PACKAGE
whose entry is a 28,846-byte ESM module that itself statically imports a
642,918-byte Emscripten glue file. Before any wasm opcode runs, a compiled
binary has to:

  * resolve and load a bare-specifier dynamic import (`import('pkg')`);
  * compile the glue, which is minified ESM using `globalThis.window`,
    `globalThis.WorkerGlobalScope`, `process.versions.node`,
    `await import("node:module")` + `createRequire(import.meta.url)`,
    `setTimeout`, `TextDecoder`, and eight typed-array heap views;
  * carry `Promise<MlowModule> | null` — which is the **SC2009 recorded for
    weeks as "voip's other independent stop"** (`mlow-codec.ts:26`).

A perfect engine behind an unresolvable import is worth nothing. This half is
sized separately and reported before any engine is written.

## STAGE 4 — the engine choice, measured against the REAL module

### wasm3 v0.5.0 runs libopus. Not "should" — it does.

`w3opus.c`: a bare C host that reads `cap-0.wasm` (the 544,879-byte module
captured out of the running package), links the six imports with their real
signatures — `a.a (i32,f64)->i32`, `a.b (i32)->i32`, `a.c (i32)->void`,
`a.d ()->void`, `a.e (i32,i32,i32,i32)->i32`, `a.f ()->void`, decoded from the
type section rather than guessed — and then compiles the WHOLE module rather
than the lazily-reached subset.

    module 544879 bytes
    before env                   peakWS= 4.21 MiB
    parse ok
    after parse                  peakWS= 4.45 MiB
    load ok
    link ok
    after link                   peakWS=28.59 MiB     <- the 24.13 MiB linear memory lands here
    found export h
    call h ok
    after call                   peakWS=28.59 MiB
    compile whole module: ok                            <- every one of 339 bodies
    after compiling exports      peakWS=31.27 MiB

`m3_CompileModule` returning `ok` over all 339 bodies is the proof that wasm3
accepts every opcode in the inventory: all 408 bulk-memory, 313
sign-extension and 182 non-trapping-float-to-int occurrences included. No
build flags were needed — stock v0.5.0, `zig cc -target x86_64-windows-gnu
-O2 -DNDEBUG`, 12 core TUs.

It also runs the long.js accelerator correctly: `mul(7,0,6,0)` answers 42.

### Cost, measured on this host

| | bare C hello-world | + wasm3 (long.js, 286 B) | + wasm3 (libopus, 544 KB) |
| --- | --- | --- | --- |
| image | 188,416 B | 301,056 B (+112,640) | 303,616 B (+115,200) |
| peak WS | 3.74 MiB | 3.87 MiB | **31.27 MiB** |

Interpreter speed, 2,000,000 calls, two agreeing runs:

    wasm3 mul    27.5 - 28.7 ns/call
    wasm3 div_s  28.0 - 28.3 ns/call
    native int64  0.25 ns/op

### What that means for each of the two consumers — opposite answers

**long.js: do NOT route it through an engine.** Its fallback is compiled to
native C by scriptc, and it is value-identical to the WASM path over 208,804
measured comparisons (PHASE 1). Sending it through wasm3 makes it ~110x
slower and recovers exactly two observable things: `typeof WebAssembly ===
"object"`, and the error class thrown by `Long#modulo(0)`. (Note: once a
WebAssembly global exists at all, long.js takes the engine path automatically
whether or not that is wanted — the library's own `if (t)` decides. Any
implementation therefore has to accept the 110x on long, or the global has to
stay absent. That is a real design constraint, not a footnote.)

**libopus: an engine is the ONLY answer.** No pure-JS path exists, the
`.catch` re-throws, and the consumer awaits it with no fallback.

### The size constraint, stated honestly

The link line has no `-ffunction-sections` and no `--gc-sections`, so an
unconditional unit lands in every binary — but `cc.ts` already has the gating
mechanism for exactly this (`abortSignal`, `fetchStatic`, `wsGlobal`,
`tlsCa` … each compiles its runtime unit only when the IR says the program
uses it). So the +115 KiB of engine is affordable and gateable.

**The 24.13 MiB of linear memory is not.** It is the module's own declared
minimum, it is allocated at instantiate, and no engine choice changes it.
Against a ~20 MB peak-RSS target and a bench binary already at 25.7 MB image
with 87% `.text`, a binary that instantiates libopus measures **31.27 MiB peak
working set in a BARE C host** — before any of scriptc's runtime. This needs
a decision from the user before engine work continues: the target and this
codec cannot both hold, and the honest options are (a) the ~20 MB target
applies to binaries that do not instantiate libopus, (b) the target moves for
voip, or (c) voip's codec stays refused.

## PHASE 8 — the SECOND target: the messaging bench, same construct, different TU

`benchapp/tree/packages/fake-server/bench-client5/messaging.bench.ts
--backend c --best-effort --provenance-sources`, compiler at `d646cfa2`.
Emitted C: `bench/messaging.bench.c`, **130,898,721 bytes**.

| | base (sizespeed's `builds/base/messaging.bench.c`, main `2b05d613`, same day) | here |
| --- | --- | --- |
| `[SC1090 at .../spec/proto/index.js:1]` | **1** | **0** |
| `[SC2020 at .../spec/proto/index.js:1]` | 1 | 1 |
| SC1090 in the bench's own TS (`messaging.bench.ts` x18, `_store-factory.ts:91`) | 19 | 19 |
| SC2002 / SC2004 / SC2011 in the bench's own TS | 3 | 3 |
| **total** | **24** | **23** |

Exactly one fence moved, and it is the proto SC1090. A different entry, a
different translation unit, a different lab, measured independently at base by
another block — which is the check that the CONSTRUCT was fixed rather than
one site.

## Score so far

**wam's package entry:  1 TRAP-fence removed, 0 MATCH→WRONG.**  6 → 2 → **1**.
**the messaging bench:   1 TRAP-fence removed, 0 MATCH→WRONG.**  24 → **23**.
**probes:                3 TRAP→MATCH** (`NoSuchGlobalXyz` as a value, as a
member receiver, and under `new`), byte-exact against node v25.9.0 on both
backends, `quickjs=0 ScrDyn=0 JS_NewRuntime=0`.

## STAGE 5 — the OTHER half: what has to compile before any opcode runs

Static inventory of `libmlow-wasm/dist/generated/libmlow.generated.mjs`
(642,918 bytes, 2 newlines — minified ESM) and `dist/index.js` (28,846 B):

| surface | count | note |
| --- | --- | --- |
| `WebAssembly.instantiate` | 1 | the only compile/instantiate entry point used |
| `WebAssembly.RuntimeError` | 1 | trap classification |
| typed-array heap views | 10 distinct | Int8/Uint8/Int16/Uint16/Int32/Uint32/Float32/Float64/**BigInt64**/**BigUint64** |
| `TextDecoder` | 2 | plus `globalThis.TextDecoder` feature-test |
| `setTimeout` / `clearTimeout` | 3 / 1 | the `a.a` import; its callback RE-ENTERS wasm |
| `await import("node:module")` | 1 | then `createRequire(import.meta.url)` |
| `import.meta.url` | 2 | |
| `require("node:fs")` / `("node:path")` / `("node:url")` | 3 | through that createRequire |
| `globalThis.window` / `.WorkerGlobalScope` / `.process` | 4 | environment feature-tests |
| `process.argv` / `.argv.slice` / `.exitCode` | 4 | |
| `performance.now` | 1 | |
| `Symbol.dispose` (index.js) | 2 | explicit resource management |
| `Atomics` / `SharedArrayBuffer` / `Worker` / `crypto` | **0** | no threads, no worker pool |

So the non-WebAssembly half needs: a **dynamic import of a bare package
specifier**, `import.meta.url`, `createRequire` off it, ten typed-array views
over a `WebAssembly.Memory` buffer (BigInt64 included), `TextDecoder`,
`setTimeout` with a callback that re-enters the instance, `performance.now`,
`process.argv`/`exitCode`, and `Symbol.dispose`.

And `mlow-codec.ts:26`'s `Promise<MlowModule> | null` is the **SC2009 that has
been on the books for weeks as "voip's other independent stop"**. It is this,
and nothing else.

A perfect engine behind an unresolvable `import('libmlow-wasm')` is worth
nothing, so this half is sized and reported BEFORE any engine is written.

## STAGE 6 — MEASURED: the engine is the EASY half. The glue is the wall.

Three compiles, all `--backend c`, node v25.9.0 as oracle, compiler at `d646cfa2`.

### (a) `mlow-codec.ts`'s exact shape — `.then()` on `import('libmlow-wasm')`

`app/mlow/drv.ts`, the shape copied from `packages/voip/src/media/mlow-codec.ts:26-41`.
Builds `rc=0`; runs; prints

    FAILED 'Promise<typeof import(".../libmlow-wasm/dist/index")>.then' is part of
    the standard library types but has no scriptc lowering yet [SC2020 at drv.ts:9]

Emitted C: **10,561 bytes**. The package never entered the program. Node prints
`version libopus 1.0.1`.

### (b) the `await import()` spelling

`app/mlow/drv2.ts`. Builds `rc=0` with **zero fences**, and at run time says:

    FAILED Cannot load module 'libmlow-wasm': dynamic import() of npm packages runs
    in the embedded dynamic engine, which this build does not include (compile it
    statically with --npm-static libmlow-wasm, or build with --dynamic)

So the honest route is `--npm-static libmlow-wasm`. `--dynamic` is disqualifying.

### (c) `--npm-static libmlow-wasm`

Builds `rc=0`, C is **30,514 bytes**, and it runs to:

    FAILED 'new Set(values)' ... [SC2020 at libmlow-wasm/dist/index.js:62]

`dist/index.js` (28,846 B) IS compiled — fences at index.js:62, :63, :92. But the
**642,918-byte generated glue is not in the program**: `ENVIRONMENT_IS_WEB`,
`HEAPU32`, `binaryDecode`, `wasmImports` all occur **0** times in the C.

Flagless (no `--best-effort`), the build stops at the first wall with 3 errors, and
the third names the cause:

    index.js:92:23 - error SC2011: values of type '() => Promise<{ version: any; }>'
    have no static representation ...

`version` is `any` because it comes from `module.UTF8ToString(module._oc_get_version_string())`,
and `module` is the Emscripten module object — assembled at run time out of
`WebAssembly.Instance.exports`. **No static analysis types that object**; its
members exist only once a module is instantiated.

### (d) the glue ALONE, as its own `--npm-static` package

`app/glueroot/node_modules/glueprobe/glue.mjs` — a byte copy of
`libmlow.generated.mjs` with a two-line `.d.ts`. Builds `rc=0`, and this time
the glue really is in the program:

    C emitted: 2,210,665 bytes
    ENVIRONMENT_IS_WEB 2 · HEAPU32 44 · binaryDecode 43 · wasmImports 40
    deferred runtime fences: 38 sites, 23 distinct messages

It runs, and dies on its **first statement**:

    FAILED reading 'window' from a value of type 'typeof globalThis' is not
    supported yet [SC1090 at glue.mjs:1]

### The 38, enumerated (this is the actual work item)

     8  converting typed values to 'unknown'                              SC1101
     5  optional chaining on 'unknown' values                             SC1100
     3  class declarations inside functions                               SC1090
     2  functions with optional/defaulted parameters as values            SC1090
     2  assignment to non-variables                                       SC1090
     1  reading 'window' from 'typeof globalThis'                         SC1090
     1  reading 'WorkerGlobalScope' from 'typeof globalThis'              SC1090
     1  reading 'type' from a value of type 'Process'                     SC1090
     1  'import()' runs in the embedded dynamic engine                    SC2012
     1  uses of 'createRequire' inherit the blocker on its declaration    SC2004
     1  'import.meta.url'                                                 SC1090
     1  'console.log' typed by @types/node, no lowering                   SC2020
     1  'console.error' typed by @types/node, no lowering                 SC2020
     1  values of type 'any'                                              SC2011
     1  'Uint8Array' where 'ArrayBuffer' is expected                      SC1090
     1  'new BigInt64Array'                                               SC2020
     1  'new BigUint64Array'                                              SC2020
     1  'instanceof' against a class value whose class has no lowering    SC1090
     1  constructing through a class value whose class has no lowering    SC1090
     1  'clearTimeout of unknown handles'                                 SC2020
     1  element access on non-array values                                SC1090
     1  calls omitting a non-optional parameter                           SC1090
     1  'never[] | null.push'                                             SC2020

**`WebAssembly.instantiate` is NOT in that list.** After `d646cfa2` the glue's
`WebAssembly` reference lowers to `global.undefRead` — an untagged, catchable
ReferenceError — so the engine call site is not a refusal any more. It is
simply never reached, because the module dies 43 statements earlier on
`globalThis.window`.

## THE ORDERING, and it is the reverse of the assumption

| half | state |
| --- | --- |
| **the WebAssembly engine** | wasm3 v0.5.0, stock, already parses + links + compiles all 339 bodies of the real libopus module. +115,200 image bytes. **Done, as an off-the-shelf part.** |
| **the JavaScript around it** | 38 fences in the glue, 3 more in `index.js`, a module object that is inherently `any`, and a first statement (`globalThis.window`) that refuses. |

Writing a WebAssembly engine first buys **nothing measurable**: no zapo program
can reach `WebAssembly.instantiate`. The bottleneck is ordinary JavaScript
lowering in a minified Emscripten bundle, and it is 23 distinct problems, most
of them small and none of them WebAssembly.

## PHASE 9 — the floor, re-measured on THIS branch (not the recorded one)

`bin/wam-head.c.exe`, built from `drivers/wam-entry2.ts --backend c
--provenance-sources --best-effort`, `SCRIPTC_PROVENANCE_AUTHORED_JS=1`,
compiler at `d646cfa2`; oracle regenerated from MY tree under node v25.9.0
via tsx (not the recorded `.node.out`).

    exit 0
    ORACLE C: MATCH (byte-exact)
    17 lines, 15 `ok` assertion lines, last line `WAM-ENTRY2: ALL PASS`
    engine scan: quickjs=0 ScrDyn=0 JS_NewRuntime=0
    fences in the emitted C: 1   (was 2)

**1 TRAP-fence removed, 0 MATCH→WRONG.**

### One number I will NOT claim as mine

    this branch   28,280,320 bytes
    the recorded floor (twininit-lab, base main at the time)  28,158,464 bytes

+121,856. **Not attributable to this block without a paired base build**: the
recorded floor predates main `2b05d613`, which merged wamfences' four fence
fixes, and every fence that becomes a real lowering ADDS code. My own rung
should push the other way — it replaces a long fence message string with a
short name string. A paired base build at `2b05d613` is what would settle it,
and the sibling block that owns binary size has the section attribution.

## STAGE 7 — AOT vs interpreter, measured. AND A CORRECTION.

`wasm2c` (wabt 1.0.36, prebuilt Windows binary; its `wasm2c.exe` needs
OpenSSL 1.1's `libcrypto-1_1-x64.dll`, which the release does not ship —
fetched separately) translates a module to C. That is what this compiler
already does with everything else, and the module here is a **compile-time
constant**: a string literal inside the glue.

### long.js's 286-byte module

`wasm2c wasm-long.wasm` -> `long_aot.c` 31,606 B + `long_aot.h` 1,338 B, whose
whole interface is **six ordinary typed C functions**:

    u32 w2c_wasm0x2Dlong_mul   (inst, u32, u32, u32, u32);
    u32 w2c_wasm0x2Dlong_div_s (inst, u32, u32, u32, u32);
    u32 w2c_wasm0x2Dlong_div_u (inst, u32, u32, u32, u32);
    u32 w2c_wasm0x2Dlong_rem_s (inst, u32, u32, u32, u32);
    u32 w2c_wasm0x2Dlong_rem_u (inst, u32, u32, u32, u32);
    u32 w2c_wasm0x2Dlong_get_high(inst);

| | image | mul | div_s |
| --- | --- | --- | --- |
| bare C hello-world | 188,416 B | — | — |
| + wasm3 interpreter | 301,056 B (**+112,640**) | 27.5–28.7 ns | 28.0–28.3 ns |
| + **wasm2c AOT** | 193,024 B (**+4,608**) | **1.94–2.72 ns** | **2.96–4.99 ns** |

`mul(7,0,6,0)` answers 42 both ways. AOT is **+4,608 bytes and ~10x faster
than the interpreter**, and it takes NODE'S OWN PATH — so `Long#modulo(0)`
throws the wasm trap node throws, and the one divergence PHASE 1 measured
disappears instead of being argued about.

### libopus's 544,879-byte module

`wasm2c cap-0.wasm` -> **7,083,687 bytes of C**, which compiles and runs:

| | image | peak WS after instantiate + ctors |
| --- | --- | --- |
| bare C hello-world | 188,416 B | 3.74 MiB |
| + wasm3 interpreter | 303,616 B (+115,200) | **31.27 MiB** |
| + **wasm2c AOT** | 1,138,176 B (+949,760) | **4.39 MiB** |

### CORRECTION to STAGE 2 and STAGE 4

**I reported that the 24.13 MiB linear memory makes a ~20 MB RSS target
arithmetically impossible. That was measured through wasm3, and wasm3 is the
reason for the number, not the module.**

The AOT build reports `memory bytes = 25296896` — the same 24.13 MiB — and its
peak working set after instantiate and ctors is **4.39 MiB**. wasm2c's memory
implementation RESERVES the address space and commits pages on demand; wasm3
allocates and commits the whole thing up front. So the 24.13 MiB is VIRTUAL,
and the resident cost is whatever libopus actually touches.

What remains true: node itself commits it (`external` +24.66 MiB across
`loadLibopus()`), so an AOT scriptc build would be *lighter here than node*.
What is still **unmeasured** is the resident set of a real encode/decode
workload through the AOT build — driving the Emscripten ABI from C needs the
minified export names wired up, and I have not done it. I am not going to
report a number I did not measure: the honest statement is 4.39 MiB after
instantiate, and unknown-but-bounded-by-24.13 MiB under load.

### The engine recommendation

**AOT-compile the module to C. Do not vendor an interpreter.**

1. It is what scriptc already is. The module is a build-time constant, and the
   compiler's whole job is turning build-time-constant programs into C.
2. **The cost is per-module, not per-binary.** wasm3 is 115 KB in *every*
   binary (the link line has no `--gc-sections`), gateable only by a
   `RuntimeUnits` flag. Generated C for a module a program does not have is
   simply never generated — no gate needed.
3. It is ~10x faster, and for long.js it costs **4,608 bytes** against the
   interpreter's 112,640.
4. It gives the exports **static types**: `w2c_..._mul(inst, u32,u32,u32,u32)`
   is a typed C call, not an `any`. That is the same fact that could type
   `WebAssembly.Instance.exports` in the front end and dissolve the SC2011
   that stops `index.js` today — the export section names and signatures are
   readable at compile time (this lab reads them in 60 lines of JS).
5. It takes node's own path for long.js, so the fallback-equivalence argument
   stops being needed at all.

The one thing the interpreter buys that AOT does not is a module that is NOT a
compile-time constant — `WebAssembly.instantiate(bytesFromNetwork)`. No zapo
code does that: both modules in the tree are string literals in their bundles.
