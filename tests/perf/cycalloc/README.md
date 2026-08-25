# `tests/perf/cycalloc/`

Two instruments, and one measurement rule that cost a whole afternoon to
find.

## `isa.mjs` — where a function's instructions go

`ab-callgrind.mjs` prices a function. This one prices its INSTRUCTIONS: it
runs callgrind with `--dump-instr=yes`, joins the per-address costs against
`objdump -d` of the same binary, and prints every machine instruction with
the exact number of times it executed, bucketed into frame / call / body.

    node tests/perf/cycalloc/isa.mjs --exe <elf> --fn scr_cyc_alloc \
         --scenario 'closure-churn' --out <dir>
    node tests/perf/cycalloc/isa.mjs ... --selftest

`--selftest` runs one binary twice and requires every per-instruction count
to be identical. Four health checks print on every run; read the header for
what each is for. The one worth repeating here: a parser that misdecodes
callgrind's subposition compression does not error, it scatters cost onto
addresses that do not exist AND STILL ADDS UP, so the join reports
NEVER-EXECUTED and UNKNOWN-ADDR counts rather than a total.

## `surface.mjs` — the object surface, byte-exact against Node

Twelve programs over `Object.keys`/`entries`/`values`, `JSON.stringify`,
spread, `for...in`, `Object.assign`, `structuredClone`, `util.inspect`,
`deepStrictEqual`, `delete`-and-re-add, integer-like key order, a real
reference cycle, and object sizes on both sides of `SCR_POOL_MAX` — run
under Node v25.9.0 and under the compiled binary on the c and llvm
backends, for two compiler trees, with the verdict as a TRANSITION table.

    node tests/perf/cycalloc/surface.mjs --a <treeA> --b <treeB> --out <dir>
    node tests/perf/cycalloc/surface.mjs --a <tree> --selftest --out <dir>

Two negative controls, because a scorer that only prints MATCH passes an
A/A perfectly: a canary scored against output no implementation produces
(must read WRONG) and a program scriptc refuses (must read TRAP).

---

## THE LAYOUT FLOOR, and why an A/A floor is not enough

`ab-cpu.mjs` teaches that a Windows claim needs an A/A floor measured in
the same session. That is necessary and it is NOT sufficient, and this
directory exists partly to write down why.

An A/A floor runs ONE binary in both slots. It measures scheduling, thermal
and load noise. **It cannot see the term that appears the moment the two
arms are DIFFERENT binaries: code layout.** `scr_runtime.h` is included by
every translation unit, so changing one inline in it moves every inlined
copy of it, shifts everything after it in the image, and re-rolls every
alignment, I-cache set and branch-predictor tag in the program.

Measured on 2026-08-25, `block/cycalloc`, base against branch, 25-40 paired
ABBA reps per row, floors taken in the same session:

| scenario | Linux lane, EXACT Ir | Windows cycles | that row's A/A floor |
| --- | ---: | ---: | ---: |
| closure-churn (**touched**) | −9.621645% | **+3.897%** | 0.072% |
| RECV group, messaging (**touched**) | −1.105875% | **−4.137%** | 0.384% |
| closure-call-hoisted (untouched) | −0.001431% | **−6.097%** | 0.407% |
| record-field (untouched) | −0.001534% | **−7.077%** | 0.355% |
| array-churn (untouched) | −0.000784% | −2.067% | 0.486% |
| numeric-add (untouched) | −0.001856% | −0.333% | 0.101% |

The bottom four scenarios enter the changed code 11 to 31 times each and
their instruction counts move by less than two thousandths of a percent.
**They move on the clock by up to 7.08%, in the opposite direction from the
scenario that was actually changed, at ten to a hundred times their own
A/A floor.** That is not the change. That is where the code landed.

**So the control an A/B on this host needs is a second A/B, on a scenario
the change provably does not touch.** The A/A floor bounds the noise of
running the same binary twice; the untouched-scenario A/B bounds the noise
of running two different binaries. On this pair they were 0.07–0.49% and
2.07–7.08% respectively — two orders of magnitude apart.

An effect smaller than the layout term is not adjudicable on this lane by
any number of reps, because reps do not average layout away: it is a fixed
property of the pair of binaries being compared. The exact lane
(`ab-callgrind.mjs`) has no such term, which is what makes it worth the
cross-build.
