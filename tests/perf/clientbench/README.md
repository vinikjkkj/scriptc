# The zapo messaging bench's CLIENT half, compiled — strict, no `--best-effort`

The fake server is **not** a compilation target. It stays a separate Node
process. What is compiled here is the **client**: zapo's own
`packages/fake-server/bench/messaging.bench.ts`, minus the in-process driver,
driving a real `WaClient` over a real websocket at a Node child's URL.

Measured 2026-09-07 on `main` at `2b718025`, `x86_64-windows-gnu`,
`SCRIPTC_CC=zigcc`, **zig 0.16.0** (the tree's, not Chocolatey's 0.15.2),
`--backend c --provenance-sources`, **no `--best-effort`**. Every path in
`harness/env.sh` is under `<blocks>\clientbench`; `harness/guard.mjs` refuses
to let a build start unless all eight cache variables are set and point at
`G:`, because `provenance.ts:312` falls back to `homedir()/.cache/scriptc`
with no warning. `<home>\.cache\scriptc` did not exist before the
first build and does not exist after the last one.

## THE ANSWER

**The client bench reaches a binary and runs the shipped workload against the
fake server: 28,344,832 bytes, exit 0, `quickjs 0 / ScrDyn 0`, four scenarios
× 1,000 messages, zero `SC` codes in its output.** It is the real client —
`new WaClient({ chatSocketUrls: [rpc.serverUrl] })`, the real pairing, the
real fixtures, the four real scenario bodies — not a synthetic stand-in.

The strict build reports **0 compile errors**, and its emitted C still
contains **3 refusal sites**. A clean strict build is not a fence-free
program; see §3.

## 1. The ladder — each rung names exactly what it changes

Every rung patches a COPY of the attested zapo checkout
(`250f9af5229a545eec28ddbd3e8774a397cdb0bb`). `<zapo-work>` was never
written to.

| rung | dir | what it changes, relative to what zapo ships | provenance pkgs compiled statically | **strict errors** | build s |
|---|---|---|---:|---:|---:|
| L0 | `bench-clientonly` | the in-process driver, its four fixture builders and the two `FakeWaServer` imports removed (`harness/ladder-clientonly.mjs`, 1,079 → 875 lines) | 16 | **1** | 77 |
| L1 | `bench-clientonly-unmasked` | + `node:inspector/promises` redirected to a shape stub (`tests/perf/fakebench/unmask.mjs`) | 16 | **583** | 902 |
| L2 | `bench-client5` | + socket control channel; − the four store arms the bench never takes; − `process.cpuUsage`, the V8 heap fields, the media proxy agent and `process.on('uncaughtException')` | 2 | **18** | 542 |
| L3 | `bench-noprof` | + `BenchProfiler` made inert, so the stub leaves the graph (`harness/ladder-noprofile.mjs`, 888 → 758 lines) | 2 | **0** | 1,433 |

**L0's `1` is a gate, not a wall.** `SC1010` on an unsupported module is
reported before anything behind it is typechecked, so L0's one-line result
says nothing about the other 875 lines. L1 is the same program with the gate
removed and it is **583**. Any count taken at L0 is a count of one gate.

### 583, clustered by owner

120 distinct message shapes. Attribution by the file the diagnostic names:

| owner | sites |
|---|---:|
| `mongodb` + `bson` (provenance source) | 283 |
| `@zapo-js/store-mongo` (provenance source) | 234 |
| `bench/_store-factory.ts` | 30 |
| `bench/messaging.bench.ts` | 19 |
| `bench/server-rpc.ts` | 7 |
| `@zapo-js/store-{redis,postgres,mysql}` | 3 each |
| `__inspector-stub.ts` | 1 |

**517 of 583 — 88.7% — are the mongo arm**, a backend this bench never
selects: `_store-factory.ts` switches on `ZAPO_BENCH_STORE`, whose default is
`memory`, and the run above never leaves `memory`. They are in the graph
because the switch names them. Removing the four unreachable arms is what
takes 583 → 18; that is the substitution, and it is the whole delta.

**Recorded, not chased.** The mongo arm is a **one-line change on zapo's
side** — split `_store-factory.ts` so a backend's `@zapo-js/store-*` import
is only named on the branch that uses it — and zapo is read-only test input to
us, so this block does not make it. The compiler-side alternative (a
provenance-mapped package's source stops being typechecked under the DRIVER's
tsconfig, the `skipLibCheck` precedent one level out) is the higher-leverage
form, and it belongs to whoever owns `store-mongo`. Nothing below measures
into `store-mongo`, `store-redis`, or the provenance spec-twin walk.

### 18, and its ONE root

17 × `SC1090` in `messaging.bench.ts` (`new InspectorSession()`, then
`.connect` / `.post` ×10 / `.on` ×2 / `.removeListener` ×2 / `.disconnect`)
plus 1 × `SC2011` at `__inspector-stub.ts:8`. The compiler labels the
cascade itself — *"the class declaration itself was rejected — see its own
diagnostic"* — and the root is one line:

    on(_event: string, _fn: (...args: any[]) => void): void {}
    SC2011: values of type '(...args: any[]) => void' have no static
            representation but run in the embedded dynamic engine

**None of those 18 are zapo's messaging code.** They are the *measurement
harness's own stub* for `node:inspector/promises`. And the stub cannot be
fixed by retyping: `unmask.mjs` records that its first version used
`(...args: unknown[]) => void` and every listener registration became a
preflight error instead, because `unknown` is not assignable to the `object`
the callers pass. The stub is wedged between a signature callers cannot
satisfy and one with no static representation.

L3 removes the declaration instead of restating it, and the count goes to
**0** — which is the substitution proof that all 18 were one root.

## 2. The binary, and the run

| | |
|---|---|
| binary | `28,344,832` bytes, md5 `ad6ae80d250c993de416128c43096b2e` |
| build | exit 0, 1,433 s, `--backend c --provenance-sources`, no `--best-effort` |
| emitted C | 16 files (`.c` + `part1..14.c` + `.scrh`), `138,140,754` bytes |
| engine scan | `quickjs 0  ScrDyn 0  JS_NewRuntime 0  JS_Eval 0  __island_eval 0` |
| smoke run | exit 0, 4 scenarios × 20 messages, 0 `SC` codes in output |
| **full run** | exit 0, **1,000 contacts × 2 devices, 4 groups × 500 members, 1,000 messages/scenario**, 0 `SC` codes |

Only `quickjs` and `ScrDyn` discriminate: the control pair built from
`harness/ctrl-dyn.ts` reads `quickjs 1 / ScrDyn 1` at 1,860,096 bytes under
`--dynamic` and `0 / 0` at 679,936 bytes static. `argo-codec` takes the island
path in this graph (no attestation published) and **the engine is still not
linked** — the island is not reached from this entry.

### Both backends — and this program does NOT demote

`--backend llvm` was passed **explicitly**, which fails with the offending
construct named if the program is outside the LLVM tier, rather than quietly
emitting C. It succeeded, so the number below is an LLVM number:

| | `--backend c` | `--backend llvm` |
|---|---|---|
| build | exit 0, 1,433 s | exit 0, 1,371 s (62 advisories) |
| binary | 28,344,832 B | **27,048,960** B |
| md5 | `ad6ae80d250c993de416128c43096b2e` | `cec99da20287f52d482eeeffc389f612` |
| emitted IR | 16 C files, 138,140,754 B | 1 `.ll`, 189,603,057 B |
| engine scan | `quickjs 0 / ScrDyn 0` | `quickjs 0 / ScrDyn 0` |
| smoke run | exit 0, 4×20 | exit 0, 4×20 |
| full run | exit 0, 4×1,000 | exit 0, 4×1,000 |

The bench opens no UDP socket, so the `node:dgram` demotion (16 of 20 dgram
library functions absent from the emitter) does not apply here.

**The `.ll` fence count is 6 where the C's is 3,786, and both are right.**
LLVM interns identical string constants, so the `.ll` counts *distinct
messages* and the C counts *sites*. The `.ll` reads `SC1090 ×1` and
`SC2020 ×2` — exactly the C's 2 sites and 1 site with their two spellings.
Count fences in the **C**; the `.ll` answers a different question.

### Real traffic, and results that agree with Node

Same source, same fake server, node lane vs compiled lane:

| | node v25.9.0 | compiled |
|---|---|---|
| scenarios | 4 | 4 |
| messages/scenario | 1,000 | 1,000 |
| `dispenser misses` | 0 | 0 |
| contacts / groups built | 1,000 / 4×500 | 1,000 / 4×500 |
| exit | 0 | 0 |

Wall times, in ms, from **one un-paired rep each**, on a host running three
other blocks' gates, with **no A/A floor taken**. This is evidence that the
work happened, **not a performance result** — the house rule is that a ratio
is formed inside a rep against a measured floor, and neither exists here:

| scenario (1,000 msgs) | node v25.9.0 | compiled C | compiled LLVM |
|---|---:|---:|---:|
| SEND 1:1 | 5,037.0 | 5,273.7 | 3,254.9 |
| RECV 1:1 | 3,518.4 | 2,766.0 | 1,748.6 |
| SEND group | 5,562.4 | 13,460.2 | 8,550.2 |
| RECV group | 2,222.6 | 2,071.5 | 1,196.9 |

The one row where the compiled lanes are behind, SEND group, is the phase
`tests/perf/cpuphase` already attributed to zapo's own curve25519 field
arithmetic (44.18% of non-idle samples) — the expected place to look, but a
single rep on a loaded box cannot settle it.

## 3. A 0-error strict build still emits refusal fences

`harness/fences.mjs` over all 16 emitted files:

| code | occurrences | what it is |
|---|---:|---|
| `SC9004` | 3,683 | *"asserted past it still held it"* — the runtime check a `!` non-null assertion lowers to |
| `SC9002` | 92 | internal invariant, *"please report this"* |
| `SC9003` | 7 | *"no undefined is representable"* |
| **`SC1090`** | **2** | **re-entrant dynamic-import guard**, `messaging.bench.ts:93` and `:527` |
| **`SC2020`** | **2** (one site) | **`require()` with a run-time specifier**, inside zapo's own `spec/proto/index.js:1`, emitted as `scr_fence_fatal` behind a `scr_require_verdict` test |

The first three rows are **assertions the compiler emits for correct code**,
not constructs it refused; counting them as "fences left" inflates the number
by three orders of magnitude. The last two rows are real refusals that
survived a build with zero diagnostics — and neither fires in this run (exit
0, no `SC` in the output).

### 3.1 THREE refusals in this binary carry no SC code at all

Not found by any `SC` census, because they are not `SC`-coded. Searching the
**emitter for the message construction** — not the emitted C for a string I
already knew — there is exactly **one** site in the whole compiler that puts a
compiler-limitation refusal into the program without a code:

    packages/compiler/src/frontend/lowering/lower-island.ts:770
      `Cannot load module '${spec}': dynamic import() of npm packages runs in
       the embedded dynamic engine, which this build does not include
       (compile it statically with --npm-static ${spec}, or build with --dynamic)`
      → libCall error.new → intrinsic promise.reject

**How the sweep was bounded** (`harness/uncoded-sweep.mjs`, output in
`runs/uncoded-sweep.txt`). Every other refusal reaches the program through a
coded channel: the `runtimeFence` IR node (`nodes.ts:2544`, carrying
`code: string`) emitted as `scr_throw_error_msg_code(..., "SCxxxx")`
(`emit-stmts.ts:758`), `scr_fence_fatal(..., code)`,
`scr_throw_lowering_fence`, or the compile-time `L.noLowering(...)` /
`L.unsupported("SCxxxx", …)`. So the uncoded channel is "a
compiler-limitation message lowered as an ordinary **value**". Corroborating
by hand: there are 13 `fn: "error.new"` construction sites in the compiler; 12
build Node-parity messages (`Reduce of empty array with no initial value`,
`Cannot read properties of …`, DOMException, the startup-crash replay,
`expected <T> at $.field`) and one — `lower-island.ts` — builds a
compiler-limitation message. `promise.reject` has three lowering sites, two of
which are the user's own `Promise.reject`.

**The sweep carries three negative controls, and it needed all three.** Its
first version reported **6** sites and still printed `selftest ok` — a false
green, because the only control it had was one of the three files it was
wrong about. The three it must reject:

| control | why it looks like an uncoded refusal | why it is not |
|---|---|---|
| `lower-emitter.ts:411` | same vocabulary (*"symbol names have no lowering"*) | it is an `L.noLowering(...)` **hint** |
| `lower-stmts.ts:2249` | *"has no lowering yet"* next to a `strLit` | `L.unsupported("SC1031", …)` — coded, code in the call |
| `lower-sqlite.ts:101–108` | the `DB_REFUSALS` / `STMT_REFUSALS` entries sit a dozen lines from an unrelated `strLit` helper | they are **hint tables**, `Record<string, string>`, consumed by 11 later `L.noLowering(...)` calls |

A proximity window cannot tell a hint table from an IR construction, so the
sweep recognises the table declaration itself. With the controls in place the
answer is **1 file, 1 template** — and the same three specifiers appear on the
**LLVM** lane too, so this is a lowering property, not a backend one.

**One template, three instances.** The message is parameterised by specifier,
and the compiled bench carries three:

| specifier | zapo's site | what zapo does with it | reachable in this bench? | what is silently lost |
|---|---|---|---|---|
| **`argo-codec`** | `src/transport/node/mex/argo-decoder.ts:32` | `try { … } catch { cachedArgo = null }` — **swallowed** | no | **argo decoding on the mex transport.** zapo degrades to its own `"argo response received but 'argo-codec' not installed"` warning and continues at exit 0 |
| `ws` | `src/transport/WaWebSocket.ts:46` | caught, then discriminated on `err.code === 'ERR_MODULE_NOT_FOUND' \| 'MODULE_NOT_FOUND'`; **rethrown** if it is neither | no — only reached when `socketRuntime === 'node' && agent`, i.e. a proxy/agent on the websocket, which this bench does not set | nothing silently — it surfaces |
| `bun:sqlite` | `packages/store-sqlite/src/connection.ts:329` | caught, **rethrown** with a clearer message (*"Run this in Bun or set storage.sqlite.driver to better-sqlite3"*) | no — only when the Bun sqlite driver is selected | nothing silently — it surfaces |

**So one of the three is swallowed, and it is `argo-codec`.** `argo` appears
**0 times** in every run log — both backends and node — so nothing in this
bench takes that path; the finding is about what a compiled zapo *client*
would do in production, not about this measurement.

**The `ws` row carries its own sub-finding.** The compiler's refusal is a
plain `Error` with **no `.code`**, so zapo's optional-dependency branch — the
standard Node idiom, `err.code === 'ERR_MODULE_NOT_FOUND'` — does not fire and
the compiler's message is rethrown in place of zapo's `"optional dependency
\"ws\" is not installed. Install with: npm i ws"`. Stamping
`ERR_MODULE_NOT_FOUND` on it would make that branch fire, and it would then
give **wrong advice**: the package *is* installed, the build just cannot run
it.

> **DECIDED (coordinator, 2026-09-07): do not stamp a code.** A clear message
> rethrown beats a familiar message that is false. The option **not taken**
> was stamping `ERR_MODULE_NOT_FOUND`, which would make zapo's
> optional-dependency branch fire and tell the user to `npm i ws` for a
> package already on disk. This is a deliberate choice, **not an oversight** —
> do not "fix" it by adding the code.
>
> If it is ever closed properly, the shape is a **distinct** code meaning
> *"present, but not runnable in this build"*, which every optional-dependency
> `catch` in the ecosystem would have to learn. That is an ecosystem-facing
> decision and not one this project makes unilaterally.

### 3.2 `--npm-static argo-codec` — measured. It closes the refusal.

Same entry, same everything else, `--npm-static argo-codec` added:

| | baseline `np-strict` | `--npm-static argo-codec` |
|---|---:|---:|
| build | exit 0, **0 errors** | exit 0, **0 errors** |
| binary | 28,344,832 B | **28,395,008** B (**+50,176 B, +0.18%**) |
| emitted C | 138,140,754 B, 16 files | 138,396,726 B, 16 files |
| engine scan | `quickjs 0 / ScrDyn 0` | `quickjs 0 / ScrDyn 0` |
| **uncoded module refusals** | **3** — `argo-codec`, `ws`, `bun:sqlite` | **2** — `ws`, `bun:sqlite` |
| bracketed coded fence sites | 1 | **11** |
| smoke run (4×20) | exit 0 | exit 0 |
| full run (4×1,000) | exit 0 | exit 0, **0** `SC` codes and **0** `argo` lines in the output |

`Cannot load module 'argo-codec'` is **gone from the emitted C**, and the
package is genuinely in the program, not merely silenced: the C carries
`argo-codec` ×13, `ArgoResponse` ×10 and `ArgoDecoderAvailable` ×10.

**What it costs is a trade, and the trade is favourable.** The 1 → 11
bracketed fence sites are all new, and all ten additions are inside
argo-codec's own shipped CJS:

    4 × SC1090  dist/cjs/decode.js:223, :240, :244  ·  dist/cjs/index.js:19
    4 × SC1100  dist/cjs/decode.js:37, :141  ·  encode.js:63  ·  wire.js:38
    2 × SC2020  dist/cjs/decode.js:6  ·  dist/cjs/encode.js:319

So the refusal did not disappear; it **moved from one invisible
module-level rejection into ten countable statement-level fences**, each of
which fires only if that statement runs. That is a strict gain in
observability, and it is the difference between a capability that switches
itself off silently and one whose remaining gaps can be enumerated and closed.

> ### "argo closed" does NOT mean "argo works"
>
> The refusal is closed. The **capability is unproven.** Ten fences sit inside
> argo-codec's own code and this bench never drives mex, so not one of them
> has been executed. Anyone quoting `--npm-static argo-codec` as "argo works"
> is quoting a build result as a runtime result.

**What it does NOT establish:** that argo decoding *works* end to end. This
bench never exercises the mex/argo path, so the ten new fences are unfired and
unmeasured. Proving argo decode would need a bench that drives mex — which
this one is not, and which nobody has built.

**Build times are not comparable here and I am not reporting one.** The
baseline took 1,433 s under four concurrent loads and this build took 676 s
after they eased. If a build-time number matters, it needs a quiet window.

**This is deliberate, and the rationale is written at the site.** `import()`'s
failure channel is in-band in Node too, so the compiler models the refusal as
a rejected promise catchable at the `await` — *"this build answers the same
failure it would give for a missing loader, never a silent wrong value"*. Two
things still follow that outlive this bench:

1. **An `SC`-code census cannot see this class of refusal.** "No `[SCxxxx]`
   throws left in the emitted C" can be literally true of a binary that still
   refuses to load three modules.
2. **In-band is not the same as visible.** Node's own failure here means "not
   installed", and every optional-dependency `catch` in the ecosystem is
   written for that meaning. A compiled build reuses the channel with a
   different meaning, and `argo-codec` shows what that costs: the program
   keeps running with a capability silently switched off.

**A binary byte hit is not a fence.** The clean static control — 0 fences in
its C — still shows `SC2020 ×1` in its `.exe` bytes, because the string lives
in the runtime and these PE binaries have no `.CRT` section. Read the TEXT
row, never the BINARY row, for "what is left in the program".

For comparison, the Aug-26 `--best-effort` C of the same bench carries
**2,107** `SC` occurrences including 80 × `SC1090` and 12 × `SC2020` — the
per-statement refusals `--best-effort` deferred into runtime throws. That
2,107 is a **lower bound**: only the single `<src>.c` of that build survives
in `msgbench-lab`, and `lastfence` measured that `<src>.c` alone is about 10%
of a bench translation unit. The comparable number here is the `SC1090` and
`SC2020` rows — 80 and 12 under `--best-effort`, **2 and 2** strict.

## 4. The transport: what the fake server needs from a compiled client

zapo's shipped `bench/server-rpc.ts:84` opens the control channel with

    fork(entry, [], { execArgv: ['--import','tsx'], stdio: [...,'ipc'],
                      serialization: 'advanced' })

and that is `SC2020` in the L1 build:

    server-rpc.ts:84:22 - error SC2020: 'child_process.fork' is typed by
    @types/node but has no scriptc lowering yet

`surfaces.ts:1481` refuses it deliberately and writes the cost out: a
libuv-compatible IPC pipe with the `NODE_CHANNEL_FD` handshake, V8
`ValueSerializer` framing for `'advanced'`, an emitter-shaped `message` event
and `send()` backpressure — and notes that `fork()` spawns
`process.execPath`, which in a compiled binary is **the binary itself**
(measured: it forks a bomb). Its hint names the alternative, and `transport/`
is that alternative, as two diffs against pristine `bench/` plus one new file:

* the **parent listens** on `127.0.0.1:0`, the child **connects back**, port on argv;
* which node runs the child comes from **outside** — `BENCH_NODE`, because a
  compiled parent cannot ask itself; `BENCH_NODE_IMPORT` names the loader;
* `rpc-frame.ts` frames JSON plus raw binary blobs, so typed arrays do not
  round-trip through `number[]` — which would corrupt exactly the memory and
  CPU numbers the bench exists to produce.

Both diffs `patch --dry-run` clean against pristine `bench/`. The protocol
above the channel is unchanged, and **nothing about the server compiles**:
`server-process.ts` stays a Node program and is only taught to accept a socket
instead of `process.send`.

### The complete list of what zapo would have to change

Ordered by whether the compiler could close it instead.

| # | change | why | compiler could close it? |
|---|---|---|---|
| 1 | a **client-only bench entry** | the client half is already clean; it is just not a file. One `import { FakeWaServer }` at line 59 puts the server in the graph | no — zapo-side |
| 2 | a **socket control channel** instead of `fork()` | `transport/`; the compiler's own hint prescribes it | possible but expensive, and `surfaces.ts` argues against |
| 3 | **do not self-profile** | `node:inspector/promises` drives V8; a compiled binary has none. This fleet reads CPU/RSS from outside the process anyway | no — and stubbing makes it worse (§1) |
| 4 | **do not name unreachable store arms** *or* fix the compiler | 517 of 583. Either zapo splits `_store-factory.ts` per backend, or a provenance-mapped package stops being typechecked under the DRIVER's tsconfig | **yes** — this is the high-leverage one |
| 5 | `process.memoryUsage()` → `process.memoryUsage.rss()` | the four V8-heap fields are refused by name; `rss` lowers | partly |
| 6 | drop `process.cpuUsage()` | no lowering | yes, in principle |
| 7 | drop `process.on('uncaughtException')` | no lowering. **`'unhandledRejection'` IS supported** — `bench-client5` removed both, and only one needed to go | yes |
| 8 | drop the media `proxy` agent | zapo validates it as a proxy TRANSPORT (`dispatch(...)` or `addRequest(...)`) and a compiled `https.Agent` presents neither, so zapo refuses it *at construction*. Inert for messaging; **a media bench cannot skip it** | yes — a runtime-shape gap, not a lowering gap |

### If you are here to compile a MEDIA bench, read this first

Row 8 is the one that stops you, and it stops you at *construction*, before
any media request is issued. `WaClient`'s `proxy: { mediaUpload, mediaDownload }`
is validated as a proxy **transport**: zapo requires a dispatcher with
`dispatch(...)` or an agent with `addRequest(...)`. A compiled `https.Agent`
presents **neither**, so `new WaClient({ proxy: … })` is refused outright.

Messaging gets to sidestep it — this bench builds the agent and never issues a
media request, so the option can simply be dropped (`bench-client5` drops it,
and that is why the messaging lane compiles). **A media bench cannot.** It
needs the compiled `https.Agent` to present a proxy-transport shape, which is
a runtime-shape gap on our side, not a missing lowering: the type checks, the
object exists, and the duck-type test fails at run time. Closing it means
giving the compiled `Agent` an `addRequest(...)` (or a dispatcher surface),
not adding a lowering.

## 5. What the prior art already gave us

| where | what it already achieved |
|---|---|
| `<blocks>\msgbench-lab` (2026-08-26, **never committed**) | the client/server split, `ladder-clientonly.mjs`, and the socket control channel. Reached a 24,639,488-byte binary — under `--best-effort`, so its "0 sites" meant 0 refusals best-effort *could not defer* |
| `tests/perf/storemem` (2026-09-04) | ran that binary against a separate-process fake server for real peak-RSS numbers — still `--best-effort` |
| `tests/perf/cpuphase` (2026-09-01) | the same binary, phase CPU attribution |
| `<blocks>\lastfence-lab` (2026-09-02) | the fence inventory: 23 fences under `--best-effort`, **22 errors flagless**, and the observation that 18 of 21 unique were the inspector surface |
| `tests/perf/looplatency` | the only *committed* Node-fake-server + compiled-socket-client pair in the repo |
| `tests/perf/zapo-rest/harness/memrig.mts` | the only *committed* rig that stands up `FakeWaServer` over a websocket and drives a compiled child |

What was missing was the strict lane and the run: `22 errors flagless` →
**0**, and a binary that completes the shipped workload.

## 6. Instruments, and the control that made each one fire

| instrument | positive control | reading |
|---|---|---|
| `harness/guard.mjs` | unset `SCRIPTC_PROVENANCE_CACHE`; then point it at `<home>\.cache\scriptc` | exits 2 on both, naming the variable |
| `harness/fences.mjs` | the Aug-26 `--best-effort` C | **2,107** occurrences (SC9004 ×1908, SC9002 ×86, SC1090 ×80, SC2020 ×12, …) |
| `harness/engine.mjs` | `ctrl-dyn.ts` `--dynamic` vs static | `quickjs 1 / ScrDyn 1` vs `0 / 0` |
| `harness/run.sh` | the node lane on the same source | exit 0, 4 scenarios, both workloads |
| `harness/ladder-noprofile.mjs` | its own self-test | refuses to write unless `InspectorSession`/`this.session` reach 0 **and** the scenario bodies, `mainSeparateProcess` and `WaClient` all survive |
| `transport/*.diff` | `patch --dry-run` on pristine `bench/` | both apply |
| `harness/uncoded-sweep.mjs` | one positive (`lower-island.ts` must be found) **and three negatives** (`lower-emitter.ts`, `lower-stmts.ts`, `lower-sqlite.ts` must not) | 1 file, 1 template. Its first version reported 6 and still said `selftest ok`, because its only control was one of the files it was wrong about |

## 7. Reproducing

    . tests/perf/clientbench/harness/env.sh      # refuses if any cache var is off G:
    sh harness/build.sh <bench-dir> <tag>        # strict, --backend c
    sh harness/build-llvm.sh <bench-dir> <tag>   # explicit --backend llvm
    CB_EXE_TAG=<build-tag> sh harness/run.sh exe <run-tag> <bench-dir>
    sh harness/run.sh node <run-tag> <bench-dir> # the same source under node --import tsx
    CB_FULL=1 …                                  # the shipped workload

Three traps this harness pays for so the next block does not:

* **`-o` names a FILE, not a directory.** Given a directory, `lld-link` fails
  `cannot open output file …: Is a directory` — *after* the whole typecheck
  and codegen have been paid for.
* **Do not edit a shell script while `sh` is running it.** `sh` re-reads by
  byte offset; an edit that shifts offsets makes it execute the middle of a
  command. One 488-second build was lost to `rovenance-sources: command not
  found`. `harness/build.sh` is copied to a frozen name before a long run.
* **Do not source another block's `env.sh`.** `tests/perf/pkgstatus2/env.sh:4`
  and `tests/perf/voipfix/env.sh:4` point `SCRIPTC_PROVENANCE_CACHE` at *other
  blocks'* lab directories.

### The 08-26 C:-drive fill — closed, do not re-open it

`<blocks>\msgbench-lab\env.sh` sets `ZIG_*`, `SCRIPTC_CACHE_DIR`, `TMP`,
`TEMP`, `TMPDIR`, `SCRIPTC_CC`, `SCRIPTC_TARGET` and `PATH` — and
**`SCRIPTC_PROVENANCE_CACHE` not at all.** `provenance.ts:312` falls back to
`homedir()/.cache/scriptc` when it is unset, so every build in that session
resolved provenance onto the user's `C:` drive. That lab's own README says so
without noticing: *"The provenance source cache is the default
`~/.cache/scriptc/provenance` and was already warm with all five packages."*

That is the origin of the 08-26 fill. It was one missing variable in one
sourced file, not a leak elsewhere in the toolchain, and
`harness/guard.mjs` is the fix: it refuses to start a build unless all eight
variables are set **and** point at `G:`, and it is imported for effect by
`harness/scc.mjs`, which is the only way this block invokes the CLI.

---

# 8. THE MEASUREMENT PROTOCOL — declared before the numbers exist

Every performance figure this project has quoted for this bench was taken
under `--best-effort`, so none of them measured the program that ships. These
are the first strict numbers, and the protocol is written down **before** the
run so it cannot be shaped by what comes out.

## 8.1 The arms

| label | lane | binary / source | bytes | md5 | what it answers |
|---|---|---|---:|---|---|
| `c` | compiled | `out/bb-c`, `--backend c` | 28,345,856 | `6832f2ef114cfd665748412ddd9ffb39` | the readable-C lane |
| `llvm` | compiled | `out/bb-llvm`, explicit `--backend llvm` | 27,048,960 | `3c488367dd275792cb5a87ad6a84cede` | **the lane that ships** |
| `argo` | compiled | `out/bb-argo`, `--backend c --npm-static argo-codec` | 28,395,008 | `733b3490f4f3b7ac39bbe941d6dcadb2` | the only honest cost of closing the uncoded refusal |
| `node` | interpreted | `bench-bench/messaging.bench.ts` under `node --import tsx` | — | entry `83c65a1665ae60532a233ba7963825b1` | the comparison that matters |

All three compiled arms rebuilt from the marked source with **0 strict
errors**, all three read `quickjs 0 / ScrDyn 0`, and all three were smoke-run
through the full pipeline before the window: exit 0, four phase rows and a
peak-RSS line each. `bb-argo` carries **2** uncoded module refusals where
`bb-c` and `bb-llvm` carry **3** — the `--npm-static` difference, unchanged by
the phase marks.

All four run the **same source**, `bench-bench`, which is `bench-noprof` plus
two `console.log` phase markers. Neither lane gets an instrument the other
does not. Every binary is rebuilt from that source; the pre-marker binaries
are not eligible arms.

## 8.2 What is measured, and by what

| number | instrument | why that one |
|---|---|---|
| wall ms **per scenario** | the bench's own `elapsedMs` | measured inside the same source both lanes execute — the one directly comparable timing number |
| **peak RSS** | `cpuphase.exe`, `PeakWorkingSetSize`, sampled from the parent | the compiled lane has no V8 heap and `process.memoryUsage()`'s heap fields are refused by name; only an external number exists for both lanes |
| **CPU** per phase | `cpuphase.exe`, `QueryProcessCycleTime` (Mcycles) plus the `GetProcessTimes` user/kernel split | `process.cpuUsage()` has no lowering, so the bench prints `n/a` for CPU on purpose. Cycles are exact to the context switch; the tick-quantised split is kept only because cycles give no user/kernel breakdown, and on a socket-bound workload that split is what separates "spinning" from "blocked" |

`cpuphase` echoes the child's stdout byte-for-byte, so the bench's JSON still
parses and the two lanes stay diffable.

## 8.3 The rules the tooling enforces, so they cannot be forgotten in a hurry

1. **Ratios are formed inside a rep.** Every arm of a rep runs back to back.
   This host drifts ~10% per rep — a recorded session has the *same* arm at
   22.3 s and 30.2 s — so an across-rep ratio is not a measurement.
   `benchstat.mjs` only ever divides two arms of the same rep.
2. **Median of the per-rep ratios, with `[min .. max]` beside it.** A median
   without its spread is a claim without an error bar.
3. **A floor is a draw, not a value.** The A/A floor runs the *same binary* as
   two arms. Any delta inside the floor's half-width prints as `DRAW`.
   Without `--floor`, `benchstat.mjs` refuses to call anything a difference
   and prints `floor: UNKNOWN`.
4. **A non-zero exit is never averaged away.** Truncated runs are listed
   before any table.
5. **Every number names its lane, binary, zig, target and node.** `bench.sh`
   writes that header — including each arm's exe size and md5, and
   `BENCH_NODE --version` read back from **the executable that will actually
   be spawned**, not from `PATH` — before it runs anything.

## 8.4 The harness self-test

`node harness/benchstat.mjs --selftest`, recorded in
`runs/benchstat-selftest.txt`:

    A/A with +-22% host drift  -> ratio exactly 1.0000  [NO DIFFERENCE]
    A/B with a real +20%       -> ratio 1.2000          [seen, not swallowed]

The drift is applied **per rep to both arms**, the way the host actually
drifts, so a tool that compared across reps would fail the first case. The
second case is the negative control: without it, a parser that silently
returned nothing would also "pass" the first.

A real A/A dry run on this host, through the whole pipeline, is in
`runs/bench-floor-dry.txt` (raw log: `runs/bench-floor-dry-raw.txt`) — the same
binary as both arms, so the harness is shown producing a null result on real
data, not only on synthetic data, before it is trusted on A/B. Every metric
reads DRAW; the widest is `wall:SEND 1:1` at +/-10.44% on a contended host
with the reduced smoke workload, which is exactly why the window run uses the
shipped workload, where each scenario is seconds rather than tens of
milliseconds.

**The floor must come from a SEPARATE A/A run.** A floor taken from the log
being measured is self-referential — its half-width IS the observed deviation,
so every metric is a DRAW by construction and the verdict column means
nothing. `benchstat.mjs` refuses that combination outright
(`--degenerate-floor-ok` overrides it, and the dry run above passes it
deliberately, to inspect an A/A log's own spread). In the window the protocol
is therefore **two** A/A runs: the first is the floor, the second is scored
against it and must come back DRAW on every metric. That is the non-degenerate
form of the same check, and it is the last gate before any A/B number is
believed.

## 8.5 What is NOT measured, and why

* **Build times.** They need the quiet window too; the numbers already in this
  README (1,433 s vs 676 s) differ by host load, not by lane, and none is
  claimed.
* **`store-mongo`, `store-redis`, the provenance spec-twin walk.** Another
  block's; nothing here reaches into them.
* **The mongo arm's 517 sites.** A recorded one-line change on zapo's side.

---

# 9. THE NUMBERS — first strict bench, quiet window, 2026-09-07

Machine quiet by arrangement: two other blocks idle, no gate running, 27.7 GB
free RAM. The **six residual processes** in every log header are the user's own
MCP servers (0.1–22 s accumulated CPU between them) and were not stopped; a
floor names the host state it was measured in, and this is that state.

Lane, backend, binary and node are on every header. `zig 0.16.0`,
`x86_64-windows-gnu`, `SCRIPTC_CC=zigcc`, node **v25.9.0 read back from the
executable that was actually spawned** (`BENCH_NODE`), shipped workload
(1,000 contacts × 2 devices, 4 groups × 500 members, 1,000 messages/scenario).
16 runs in the comparison, **all rc=0**.

## 9.1 The gate failed twice first, and both faults were mine

This is the most important part of the section, because the numbers below
would have been wrong without it.

**Failure 1 — a position-dependent bias the paired design did not cancel.**
Two A/A runs of the *same binary* in a fixed arm order: the arm that ran
**second** was faster on `recv_group` in **6 of 6 reps**, on both its wall and
its cycles, while every other metric sat at chance (2/6 to 4/6). A two-sided
sign test puts that at p = 0.031. A paired design only cancels what is
symmetric between the positions, so the positions have to be rotated.
`bench.sh` now runs rep *r* starting at arm `(r-1) mod n` and cycling — a
Latin square, and plain ABBA when n = 2. The same metric on the same binary
re-centred immediately: `cycles:recv_group` 0.9870 → 1.0012, `wall:RECV group`
0.9565 → 0.9979. Evidence in `runs/order-effect.txt`.

**Failure 2 — `max|r-1|` over 4 reps is not a bound.** With the bias fixed the
gate still failed on the same metric, so the estimator was the fault: the
maximum of a small sample under-estimates spread and swings wildly.
`cycles:recv_group` read **±0.80%** in one 4-rep A/A and **±8.30%** in the very
next one, same binary. A gate built on the first would have called a 0.9% A/A
difference a result. `benchstat.mjs` now **pools** every A/A log passed with
`--floor` and prints the rep count.

**The gate then passed**: an independent 4-rep A/A scored against a pooled
8-rep floor came back **DRAW on all 13 metrics** (`runs/window-results.txt`,
section 1). The floor used below pools **12 A/A reps**.

## 9.2 Every lane against node — medians of per-rep ratios, 4 reps

`n/a` where a lane cannot produce the number: the compiled lanes have no
`process.cpuUsage()` and no V8 heap, which is exactly why CPU and RSS come
from `cpuphase` for **both** lanes rather than from either lane's own runtime.

| metric | floor | `c` / node | `llvm` / node | `argo` / node |
|---|---:|---|---|---|
| **peak RSS** | ±5.55% | **0.323 — 67.7% smaller** | **0.338 — 66.2% smaller** | **0.329 — 67.1% smaller** |
| cycles send_1to1 | ±3.47% | **0.802 — 19.8% fewer** | **0.795 — 20.5% fewer** | **0.792 — 20.8% fewer** |
| cycles recv_1to1 | ±6.71% | **0.871 — 12.9% fewer** | **0.874 — 12.6% fewer** | **0.889 — 11.1% fewer** |
| cycles recv_group | ±8.30% | **0.887 — 11.3% fewer** | **0.908 — 9.3% fewer** | **0.895 — 10.5% fewer** |
| cycles **send_group** | ±4.01% | **1.858 — 85.8% MORE** | **2.079 — 107.9% MORE** | **1.868 — 86.8% MORE** |
| wall RECV 1:1 | ±5.73% | 1.038 — **DRAW** | 1.033 — **DRAW** | 1.017 — **DRAW** |
| wall RECV group | ±9.62% | 1.038 — **DRAW** | 1.073 — **DRAW** | 1.083 — **DRAW** |
| wall SEND 1:1 | ±3.91% | 1.253 — 25.3% slower | 1.243 — 24.3% slower | 1.238 — 23.8% slower |
| wall **SEND group** | ±4.92% | 2.768 — 176.8% slower | 3.197 — 219.7% slower | 2.782 — 178.2% slower |
| cpuMs recv_group | ±29.74% | 0.859 — **DRAW** | 0.958 — **DRAW** | 0.948 — **DRAW** |

Absolute medians, for scale:

| | node | `c` | `llvm` | `argo` |
|---|---:|---:|---:|---:|
| peak RSS (MiB) | **500.4** | **161.8** | **169.2** | **164.2** |
| SEND 1:1 wall (ms) | 1,823.2 | 2,285.6 | 2,280.7 | 2,263.4 |
| SEND group wall (ms) | 2,109.1 | 5,873.5 | 6,771.9 | 5,927.2 |
| send_1to1 (Mcycles) | 10,221.7 | 8,200.4 | 8,178.0 | 8,121.8 |
| send_group (Mcycles) | 14,915.7 | 27,848.8 | 31,115.8 | 28,023.3 |

### The preliminary RSS observation is CONFIRMED

It was flagged as preliminary at 30 MiB against 152 MiB on a reduced workload
with no floor. At the shipped workload, with a 12-rep floor of ±5.55%, it is
**500.4 MiB → 161.8 MiB, a ratio of 0.323 with a [0.3226 .. 0.3301] range
across four reps** — far outside the floor and remarkably tight. **A compiled
zapo messaging client uses about a third of the memory the same source uses
under node.** That is the headline.

### Three scenarios out of four cost FEWER cycles compiled

`send_1to1`, `recv_1to1` and `recv_group` all run on 9–21% fewer CPU cycles
compiled than under node, on every backend. Those are real wins outside the
floor.

### `send_group` is the whole regression, and it is one phase

`send_group` costs **86–108% more cycles** and **177–220% more wall** compiled.
Everything else is a win or a draw. This is the phase `tests/perf/cpuphase`
already attributed to zapo's own curve25519 field arithmetic (44.18% of
non-idle samples) — the compiled lane pays roughly double for it. It is one
phase, one code path, and it now has a measured size.

### A dissociation worth naming: fewer cycles, more wall

`SEND 1:1` costs **20% fewer cycles** and **25% more wall** on every compiled
lane. Fewer cycles with more elapsed time is time spent **not executing** —
blocked, not spinning. That is the shape the user/kernel split exists to
separate, and it points at the loop-turn/RPC-depth cost this fleet has already
identified rather than at codegen quality.

## 9.3 LLVM against C — the shipping backend is slower on `send_group`

| metric | floor | `llvm` / `c` |
|---|---:|---|
| cycles send_group | ±4.01% | **1.117 — 11.7% MORE** |
| wall SEND group | ±4.92% | **1.151 — 15.1% slower** |
| cpuMs send_group | ±3.85% | **1.117 — 11.7% MORE** |
| all 10 other metrics | — | **DRAW** |

The lane that ships is a draw with the C lane everywhere **except** the one
phase that is already the regression, where it is a further 12–15% worse. If
`send_group` gets attention, this is a second, independent reason to look at
it — and a reason to measure both backends rather than assuming they agree.

## 9.4 `--npm-static argo-codec` costs nothing measurable at run time

| `argo` / `c` | result |
|---|---|
| all 13 metrics | **DRAW** |

Closing the uncoded `argo-codec` module refusal costs **+50,176 bytes (+0.18%)
of binary** and, at run time, **nothing this instrument can detect** — peak
RSS, cycles, CPU ms and wall are all draws against the plain C lane on a
12-rep floor. It remains true that this bench never drives mex, so the ten
fences inside argo-codec are still unfired: **"argo closed" is a build result,
not a runtime one.**

## 9.5 What these numbers are not

* Not a build-time comparison. Build times were taken under contention and
  none is claimed.
* Not a statement about `store-mongo`, `store-redis` or the provenance
  spec-twin walk — another block's, untouched.
* Not a claim about any scenario marked DRAW. `wall:RECV 1:1` and
  `wall:RECV group` are draws on all three compiled lanes and should be
  reported as draws, not as small wins.

---

# 10. THE MEX/ARGO HOLE — driven, and the answer is that `--npm-static` does NOT close it

`main` at `51d4c9c0`. The gap named in §3: `--npm-static argo-codec` removes an
uncoded module refusal and introduces ten coded fences inside argo-codec's own
CJS, and **this bench never drove mex, so those ten were unfired and
unmeasured**. They are fired now.

## 10.1 Driving mex needed no zapo edit at all

**Server.** `FakeWaServer.registerIqHandler(matcher, respond, label)` is a
public extension point — its own header says a caller may *"wire every
response via `registerIqHandler`"*, and the bench's `server-process.ts`
already registers two handlers of its own. `harness/ladder-mexprobe.mjs` adds a
third, for `w:mex`, answering `<result format="argo">` with bytes from
**argo-codec's own encoder**. **Nothing under `fake-server/src` is touched**,
so no other bench dir is affected. The server stays a Node process.

**Client.** `client.message.getReachoutTimelock()` is public zapo API. It
reaches `runMexQuery` → `parseMexResultPayload` → the `format === 'argo'`
branch → `decodeMexArgoResponse`. No internal import, no reach-around.

**The fixture is a genuine cross-implementation test.** argo-codec's `encode`
produces 114 bytes that zapo's *hand-written* decoder reads back exactly, and
the payload is the shape `parseReachoutTimelockMexResponse` expects, so a
correct decode is observable as **values**, not merely as "no throw":

    [mex-probe] OK isActive=true enforcementType=SOFT_BLOCK enforcementEndsAt=1767225600

That is the node lane (`runs/mex-node-oracle.txt`) and it is the oracle.

## 10.2 A correction I owe: the degradation is NOT silent

I wrote twice that a compiled zapo *"keeps running with argo decoding silently
switched off"*. **That is wrong, and I am correcting it plainly.**

`loadArgo()` swallows the module-load error into `null` — but
`isMexArgoDecoderAvailable()` has exactly **one** caller, `client.ts:108`, and
that caller **throws**:

    mex/FetchReachoutTimelock argo response received but 'argo-codec' not installed; 114B; strings: …

The *refusal* is swallowed. The *consequence* is loud, named, and carries the
payload. What is wrong is the **message**: the package IS installed, and in the
`--npm-static` build it is compiled into the binary. Every failure on this path
reports "not installed" whatever the real cause was.

## 10.3 The three outcomes, kept separate

### (a) What FIRES — two, in order, both on the module-initialisation path

| build | what the direct-import probe reported |
|---|---|
| `bm-plain` (no `--npm-static`) | `Cannot load module 'argo-codec': dynamic import() of npm packages runs in the embedded dynamic engine…` — the **uncoded** refusal, as predicted |
| `bm-argo` (`--npm-static argo-codec`) | **`SC2020` at `argo-codec/dist/cjs/decode.js:6`** — `'new TextDecoder with arguments' … has no scriptc lowering yet` |
| `bm-argo2` (same, with `decode.js:6` substituted) | **`SC1090` at `argo-codec/dist/cjs/index.js:19`** — `functions with optional or defaulted parameters as values … are not supported yet` |

`decode.js:6` is `const TEXT_DEC = new TextDecoder('utf-8', { fatal: false })`
at **module top level**, so it runs on first import. Substituting it for the
behaviour-identical `new TextDecoder()` (utf-8 and `fatal:false` are the
defaults; `harness/patch-argo-textdecoder.mjs`, reversible, self-tested, and
verified not to change the node oracle's answer) did **not** produce a working
decode — it revealed **the next module-init fence behind it**.

**So `--npm-static argo-codec` does not deliver argo decoding.** It converts one
invisible module-level rejection into a **queue** of statement-level fences on
the module-init path, and because zapo's `catch` swallows every one of them
into the same `"'argo-codec' not installed"` message, **the outward behaviour
of `bm-plain` and `bm-argo` is identical**. Anyone measuring only the outward
behaviour would conclude `--npm-static` changed nothing at all.

This is the Aug-26 lesson again, in a new place: *laddering one rebuild at a
time is the wrong instrument*. Each rebuild costs ~15 minutes and reveals
exactly one more fence.

### (b) What is structurally clear — the decode path itself is fence-free

All ten fence sites are in `decode.js`, `encode.js`, `wire.js` and `index.js`.
**`buf.js` carries none** — and `buf.js` is the *only* module zapo's decoder
touches: `argo-decoder.ts` uses `argo.Reader` and nothing else
(`label()`, `bytes()`, `bitset()`, `pos`, `end`). So once module
initialisation completes, zapo's argo decode path has no fence in it.

The corollary is that the remaining work is **module init only**, not the
codec. I state that as structure, not as a proof of unreachability: my first
attempt to classify the ten by indentation called `index.js:19` a function
body, and executing it proved that wrong. **The measurement corrected the
heuristic, and the heuristic is not to be trusted again.**

### (c) What remains UNMEASURED

**Whether a compiled zapo decodes argo correctly.** Still unknown, because
module initialisation has never completed. The oracle proves the *fixture* and
the *decoder logic* are right; nothing yet proves the compiled lane reproduces
it. It stays unmeasured, and "argo closed" stays a build result.

## 10.4 Two reporting defects found on the way

1. **A `--npm-static` fence can cite a line past the end of the file it
   names.** `index.js:19` — the on-disk `dist/cjs/index.js` is **17 lines** and
   `dist/esm/index.js` is **4**. The location is against the *rewritten* module
   `--npm-static` produces, not against anything on disk. A reader chasing it
   finds nothing and concludes the census is broken.
2. **A `--npm-static` build prints no confirmation that it worked.** The build
   log's only line about the package is still
   `provenance: argo-codec@0.2.1: no provenance attestation published; island
   path used` — which reads as though the island were used, when the package
   was in fact compiled in. There is no positive line. I could only confirm the
   opt-in took effect by scanning the emitted C for `ArgoResponse` and
   `ArgoDecoderAvailable`.

## 10.5 What would close it

One lowering at a time, in the order the queue reveals them —
`new TextDecoder(<args>)` first, then `SC1090` on functions with optional or
defaulted parameters used as values — with the caveat that the queue's length
is unknown until each is closed. A cheaper instrument than rebuilding would be
a build-time report of **which deferred fences sit on a module's
initialisation path**, since those are the ones that fire unconditionally on
first import; that distinction does not exist in the census today.

## 10.6 The rebase moved nothing

`bb-c` rebuilt at `51d4c9c0` (two merges after the `2b718025` the window arms
were built at) is **byte-identical**: `28,345,856` bytes, md5
`6832f2ef114cfd665748412ddd9ffb39`. Every §9 number stands unchanged.

# 11. THE ARGO ANSWER — a compiled zapo does NOT decode argo, and the fences were never the wall

Taken over after a machine restart killed the block mid-edit. §10 left three
things open: an unfinished compiler diff, "the whole module-init fence set in
one pass", and the open question. All three are answered here, and the answer
to the third is not the one the fence queue predicted.

## 11.1 The inherited diff — what it was, and what was missing

91 uncommitted lines across 9 files. They were the §10.4 reporting fixes, and
the intent was complete; the coverage was not. Three faults, all found by
running the thing rather than reading it:

| fault | how it showed |
|---|---|
| the "original line count" was `split('\n').length` | counts a trailing newline as an 18th line of a 17-line file, so the qualifier would have reported the wrong number for the very file that motivated it |
| `lower-stmts.ts` `deferredFenceStmt` never called the helper | this is the site that bakes EVERY module-init statement fence — i.e. the exact site `index.js:19` comes from. The fix could not have worked |
| `lower-ws.ts`'s pre-rendered backend site never called it | the two `ws` init-bag refusals would still cite an unqualified location |

There is also a mundane explanation for why the predecessor's own control runs
printed nothing: `diagnostic.ts` was last written at **01:52:39** and the last
`pnpm build` was at **01:20**. The trace they were trying to read was never in
the `dist` they were running.

Finished, controlled on both arms, and committed. `runs/npm-static-reporting.txt`.
`SCRIPTC_FENCELOC_TRACE=1` is what found the two missing bake sites: without it a
call site that never reaches the helper looks exactly like a file that needed no
qualifier.

## 11.2 The whole fence set in ONE pass — `harness/initpath.mjs`

Laddering is retired. A module's top-level statements are emitted into
`sc_f__x25_init_N`, so the ENCLOSING C FUNCTION of a fence says whether it is on
the initialisation path. That is read off the artifact; no indentation heuristic
is involved, and the one that was tried in §10.3 is not used again.

| build | distinct fence sites | **on the init path** | in a called function |
|---|---:|---:|---:|
| `bm-argo` — `--npm-static argo-codec`, argo-codec pristine | 11 | **2** | 9 |
| `bm-argo4` — same, both init fences substituted | 9 | **0** | 9 |
| `da-argo` — `mexprobe/decode-answer.ts`, current compiler | 8 | **0** | 8 |

The two it names on the pristine arm are `SC2020 decode.js:6` and
`SC1090 index.js:19` — exactly the two the ladder found at one 15-minute rebuild
each, in the same order. That is the positive control; the `0` rows are the
instrument reporting the expected null. `runs/initpath-census.txt`.

Two things it produced that nobody asked for: the enclosing-function names attribute
each remaining fence to `decode`/`encode`/`writeValue`/`isLabeled` by name, and one
fence nobody had counted sits in `prov/.../spec/proto/index.js:1`, outside argo-codec
entirely.

## 11.3 THE ANSWER: no — and not for any reason on the fence list

`harness/mexprobe/decode-answer.ts` is the question at the smallest scale that can
answer it: zapo's `src/transport/node/mex/argo-decoder.ts` byte for byte (only the
`@util/bytes` `TEXT_DECODER` import inlined, because that alias points into the zapo
tree), driven over argo-codec's OWN 114-byte encoding of the payload the fake server
answers `w:mex` with. Correctness is observable as VALUES.

```
NODE ORACLE                     isMexArgoDecoderAvailable = true
                                OK isActive=true enforcementType=SOFT_BLOCK enforcementEndsAt=1767225600

COMPILED --npm-static argo-codec, init-path fences 0, build exit 0, no fence fires
                                isMexArgoDecoderAvailable = false
                                DECODE THREW: argo-codec not installed

COMPILED, no --npm-static       isMexArgoDecoderAvailable = false
                                DECODE THREW: argo-codec not installed
```

The two compiled arms are **byte-identical in their output**. Three different causes
— an uncoded module refusal, a module-init fence, and a namespace with no exports —
all arrive at the same line. `runs/mex-decode-answer.txt`.

**"argo closed" was a build result and it stays one. The capability is not there.**

### What actually stands in the way

`lower-island.ts:725`. For a `--npm-static` package, `import()` takes a dedicated
arm (`npmStaticDepSf7` → `staticDynNsBuilderOf`) that returns
`promise.resolve(<dyn namespace object>)` **before** the static tier's position gate.
Four consequences, each measured:

1. **The namespace is nearly empty.** It is built from `modSym.getExports()`.
   argo-codec's rewritten CJS barrel is `module.exports = {…}` — an `export=` — so
   that table holds ONE entry, mapped to `default`. The emitted builder
   `sc_f__x25_dynnsd_m5_` does exactly one `scr_dyn_key_set`, with the literal
   `"default"`, whose value is `sc_f__x25_fn0_dyntrap`. Compiled, all ten named
   exports read `undefined`; Node answers ten functions and
   `Object.keys` = `Buf,ERROR_WIRE,FieldErrorSentinel,Reader,decode,encode,isLabeled,pathToWire,unwrap,wireToPath`.
   **The compiled namespace and Node's share no key at all.** Node synthesizes those
   names with cjs-module-lexer; this build does not, though `frontend/cjs-lexer.ts`
   is already in the tree.
2. **A class could not cross anyway.** `exportDynValue` maps a class export to a
   trap by design, so `new argo.Reader(bytes)` — which is the whole of zapo's decode
   path — has nothing to bind to even once the names are present.
3. **The two spellings the tier says it DOES serve are not served here.** Because
   the arm returns early, `const ns = await import('argo-codec')` refuses SC2001 at
   `new ns.Reader(...)` and `const { Reader } = await import('argo-codec')` refuses
   SC1031 "the source is dyn-typed".
4. **zapo's spelling ends in `null`.** `loadArgo()` stores the namespace into
   `let cachedArgo: ArgoModule | null | undefined`; the emitted `sc_dc_0` dyn-check
   against that union fails, `cachedArgo` becomes `null`, `catch` never runs, and
   every caller reports "'argo-codec' not installed".

### The control that makes this a DEFECT and not a limitation

The identical spelling against a LOCAL program module is a **build-stopping SC2012**
carrying the right teaching:

> the static tier serves this import at a CONST binding … A namespace stored, passed
> on, or awaited anywhere else has no static value to be — Node's namespace object is
> exotic and this build materializes no stand-in for it

`--npm-static` exempts the package from that rule and answers a wrong value instead.
`runs/npm-static-namespace-control.txt`.

### The repro, with no zapo and no argo-codec in it

`tests/fixtures/npm/cases/npmstatic-dynimport-cjs/main.ts` dynamically imports
**this repo's own** `gtdefine` fixture — the `Object.defineProperty(exports,'n',{get})`
family that `npm-static-rewrite.ts` itself rewrites into `module.exports = {…}`.

```
node                                    leaf function     WIDTH number
compiled --backend c --npm-static gtdefine
  build ok, npmStatic status "static",
  zero diagnostics, exit 0              leaf undefined    WIDTH undefined
```

`tests/harness/module-ns-value.test.ts` pins namespace behaviour thoroughly — a mutable
export refuses SC1013 by name, an assignment and a delete both refuse loudly — but every
package it stages is ESM source, where `getExports()` carries every name. The CJS barrel
shape, which is the shape `--npm-static`'s own rewrite emits, has no coverage there.
`runs/npm-static-dynimport-cjs-repro.txt`.

### And no lane compiles `loadArgo()` correctly -- only one is honest about it

| lane | build | run |
|---|---|---|
| `--npm-static argo-codec`, static | exit 0, no fence fires | answers `null` -- **silent wrong value** |
| no flag, static | exit 0 | answers `null` (the in-band module refusal, swallowed by zapo's `catch`) |
| `--dynamic` (the island, quickjs) | **REFUSES**, SC1090 at the same line | -- |

The island lane's refusal names the real shape: the namespace is `any` and cannot exit
into the declared `ArgoModule | null | undefined`. That is the same fact the static lane
discovers at run time and reports as "not installed". `runs/npm-static-namespace-control.txt`.

The file already states the doctrine this breaks. At `lower-island.ts:1257`, for
`export *` re-exports it says a namespace built without them "answers `undefined` for
a name Node answers, silently" — and refuses to build. The CJS `export=` case walks
straight past the same doctrine.

### What it would take

1. **Smallest honest change:** apply the position gate to npm-static packages too.
   zapo's `loadArgo()` then fails to BUILD, naming the real cause, instead of running
   and lying. It does not make argo work; it stops the silence.
2. **Fill the namespace:** for an `export=` module take the named exports from the
   export symbol's type properties, or from `cjsLexedExportsOf` (already in the tree,
   and it is Node's own rule). Reaches `decode`, `encode`, `isLabeled`; `Reader` still
   crosses as a trap.
3. **What zapo actually needs:** a class that stays a class through a dynamically
   imported namespace, and a namespace value that survives being stored in a typed
   variable. The comment at `lowerOwnModuleImport` says the static tier deliberately
   materializes no such value — so this is a design call, not a bug fix.
3b. **A third wall sits behind both.** Bypass the namespace entirely --
   `harness/mexprobe/argo-decoder-static.ts` is the same decoder with
   `import { Reader as ArgoReader } from 'argo-codec'` in place of the stored
   dynamic namespace, one change, every other line zapo's -- and it still does not
   compile: `--npm-static` DROPS the package's .d.ts on purpose, so `r.pos` types
   as `any` (SC2011 on `<`) and the inferred class `m0.Reader` does not width-coerce
   into zapo's structural `ReaderLike` record (SC2002). The node lane is fine because
   the .d.ts is there. Without `--npm-static` the static import has no story at all.
   `runs/mex-decode-static-import.txt`.

4. **Zapo-side, a FINDING and not a change:** `const { Reader } = await import(...)`
   inside `loadArgo` would be a served spelling, but zapo caches the module in a
   module-level `let`, which is the shape that has no static value. No zapo edit was
   made and none is proposed.

## 11.4 UNASKED-FOR: a deterministic ACCESS_VIOLATION on the argo path

`out/bm-argo4/messaging.bench.exe` — 28,403,712 B, md5 `931cb864dbeee641df0c2b4d806d7ff1`,
the `--npm-static argo-codec` bench with BOTH module-init fences substituted — dies
with **0xC0000005** on every run (4/4, including under gdb), immediately after the
server registers the `w:mex` handler and before the client's first probe line.
`RUN_EXIT=139`.

What is known:

* gdb: 5 program frames under `ntdll!RtlUserFiberStart`, so the fault is on a
  **scriptc fiber** — inside async task execution, which is where
  `await import('argo-codec')` runs (`sc_as__x25_m0_loadArgo` → `scr_async_spawn`).
* Image base `0x7ff644760000` (`.text` at `+0x1000`), no ASLR movement between runs.
  Faulting RVAs: `#0 0x875FE7  #1 0x95E506  #2 0x845BDF  #3 0x2D7C33  #4 0x0526C0`.
* It needs argo-codec's barrel init to COMPLETE: `bm-argo3`, whose earlier and wrong
  substitution left an `SC2020` at `index.js:5` so init aborted early, runs the whole
  workload to exit 0.
* It does NOT reproduce in `da-argo` / `rc-dyn`, which run the same namespace builder
  over the same package. So it needs something the bench has and they do not.

Not localized further, and the reason is nameable: symbolizing needs a PDB reader, and
the route `tests/perf/pdb-symbols.mjs` documents — WSL `llvm-pdbutil` — is not
installed on this host (`wsl -e which llvm-pdbutil` → 127), nor is there an
`llvm-symbolizer` under `<zapo-work>\tools`. **What it would take:** `llvm-pdbutil` in
WSL and one `--resolve` against `out/bm-argo4/messaging.bench.pdb` with those five RVAs.

This is a RUNTIME error in a compiled zapo, which is squarely the block's objective, so
it is recorded here rather than left in a log.

## 11.5 Structure that fell out on the way

* Of argo-codec's five shipped CJS modules, **only `encode.js` and `index.js` are
  rewritten** by `--npm-static`. `decode.js`, `wire.js` and `buf.js` are served
  untouched, so their fence locations are their own and need no qualifier. The
  §10.3(b) claim that `buf.js` carries no fence still holds, and now so does the
  reason it needs none.
* The rewritten `index.js` is 30 parts: lines 1–17 space-padded in place, 18 blank,
  19–29 the appended table, and line 19 is `const __scriptc_e0 = encode_js_1.encode;`
  — read with `harness/rewrite-probe.mjs`, not inferred.
* A `--npm-static` fallback names its reason well: `--npm-static ws` reports
  `SC1012: require() destructuring with defaults, rest, or nested patterns are not
  supported yet`. That is the negative arm of the confirmation line, and without it the
  line is a check that can only say yes.
