# twobyte — the bytes element representation and 16-bit typed arrays

The runtime's `scr_bytes_elem_size` answered `1, 4, 4, 4, 8` and had **no
2-byte case at all**, so `Int16Array` and `Uint16Array` — PCM audio's
element and its unsigned twin — had no representation. This block gives
them one, and fixes two element-size defects the same table exposed.

Everything here is measurement infrastructure and its output. Nothing runs
in the gate.

## Layout

| path | what |
| --- | --- |
| `env.sh` | the block's environment. Source it before anything else. |
| `run.sh` | one program, three lanes: node v25.9.0 oracle, `--backend c`, `--backend llvm`. Prints `MATCH` / `WRONG` / `TRAP` / `DID-NOT-RUN` per backend. Never gates on exit status — a run that prints an uncaught error can still exit 0. |
| `fences.sh` | fence PARITY: every surface that refuses for a 32-bit typed array must refuse identically for the 16-bit one. Ten probes × two signednesses. |
| `gate.sh` | the full vitest suite under node v25.9.0, PATH pinned inside the launcher, `node --version` as the log's first line. Never uses `pnpm exec`: v25's pnpm purges v22's `node_modules` and it reads as a red gate. |
| `progs/` | the 21 differential programs (`t01`–`t21`; `t15` was folded into `fences.sh`). The three worth pinning permanently were promoted into `tests/corpus/7324`–`7326`. |
| `ab.sh` | base-vs-branch over that whole set in one lane: checks `packages/{compiler,runtime}/src` out at the base revision, rebuilds `dist`, scores, restores, rebuilds. |
| `ab-table.txt` | the 46-cell result. |
| `bin/` | every compiled probe, both backends, kept on purpose (git-ignored, not deleted). Run one directly; its Node oracle output is beside it in `G:/blocks/twobyte-lab/runs/progs/<name>.node.txt`. |

Captured output, the voip re-measurement and the gate log live outside the
worktree in `G:/blocks/twobyte-lab/runs/` so a rebuild never sweeps them.

## Reproducing

```sh
. lab/env.sh
bash lab/run.sh lab/progs/*.ts          # 18 programs × 2 backends
bash lab/fences.sh                      # i32/i16 and u32/u16 refusal parity
bash lab/gate.sh                        # the full suite under v25.9.0
```

The voip re-measurement uses `G:/blocks/twobyte-lab/sites.mjs` (a copy of
`tests/perf/pkgstatus/harness/sites.mjs`) against a copy of pkgstatus's lab
app at `G:/blocks/twobyte-lab/app`:

```sh
node G:/blocks/twobyte-lab/sites.mjs \
     G:/blocks/twobyte-lab/app/domprobe/voip-entry.ts out.json --provenance-sources
```

`voip` needs `lib.dom.d.ts` referenced into the program or preflight fails
on `RTCPeerConnection` before any lowering runs — `domprobe/voip-entry.ts`
is that reference. The provenance lane over that entry takes about an hour.

## The armed control

`G:/blocks/twobyte-lab/app/probe-mlow/mlow-codec-ctl.ts` is the probe with
`Int16Array` textually replaced by **`Uint8ClampedArray`**, which is still
unrepresentable. It reproduces the pre-change refusal set exactly (7
statements analysed, 1 blocker, 2 unreached, +2 functions signature-blocked)
in the same lane as the fixed file (60/60, zero). A harness that cannot
report "nothing changed" cannot be trusted when it does.

## The result

46 cells (23 programs x 2 backends), scored against node v25.9.0:

| | MATCH | WRONG | TRAP | DID-NOT-RUN |
| --- | --- | --- | --- | --- |
| base `70e1fe48` | 0 | 2 | 44 | 0 |
| this branch | 44 | 0 | 2 | 0 |

**2 WRONG -> MATCH, 0 MATCH -> WRONG.** The other 42 are TRAP -> MATCH
(`Int16Array`/`Uint16Array` had no representation, so every program
carrying one was a build refusal). The 2 that stay TRAP are both
`t09-align`, the deliberate refusal for an indivisible byte length -- and
its advice now names the right divisor and was compiled and run
(`t08-view-offset` is that advice).

The 2 WRONG cells are `t20-f64-over-arraybuffer` on each backend:
`new Float64Array(new ArrayBuffer(8))` was a TWO-element array with a
byteLength of 16 on base. That file carries no 16-bit kind and no
`Int8Array`, deliberately, so nothing refuses first and hides it.
