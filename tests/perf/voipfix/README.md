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
