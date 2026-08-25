# `tests/perf/zapobench` — measuring zapo, not a bench that looks like zapo

`tests/perf/bench/messaging.bench.ts` is a 160-line synthetic reproduction of
the *shape* of zapo's per-message work. Its own header says so. This directory
measures **zapo itself**: `ixmax3.ts` compiled `--backend c`, driven by
`@zapo-js/fake-server` through the real 76-stanza pairing conversation, against
**the same source running under Node**.

Nothing here is a vitest test. It is a set of instruments, each of which can be
asked to prove it works before its answer is believed.

| file | what it is |
|---|---|
| `runner.c` | the ONE memory/CPU instrument. Spawns a child with inherited stdio, waits, then reads `PeakWorkingSetSize` (`K32GetProcessMemoryInfo`) and `GetProcessTimes` for that child **from outside the process**. Both lanes go through it, so `node.exe` and a compiled `.exe` are measured by the same counter, the same way, by the same code. |
| `ballast.c` | the runner's **positive control**. Touches exactly N MiB and exits; the runner's reported peak must rise by N MiB. Measured here: 0 / 32 / 64 / 128 / 256 MiB reported 4.00 / 36.02 / 68.02 / 132.02 / 260.02 MiB — linear, and exact to 0.02 MiB. |
| `patch-drv.mjs` | turns `G:\zapo-work\...\drv.mjs` into a measuring driver by four anchored edits. Every anchor is checked; a moved anchor is a hard error, never a silent no-op. |
| `zb-scan.mjs` | anchors a binary before believing it: size, md5, and a byte scan for the `SCTRAP %s %.*s` format string. **`SCTRAP lines(0)` on an UNTRACED binary is DID-NOT-RUN**, because the marker is `#ifdef`'d out without `SCRIPTC_TRAP_TRACE=1`. Carries a negative control that must be ABSENT. |
| `zb-cmp.mjs` | compares two runs' captured stanzas. Not `diff`: `stanza.count` is not an invariant and an A/A pair of the *same binary* differs on 13–32 lines from `sid` randomness, `<enc>` payload length and stage ordering alone. Normalises exactly those, compares as a multiset, and has a 13-check self-test with five negative controls. |
| `zb-summary.mjs` | aggregates every run's metrics JSON per arm: peak working set as a number, CPU as a range, plus each run's stanza count, exit code, untagged-abort count and SCTRAP count — because a memory number from a run that did not complete the protocol is not a number. |
| `build.sh`, `run.sh`, `sweep.sh` | the shell around it. **Every arm builds from ONE app directory**, distinguished by output binary name only: the app path is baked into the emitted TU ~94,000 times, so two directories make the md5s always differ and the byte counts never do. |

## The memory number

Every peak-RSS figure is **`PeakWorkingSetSize`** — the high-water mark of the
process's **TOTAL** working set, private plus file-backed. **Task Manager's
default "Memory" column is the PRIVATE working set and reads LOWER**: on zapo
the private set is about 42% of the total.

## Running it

The full environment, the exact commands, and every raw log live beside the
binaries in `G:\zapo-work\zapobench-artifacts\` with its own README. The short
version: zig 0.16.0 from `G:\zapo-work\tools\zig` must come first on `PATH`,
`SCRIPTC_CC=zigcc`, `SCRIPTC_TEST_CC="zig cc"`,
`SCRIPTC_TARGET=x86_64-windows-gnu`, `SCRIPTC_GENERIC_SLOT=1`, `--best-effort`,
and **both** `ZIG_GLOBAL_CACHE_DIR` and `ZIG_LOCAL_CACHE_DIR` pointed off C:,
because zig ignores `TMP`.

## What it measured, at `fc8677b1` against `756add37`

| lane | peak working set, median of 5 | min-max | spread |
|---|---:|---:|---:|
| scriptc `fc8677b1` | **29,245,440** | 28,807,168 - 29,409,280 | 2.09% |
| node **v25.9.0** | **125,403,136** | 124,796,928 - 129,908,736 | 4.10% |
| node **v22.18.0** (n=3) | **137,256,960** | 136,998,912 - 137,822,208 | 0.60% |
| scriptc `756add37` | 29,999,104 | 29,806,592 - 30,609,408 | 2.69% |

**4.29x smaller than node v25.9.0.** All 18 runs answered 76 stanzas with the
same tag multiset and exited 0. `gate.sh` is the vitest gate exactly as run.

Two things this directory exists to stop the next block repeating:

* **The harness's oracle is `PATH`'s `node`, not `process.execPath`.**
  `server.test.ts`, `npm.test.ts` and `node-test.test.ts` spawn the literal
  string `"node"`. Running vitest *under* v25.9.0 is not enough. With v22.18.0
  first on `PATH` the gate came back **18 failed** — `node:test` reporter
  format, `util.inspect` symbol-key rendering, a TLS message whose newer Node
  appends `--use-system-ca` — every one of which reads as a scriptc
  regression. With v25.9.0 first: **18 -> 1**, and that one passed 3/3 on
  repeat. `gate.sh` puts it there and says why.
* **`SCRIPTC_PROVENANCE_CACHE`'s path is baked into the emitted TU**, twelve
  times, exactly like the app directory. Give every arm the SAME provenance
  cache and a SEPARATE object cache, or the two TUs differ on the path alone.
