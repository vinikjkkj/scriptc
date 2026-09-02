# pkgrecheck — re-measurement of store-*, media-utils, wam, voip on main `facbe036`

Previous measurements: `G:\blocks\pkgstatus-lab\estado-pkgstatus.md` (main
`16705f5c`, 8 packages, 147 modules) and
`G:\blocks\pkgstatus2-lab\estado-pkgstatus2.md` (main `7417b09f`, later
`acdd8b96`, the five store/media drivers). Neither lab was modified.

Host: win32 x86_64, `zig 0.16.0`, `SCRIPTC_CC=zigcc`,
`SCRIPTC_TARGET=x86_64-windows-gnu`, `SCRIPTC_GENERIC_SLOT=1`. Compiler built
under node **v22.18.0**; every build, run and oracle under node **v25.9.0**
resolved first on `PATH` (`which node` verified in the measuring shell).
Lab: `G:\blocks\pkgrecheck-lab`; worktree `G:\blocks\pkgrecheck`; base worktree
for the A/B `G:\blocks\pkgrecheck-base` at `7417b09f`.

## States

| state | meaning |
| --- | --- |
| `ANALYSED` | preflight crossed, statements to analyse; the numbers mean what they say |
| `ISLANDED` | preflight crossed and **nothing was analysable** — `statementsTotal` is 0 because there was no code to look at |
| `EMPTY` | type-only module, no runtime statements exist |
| `PREFLIGHT-FAIL` | analysis never ran; every number is **absent**, not zero |

A build that exits non-zero emits no C TU, so its fence count is **absent**,
never 0.

## Instruments and their controls

- `harness/sites.mjs` carries a hardening block that **throws** on a missing
  `coverage`, a missing/typeless `stats`, a non-boolean `preflightFailed`, a
  site with no code or message, or a zero-statement zero-site zero-text read.
  Negative-controlled: corrupting `stats.statementsTotal` before the block
  makes it exit 1 with `BLIND: …`, writing no record.
- Sweep controls `typesprobe` / `typesprobe-neg` ran first in the same lane and
  reported `preflightFailed=false` and `preflightFailed=true` respectively.
- Engine scan negative-controlled by a `--dynamic` binary built in the same
  session: `quickjs=1 ScrDyn=1` in the dynamic control, `0/0` in every static
  binary. `JS_NewRuntime` and `JS_Eval` read **0 even in the dynamic control**
  and are worthless needles.
- Fence counter negative-controlled: reads **4** on `store-sqlite-names.c` and
  **5** on `store-sqlite-open.c`, so the 0s elsewhere are findings.
- Positive control `hello.ts`: MATCH byte-exact both backends, 0 fences.

## Contents

- `table-default.md` — per-module and per-package sweep table, 147 modules
- `sweep-default/` — the 147 per-module JSON records plus the two controls
- `harness/` — every script and the hardened `sites.mjs`
- `drivers/` — the three drivers written by this block
- `logs/` — every build log, binary stdout, oracle stdout and diagnostic log
