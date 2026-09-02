# pkgstatus — the eight zapo packages, measured in three lanes

The five `store-*` packages had never been measured. `estado-stores.md`
surveyed the **npm drivers** (`pg`, `mysql2`, `ioredis`, `mongodb`,
`better-sqlite3`); `estado-remeasure.md` surveyed `media-utils`, `voip` and
`wam`. This directory measures **zapo's own** `@zapo-js/store-mongo`,
`store-mysql`, `store-postgres`, `store-redis`, `store-sqlite`, plus the three
already surveyed, at `16705f5c`.

The report is `G:\zapo-work\estado-pkgstatus.md`. Nothing here runs in the
gate: `tests/perf/` is excluded from the directory gate and no vitest file
imports it.

## The distinction the tables are built around

| state | meaning |
| --- | --- |
| `ANALYSED` | preflight crossed and there were statements to analyse |
| `ISLANDED` | preflight crossed and **nothing was analysable** — every import is fenced, so `statementsTotal` is 0 because there was no code to look at |
| `EMPTY` | a type-only module |
| `PREFLIGHT-FAIL` | the analysis never ran; every number is absent, not zero |

`tables.py` never prints a bare `0` for an islanded module. Eight modules in
this corpus are islanded (five in `voip`, three in `wam`) and every one of them
would read as "clean" without that column.

## Layout

| path | what |
| --- | --- |
| `harness/env.sh` | the block's environment; every path under `G:\blocks\pkgstatus*` |
| `harness/sites.mjs` | one entry → one JSON of `(section, code, message, file, line)` + stats, calling `analyze()` exactly as the CLI's `coverage` path does |
| `harness/sweep.sh` | per-module sweep, one lock per output dir, **controls first**, resumable |
| `harness/selftest.py` | five checks, two of them armed controls that ran in the same lane as the corpus |
| `harness/tables.py` | per-module / per-package / global-by-message tables, islanded never conflated with zero |
| `harness/surface.mjs` | import sites vs distinct imported names, per package per npm dependency |
| `harness/bo.sh` | build on **both** backends, run both, run the same source under node v25.9.0, diff, and scan for the engine |
| `harness/gate.sh` | the full suite under node v25.9.0 with `VITEST_EXIT` captured into its own variable |
| `harness/tsconfig.lab.json` | the lab app's tsconfig |
| `harness/domprobe-*` | `voip`'s entry with the DOM lib supplied by the tsconfig's `"lib"` array. **Never by a copied `dom-lib.d.ts` referenced by path** — `isStdlibFile` is a path identity, so a byte-identical copy is not a stdlib file and every DOM type mapping declines: that one line was 16 of this entry's 19 flagless errors. |
| `harness/cfgprobe-mongo-tsconfig.json` | `store-mongo` under mongodb's own compiler options |
| `sites-default/` | the **complete** default lane: 147 modules + 2 controls |
| `sites-prov/` | the `--provenance-sources` lane: **all 9 entries** + 7 further modules. Partial by design — `store-postgres/index.ts` alone takes 951 s. |
| `drivers/` | every driver each finding rests on |
| `probe-mlow/mlow-codec.ts` | `voip/media/mlow-codec.ts` with **exactly one edit** — the dynamic `import('libmlow-wasm')` replaced by a locally declared function of the same type |
| `runs/` | every binary's output, its node v25.9.0 oracle, the binary table, and the gate |

## A trap this harness has and the first version did not

`SrcLoc` carries a character **offset**, not a line. Reading `d.loc.line` gives
`0` for every site, and a survey keyed on `(file, line, code, message)` then
collapses every site in a file into one — silently, with plausible totals.
`sites.mjs` binary-searches the source text's newline index instead. Anyone
reusing this: check that your dump has non-zero lines before you trust a count.

## Reproducing

Needs a lab app outside the repo holding the eight packages' `src/` flattened
into `pkgs/<package>/`, plus every peer dependency installed —
`zapo-js`, `@vinikjkkj/wa-wam`, `mongodb`, `mysql2`, `pg`, `@types/pg`,
`ioredis`, `better-sqlite3`, `sharp`, `file-type`, `@roamhq/wrtc`,
`libmlow-wasm`, and zapo-js's four **optional** peers (`argo-codec`, `pino`,
`pino-pretty`, `ws`) without which the provenance lane trips over
`src/argo-decoder.ts` in a way that looks exactly like a compiler defect.

```sh
. harness/env.sh
bash harness/sweep.sh "$LAB/sites-default"
bash harness/sweep.sh "$LAB/sites-prov" --provenance-sources
python harness/selftest.py "$LAB/sites-default" 147     # must PASS
python harness/tables.py  "$LAB/sites-default"
node   harness/surface.mjs
bash   harness/bo.sh drivers/drv-sqlite2.ts store-sqlite-bundle2 --provenance-sources
```

The provenance lane is not slow-looking, it is slow: `store-postgres/index.ts`
951 s, `store-sqlite/index.ts` 811 s, `wam/index.ts` 759 s, and a full
`--provenance-sources` build of the store bundle is over half an hour. Slow is
not hung.
