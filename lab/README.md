# voipfix — voip's package entry, and whether a package's `lib` can be honoured

Block `voipfix`, branch `block/voipfix`, base main `70e1fe48`.
Measured on win32 x86_64, `zig 0.16.0`, `SCRIPTC_CC=zigcc`,
`SCRIPTC_TARGET=x86_64-windows-gnu`. Build under node v22.18.0, oracle under
node v25.9.0. Sources: the provenance checkout
`250f9af5229a545eec28ddbd3e8774a397cdb0bb`.

The lab lives at `G:\blocks\voipfix-lab` (the app is a copy of the pkgstatus
block's, which survived its worktree). Binaries are in
`G:\blocks\voipfix-lab\bin` and are NOT deleted — the user runs them.

## Environment

    export ZIG_GLOBAL_CACHE_DIR='G:\blocks\voipfix\.zig'
    export ZIG_LOCAL_CACHE_DIR='G:\blocks\voipfix\.zig'
    export SCRIPTC_CACHE_DIR='G:\blocks\voipfix\.cache'
    export TMP='G:\blocks\voipfix-tmp' TEMP=... TMPDIR=...   # OUTSIDE the worktree
    export SCRIPTC_CC=zigcc SCRIPTC_TEST_CC='zig cc' SCRIPTC_TARGET=x86_64-windows-gnu

`G:\blocks\voipfix-lab\env.sh` is the sourced form. `TMP` is outside the
worktree deliberately: a tmpdir inside the tree reddens `fetch-dispatcher.test.ts`
with no compiler change at all.

## The compiler change

`packages/compiler/src/frontend/program.ts` — `libWithProjectAdditions`.
`lib` stays FORCED, but as a FLOOR rather than a ceiling: the es2025 floor
always stands, `lib.es*.d.ts` requests are dropped (the floor covers them),
and every other lib a project names is APPENDED. Opt-in per program, by the
entry project's own tsconfig.

Pinned by four tests in `tests/harness/project-config.test.ts` over
`tests/fixtures/lib-additions/`. Self-tested against the base compiler: the
two DOM tests fail there, the two invariant tests pass both ways.

## The floors, re-run on this base

| binary | lane | bytes LLVM / C | oracle | result |
| --- | --- | --- | --- | --- |
| `voip-stun.exe` | `--provenance-sources` | 812,032 / 812,544 | node v25.9.0 | **7/7 MATCH byte-exact, exit 0** |
| `voip-ssrc.exe` | `--provenance-sources` | 926,720 / 928,768 | node v25.9.0 | **6/6 MATCH byte-exact, exit 0** |

Identical to the pkgstatus block's numbers. Engine scan `quickjs=0 ScrDyn=0
JS_NewRuntime=0` on all four binaries.

## Probes, and what each one settles

| path | settles |
| --- | --- |
| `app/pkgs/voip/tsconfig.json` | zapo's real voip tsconfig, reproduced in the lab: `"lib": ["ES2020","DOM"]` |
| `app/pkgs/voip/entry-drive.ts` | voip's package entry driven through its real exported API, 29 assertions |
| `app/pkgs/voip/relay-drive.ts` | the awkward case: reaches `@roamhq/wrtc`, the capability that does not exist |
| `app/domprobe2/` + `app/nodomprobe/` | BYTE-IDENTICAL sources, DOM on vs off — the silent-wrong-answer hunt |
| `app/domprobe2/rtc-value.ts` | `new RTCPeerConnection()` under honoured DOM: must refuse by name |
| `app/probe-mlow2/mlow-codec-int16.ts` vs `-int32.ts` | the real `mlow-codec.ts` with ONE token changed |
| `app/probes/q1..q7.ts` | which typed-array views compile: 8-, 32-bit and float yes, **16-bit no** |
| `app/probes/optdate.ts`, `optnum.ts` | `d?: Date` in a record refuses; `d?: number` compiles |

## Reproducing

    . /g/blocks/voipfix-lab/env.sh
    node   $LAB/sites.mjs "$PWD/pkgs/voip/index.ts" $LAB/runs/dom-voip-entry.json
    bash   $LAB/bo.sh drivers/voip-stun.ts voip-stun --provenance-sources
    bash   $LAB/bo.sh drivers/voip-ssrc.ts voip-ssrc --provenance-sources

The provenance lane is not slow-looking, it is slow: entries take 10-20
minutes and a `--provenance-sources` build of voip's entry is longer. Slow is
not hung.
