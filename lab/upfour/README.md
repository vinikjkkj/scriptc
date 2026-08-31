# upfour — the four upstream candidates the survey left open

`974b5f3b` took one upstream landing of eight, retracted two, deferred one
(#94, top-level await) and left four open. This block closed all four.
Everything here is measurement infrastructure and its output; nothing in this
directory runs in the gate.

**The standard the survey set, applied to itself.** Two of the original eight
died because source agreement is a hypothesis, not a measurement. So every
candidate here was made to FAIL first — the program that reproduces the
defect, run under node v25.9.0 and under scriptc on BOTH backends, before a
line of the fix was written. One of the four came back with a different
answer than the brief predicted, and it was the most important one.

## Layout

| path | what |
| --- | --- |
| `probe.mjs` | one program, three lanes: node v25.9.0 oracle, `--backend c`, `--backend llvm`. Scores `MATCH` / `WRONG` / `TRAP` / `DID-NOT-RUN` per backend, byte-comparing stdout, stderr (exit-0 programs) and exit code. Honours `// @dynamic` in the first two lines like `differential.test.ts` does. |
| `bpatch.py` | a line-ending-preserving patcher. `lower-exprs.ts` is MIXED (27 LF-only lines in 20 328) and `sed -i` or a normalizing editor rewrites all of them; a single-line match gives no evidence of the file's spelling, so this decides from the file's DOMINANT ending and rewrites the replacement to match. |
| `t1`–`t5`, `t7`–`t9` | the `Array.isArray`-over-tuples split. The upstream probe was ONE program, and scoring it whole reported a refusal; these are its shapes one at a time. `t3` is the readonly-union residue, `t7`/`t8`/`t9` are `.length`, the const alias and iteration off the bridged arm. |
| `af1`, `af3`–`af5`, `af7`–`af10` | `Array.from` element kinds. `af5`/`af10` are the ICE; `af4` (Map elements), `af7` (a null-returning mapper) and `af8` (an async one) are the controls that must keep compiling. |
| `w1`–`w4` | the workarounds the refusal's advice names. `w2`/`w3` are the two spellings the message tells you to use and both MATCH node on both backends; `w1` is the negative control that annotating the destination does NOT help, and `w4` is the `.map()` twin's own fence. |
| `r2`, `r3` | the island `Request` cells, through `__island_eval`. `r2` keeps ONE source request for every case and therefore measures the body-DISTURBANCE rule; `r3` builds a fresh one per case and measures the inherited-body rule alone. Splitting them was necessary, not tidy: the shared-source run scores four extra cells that belong to a different defect. |
| `sq1`, `sq2` | `sqliteStmt` as an array element. Not reachable without the sqlite lane's config, so the drift it would have exposed is closed by construction (`canBeArrayElem`) rather than by a probe. |
| `realm-probe.mjs` | two compiles in ONE process with a rewritten `package.json` between them, plus the fresh-process control. |

## What each candidate answered

**#154, `Array.isArray` on tuples — SURVIVED, and the brief's reframing was
wrong.** The brief said it lifts a refusal here rather than fixing a wrong
answer. Splitting the probe showed two SILENT wrong answers on both backends,
exit 0, no diagnostic (`t2`, `t5`), and a third that was a wrong answer with a
runtime trap (`t1`). The refusal the survey scored came from one function in
the same file (`t3`) and hid them. An aggregate probe scores the LOUDEST
answer.

**`7de8be18`, inherited body on GET/HEAD — SURVIVED, and there are two rules,
not one.** `r3` isolates the named one (four cells wrong, eight controls
green) and it is fixed. `r2` shows the second: node also DISTURBS the source
request's body, so a later construction from the same source throws where the
island answers. Not fixed, filed as `tests/perf/upstream/request-source-disturbed.ts`.

**#183, fence `Array.from` elements — SURVIVED, as a real ICE.** `af5` and
`af10` crash the C backend with `emitter bug: no array element representation
for dyn`, and the release default crashes too (measured on the base, all three
lanes). The brief's warning about the allowlist was right and the fix is a
DENY list transcribed from the emitter's own throw list — `af4` (Map elements)
compiles before and after.

**#206, reset module caches — SURVIVED.** `realm-probe.mjs`: same process,
same entry, rewritten `package.json`, and the second compile refuses with
`SC1090 the reference to 'v' (a binding form with no lowering)` while a fresh
process compiles and runs it.

## The gate, and the two size floors

Full `vitest run` under node v25.9.0, 2026-08-31, `SCRIPTC_TEST_WORKERS=3`,
`SCRIPTC_CC=zigcc`, `SCRIPTC_TARGET=x86_64-windows-gnu`, 2,649 s wall:

    Test Files  4 failed | 142 passed | 7 skipped (153)
         Tests  10 failed | 5741 passed | 54 skipped (5805)

Eight are the brief's named base set -- `1360-spawn-sync`,
`1482-spawnsync-error` and `1537-os-release-spawnsync-stdio` on both lanes
(the Windows-host `/bin/echo` limitation) and `2390-dot-requires` on both
(the real defect). **The other two are the size floors, and they are also a
base condition.** A/B in this worktree, same toolchain, same run:

| program | base `974b5f3b` | this branch | recorded |
| --- | --- | --- | --- |
| static hello-world | 637,440 | 637,440 | 653,312 (−15,872) |
| regex | 778,240 | 778,240 | 795,648 (−17,408) |

Not one byte moved. Both checks are RED on base, each ~4 drift pages BELOW
its recorded figure -- a shrink, not a growth, and one this block did not
cause and cannot explain. The anchors were deliberately not touched: the
message beside them says to find what the bytes bought and write it down,
and that is a separate unit of work with the shrink's actual author.

## The two counts, each with its flag

Measured on this block's own new refusal, and on the type-level one beside
it, through the CLI at `packages/cli/dist/main.js`:

| subject | no `--best-effort` | `--best-effort` |
| --- | --- | --- |
| `Array.from` dyn mapper (SC1090, per-statement) | **2 sites**, build fails | **0 sites**, build SUCCEEDS -- and the emitted TU carries **2 `[SC1090 at …]` tags**; the binary throws at the first and exits 1 |
| `URL[]` element (SC2009, type-level) | 3 errors (SC2009 x2, SC2020) | **1 error -- still refuses** |

The first row is the warning in one program: a zero site count under
`--best-effort` is not zero refusals. The second is the other half: a
type-level refusal is not deferrable at all, so its `[SCxxxx]` count is
*absent*, not zero.
