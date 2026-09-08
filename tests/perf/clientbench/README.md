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
* **Do not source another block's `env.sh`.** `<blocks>\msgbench-lab\env.sh`
  sets no `SCRIPTC_PROVENANCE_CACHE` at all, so every build under it used the
  `C:` default; `tests/perf/pkgstatus2/env.sh:4` and
  `tests/perf/voipfix/env.sh:4` point it at *other blocks'* lab directories.
