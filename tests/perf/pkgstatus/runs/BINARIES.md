# Binaries from block `pkgstatus` — keep these

Nine programs, each built on **both backends**. Every `.exe` is the LLVM
backend (what ships); every `.c.exe` is the same program through the C
backend. Compiler: scriptc at `16705f5c` (+ the provenance tar fix,
`c5b61d1b`), `zig 0.16.0`, `SCRIPTC_TARGET=x86_64-windows-gnu`,
`SCRIPTC_GENERIC_SLOT=1`. Built under node v22.18.0.

**None embeds the dynamic engine.** The scan uses only the two markers that
discriminate — `quickjs` and `ScrDyn` — because `JS_NewRuntime`, `JS_Eval` and
`__island_eval` all read zero in a binary that certainly does embed it. Both
markers read **0** in all eighteen files here.

`<name>.llvm.out`, `<name>.c.out` and `<name>.node.out` beside each binary are
its recorded output and its oracle: the same source run under **node v25.9.0**
through `tsx`.

| binary | bytes (llvm / c) | lane | run it to see | oracle |
| --- | --- | --- | --- | --- |
| `store-sqlite-bundle2.exe` | 24,141,824 / 23,947,264 | `--provenance-sources` | all 15 store factories of `createSqliteStore({path:':memory:'})` construct | **17/17 MATCH byte-exact, exit 0** |
| `store-sqlite-bundle.exe` | 24,138,752 / 23,943,168 | `--provenance-sources` | the same bundle, one line | **MATCH byte-exact, exit 0** |
| `store-sqlite-sqlutils.exe` | 657,920 / 657,920 | default static | `repeatSqlToken` over 7 cases | **7/7 MATCH, exit 0** |
| `store-sqlite-names2-be.exe` | 814,592 / 816,128 | `--best-effort` | the default SQLite table-name map and its serialization | **8/8 MATCH, exit 0** |
| `store-sqlite-names-be.exe` | 818,688 / 819,712 | `--best-effort` | **the awkward case on purpose** — it executes an unlowerable statement and stops with `SC2020 at table-names.ts:116` | refusal, exit 1 (not a wrong answer) |
| `store-sqlite-open-be.exe` | 922,112 / 926,720 | `--prov --best-effort` | stops at zapo-js `src/util/runtime.ts:20`, `globalThis` | node v25 also fails here — `better_sqlite3.node` is ABI-locked to Node 22. No oracle exists on this path. |
| `wam-wire-probe2.exe` | 2,812,416 / 2,871,808 | `--prov --npm-static '@vinikjkkj/wa-wam'` | zapo's own `wire/__tests__/wire.test.ts`, reproduced | **14/14 MATCH, exit 0** |
| `voip-stun.exe` | 812,032 / 812,544 | `--provenance-sources` | the WhatsApp STUN ping header, magic cookie and two subscription payloads | **7/7 MATCH, exit 0** |
| `voip-ssrc.exe` | 926,720 / 928,768 | `--provenance-sources` | five exact SSRC values | **6/6 MATCH, exit 0** |

`store-sqlite-bundle2.exe` is the one to run first: it is the first native
binary of a zapo store package's real API. 45,723 statements of zapo-js and
`@zapo-js/store-sqlite` compiled statically, zero blockers, no
`--best-effort`, and it prints exactly what node prints.

Sources for every driver are committed under
`tests/perf/pkgstatus/drivers/` in the scriptc repo; the full report is
`G:\zapo-work\estado-pkgstatus.md`.
