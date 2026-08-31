# voipfix — voip's package entry, the forced `lib`, and what a visible type does not make true

Block `voipfix`, branch `block/voipfix`, base main `70e1fe48`.
win32 x86_64, `zig 0.16.0`, `SCRIPTC_CC=zigcc`, `SCRIPTC_TARGET=x86_64-windows-gnu`.
Build under node v22.18.0, oracle under node v25.9.0. Sources: the provenance
checkout `250f9af5229a545eec28ddbd3e8774a397cdb0bb`.

Nothing here runs in the gate: `tests/perf/` is excluded from the directory
gate and no vitest file imports it. The mechanism itself is pinned by four
tests in `tests/harness/project-config.test.ts`, which DO run.

## The headline

**voip's entry does not reach a binary, and it is exactly two things away.**

The entry now crosses preflight and its whole graph compiles down to five
named refusals on BOTH backends. `--best-effort` does not defer them — a
field whose TYPE has no representation is not a per-statement refusal, so
there is nothing to defer. Both backends refuse identically, `rc=1`.

| # | site | code | cause |
| --- | --- | --- | --- |
| 1 | `media/mlow-codec.ts:26` | SC2009 | `Promise<MlowModule> \| null` ← **`Int16Array`** |
| 2 | `media/mlow-codec.ts:51` | SC2009 | `MlowEncoder \| null` ← **`Int16Array`** |
| 3 | `media/WaAudioEngine.ts:218` | SC2020 | **`Int16Array<ArrayBufferLike>`**, named directly |
| 4 | `relay/WaSctpRelay.ts:5` | SC2013 | `importing '@roamhq/wrtc'` |
| 5 | `relay/WaSctpRelay.ts:94` | SC2009 | `Map<string, Connection>` ← `Connection.peerConnection: RTCPeerConnection \| null` |

Three of five are `Int16Array`. Two of five are `@roamhq/wrtc`.

## What each probe settles

| path | settles |
| --- | --- |
| `drivers/voip-tsconfig.json` | zapo's real voip tsconfig: `"lib": ["ES2020","DOM"]` |
| `drivers/entry-drive.ts` | voip's entry driven through its real exported API, 29 assertions, all pass under node v25.9.0 |
| `drivers/relay-drive.ts` | the awkward case: reaches `@roamhq/wrtc`, the capability that does not exist |
| `probes/shadow.ts` | DOM-shadowed node globals (`URL`, `TextEncoder`, `AbortController`), compiled DOM-on and DOM-off from BYTE-IDENTICAL sources |
| `probes/rtc-value.ts` | `new RTCPeerConnection()` under honoured DOM — must refuse by name |
| `probes/q1,q3,q4,q5,q6.ts` | which typed-array views compile: `Int16Array`/`Uint16Array` **no**, `Uint8Array`/`Int32Array`/`Float32Array` yes |
| `probes/optdate.ts` vs `optnum.ts` | `d?: Date` in a record refuses; `d?: number` compiles |

`probes/shadow.ts` prints only REAL VALUES — a URL's parts, UTF-8 bytes in
hex, an AbortSignal before and after. `typeof` appears nowhere in it: it
answers `"object"` for both the right answer and the wrong one, and a test
that cannot distinguish the two is not a test.

## Runs

| file | what |
| --- | --- |
| `runs/neg-voip-entry.json` | the entry with NO DOM request: 2 sites, `SC0001` at `WaSctpRelay.ts:30` and `:31`, preflight fails |
| `runs/dom-voip-entry.json` | the entry under its own tsconfig: crosses preflight, 55 statements, 1 failed, 31 blocker sites, 3 distinct messages |
| `runs/dom-voip-prov.json` | `--provenance-sources` too: 45,632 statements, 8 failed, **13 blocker sites, 13 distinct messages** |
| `runs/rtc-value.json` | every DOM value refusing by name: `'new RTCPeerConnection' … has no scriptc lowering yet` |
| `runs/voip-entry-be.build-{llvm,c}.log` | both backends refusing the entry identically, 5 errors each |
| `runs/floor-{stun,ssrc}.log` | the two floors re-run on this base |
| `runs/shadow-*.out` | DOM-on and DOM-off output, and the node v25.9.0 oracle — all three identical |

## Reproducing

    . tests/perf/voipfix/env.sh     # adjust WT/LAB to your block
    node   $LAB/sites.mjs "$PWD/pkgs/voip/index.ts" out.json --provenance-sources
    bash   $LAB/bo.sh drivers/voip-stun.ts voip-stun --provenance-sources

The lab app must hold voip's `src/` flattened into `pkgs/voip/` with
`drivers/voip-tsconfig.json` beside it as `tsconfig.json`, and every peer
dependency installed. The provenance lane is not slow-looking, it is slow:
the entry's analysis is 1,271 s and each backend's build of it is longer.
Slow is not hung.

## Honouring `lib` costs nothing INSIDE voip -- and that is not the same as costing nothing

**Read the section below together with the one after it, which refutes its
framing.** Everything measured here is real: inside voip's own program the
`/// <reference>` workaround costs 15 refusals that honouring `lib` does not.
What it does NOT establish -- and what I wrongly generalised from it -- is
that honouring `lib` is free for OTHER programs. It is not: six test files
that write a DOM lib at run time go red. The measurement stands; the title
it originally carried ("costs nothing") did not.

`estado-pkgstatus.md` reached voip's entry by referencing TypeScript's shipped
`lib.dom.d.ts` into the program with a `/// <reference path="…" />`, and
measured **23 failed over 27 blocker sites** under `--provenance-sources`,
with `URL.hostname`, `URL.protocol`, `AbortSignal.aborted` and
`TextEncoder`/`TextDecoder` appearing as NEW blockers inside zapo-js. That
cost is the whole reason an earlier block refused to ship a `lib` change.

Honouring the project's own `lib` instead measures **8 failed over 13 blocker
sites**, and those names appear **nowhere in all 177 sites, in any section**
(`runs/dom-voip-prov.json`).

The difference is not luck; it is structural, and it is one line of the
compiler. `lowerer.ts`'s `isStdlibFile` reads

    this.program.isSourceFileDefaultLibrary(sf)

and `frontend/types.ts` gates the stdlib mappings on it — `URL` maps to
`{ kind: "url" }` only when its declaration sits in a stdlib file
(`types.ts:2892`, "Provenance, not the name"), and `URLSearchParams`,
`TextEncoder` and the rest are gated the same way.

A file pulled in by `/// <reference path>` is an ordinary declaration file:
`isSourceFileDefaultLibrary` is **false** for it. So DOM's `declare var URL`
won the name while failing the provenance check that lets `URL` lower at all,
and every use of it fenced. A file named in `lib` **is** a default library, so
the provenance checks still pass and nothing moves.

Which also means the mechanism is a prerequisite for the native `@roamhq/wrtc`
replacement, not merely a way past preflight: a future `scr_wrtc.c` needs
`RTCPeerConnection` to map to a lowered type the way `URL` does, and that
mapping is gated on the DOM declaration being a stdlib file. `WaSctpRelay.ts:94`
(`Map<string, Connection>`) does not clear until it is — a wrtc runtime that
merely satisfies the DOM interface leaves that site refusing.

## The `lib`-as-floor mechanism was measured, and REVERTED. Here is what it would take.

Commit `24e21a10` made `lib` a floor rather than a ceiling: es2025 always
stands, `lib.es*` requests dropped, everything else appended, opt-in per
program by the entry's own tsconfig. It reached voip's entry — preflight-fail
7 → 0 — and it is **reverted**, because it reddened six test files that pass
at base. `program.ts` here is byte-identical to `70e1fe48`.

### The attribution, measured both ways uncontended

| | base `70e1fe48` | with `lib`-as-floor |
| --- | --- | --- |
| the six files | **6 passed**, 86/87 tests | **6 failed**, 51 failed / 16 passed |

`coverage.test.ts > every corpus program is 100% static` fails in **both** —
it is a 600 s timeout under load, not the mechanism. Six files, not seven.

The margin there is thinner than the old "267 s" figure suggests: a sibling
measured that test at **578 s uncontended against the 600 s limit**, so it is
now one slow neighbour from red for everyone, independently of anything here.

### Why my control did not catch it

I proved DOM-on and DOM-off produce byte-identical machine code — on probe
sources that never name `fetch`, `RequestInit` or `Function.prototype.bind`.
Those are the names that move. **A control drawn from sources that cannot
contain the counterexample is not a control.**

The census was wrong the same way. I enumerated committed `tsconfig*.json`
files and concluded no corpus program requests DOM. But **six test files
WRITE `lib: ["es2023", "dom"]` at run time** — `builtin-fn-value`,
`fetch-dispatcher`, `fetch-static`, `fn-identity`, `module-ns-keys`,
`request-init` — and they are exactly the six that failed, 1:1.
`fetch-static.test.ts` states the contract in a comment: *"no node types, so
it type-checks against the same lib set in both lanes"*. **They declare DOM
and depend on scriptc ignoring it.** The population that matters is configs
actually parsed, not files on disk.

### Can the surface be narrowed? Not this way — and the reason is not scope

Two distinct failure modes, separated by measurement:

1. **`.d.ts` collision noise — 46 of the 51.** `lib.dom.d.ts` and the node
   declarations contradict each other on `console`, `MessageEvent`,
   `AbortController`, `DOMException`, `crypto`, `Response`/`Body` and six
   `URL` members. Forcing `skipLibCheck` whenever an addition is taken clears
   all of them (probed: 6 files → 2, 51 tests → 5).
2. **A real capability regression — the remaining 5, and skipLibCheck does
   not touch them.** DOM's `fetch` declares **two** call signatures where
   node's declares one, so `fetch` as a value becomes
   `SC2007 … the type declares multiple call signatures (overloads), and a
   compiled function value is always one concrete signature`. It refuses
   loudly rather than answering wrongly — but it compiled before and does
   not now.

Mode 2 is why narrowing the SCOPE cannot help: the damage is **inside** the
opting program, and TypeScript offers no per-file `lib` and no per-name
precedence between two default-library declarations. Once DOM is a default
library, its `fetch` is authoritative for that program. The earlier block's
instinct was right, and scoping which programs opt in does not answer it.

### The mechanism that would work, and why it is different

Every name in the failure population is one **node also declares**. The two
names voip refuses on are not: **neither `@types/node` nor scriptc's own
ambient declarations mention `RTCPeerConnection` or `RTCDataChannel`
anywhere** (verified). Those two names are collision-free.

So the route is the `scriptc-sqlite.d.ts` precedent, not a `lib` knob: ship a
curated WebRTC declaration file, admit it as a stdlib root the way
`sqliteDtsPath()` is admitted, and let it stand down when real types are
present. It is a different mechanism with a different risk profile: an
additive file whose names nothing else declares, rather than a lib that
displaces declarations a program already had.

### The next block's FIRST question, and it is UNMEASURED

**How much of `lib.dom.d.ts` does the RTC slice transitively need, and does
that closure stay clear of `Event` and `MessageEvent`?** Those two DO collide
with the node declarations -- `MessageEvent` is in the failure population
above ("All declarations of 'MessageEvent' must have identical type
parameters"). `RTCPeerConnection`'s event handlers are typed against them, so
the closure plausibly reaches them, and if it does, the slice inherits
exactly the collision problem the `lib` knob died of.

**I did not measure this.** What I measured is only the starting condition:
the two names voip refuses on are collision-free. That is a necessary
condition, not a sufficient one, and it says nothing about their closure.
**Measure the closure before writing the file.**
