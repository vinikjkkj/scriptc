# The slot carry, and what liveness took off it

Companion to `stackless-llvm-port.md`. One question: with `SCRIPTC_STACKLESS=1`
the LLVM lane's artifact was **5.8x to 6.9x** the knob-absent one, and the
largest single term in that was the slot carry. This records what the term
actually was, what narrowing it bought, and what is left.

**Every number names its lane, its arms and its subject.** Subject throughout:
the program in `tests/harness/stackless-values.test.ts` (26,246 bytes of
TypeScript, 79 wrappers plus `main`), built by that file's own `buildArm`.
Lane: **LLVM**. Arms: **knob ON against knob OFF**. Base commit:
**`3ef911616`**. Host: zig 0.16.0 from `G:\tools\zig`, node v22.18.0,
`SCRIPTC_TARGET=x86_64-windows-gnu`, `SCRIPTC_CC=zigcc`. Both arms of every
leg were written to the **same output directory**, because the `.ll` carries
its own output path in its header and two legs in different directories differ
by construction.

## 0. The re-derivation, and the one number that did not reproduce

The brief that opened this work carried four figures for the base. Re-derived
at `3ef911616`:

| column | briefed | re-derived at `3ef911616` | |
|---|---:|---:|---|
| `prog.ll`, knob ON | 4,247,018 | **4,252,082** | +0.12% |
| `prog.ll`, knob OFF | 733,925 | **617,698** | **−15.8%** |
| `sc_cr_main` lines | 55,677 | **55,677** | exact |
| `%cxslot_` in `sc_cr_main` | 43,632 | **43,632** | exact |

Two reproduce exactly, one to within a commit's drift, and **the knob-OFF
`.ll` does not reproduce at all**. The consequence is not cosmetic: the
multiple the knob costs is `4,252,082 / 617,698` = **6.88x**, not the 5.8x the
briefed pair gives. The knob-OFF artifact cannot shrink by a change to the
stackless lowering (it contains none of it) and the test program only ever
gains wrappers, so 733,925 cannot be an earlier reading of this column on this
program. It was not reproduced here and is **withdrawn rather than explained**;
`SCRIPTC_SAN=1` was tested as a candidate and refuted (it leaves the `.ll`
byte count identical and fails at link on this host).

## 1. What the term actually was

In `sc_cr_main` at the base: **54 carried slots** across **101 drawn states**,
and the carry was emitted for every slot at every state.

| | bytes | share |
|---|---:|---|
| `prog.ll`, knob ON | 4,252,082 | |
| of which `sc_cr_main` | 3,855,509 | 90.7% of the module |
| of which `%cxslot_` lines | 2,771,188 | **65.2% of the module**, 71.9% of `sc_cr_main` |

All 54 are promoted cross-park temps (`%cxa_tN`). The carried SET was right --
each of them is read after SOME park -- and the QUANTIFIER was what was wrong.

## 2. What liveness is, and the one thing it is not

`backend/llvm/slot-liveness.ts` asks, per slot and per resume label, whether
the slot is READ before it is WRITTEN on any path out of that label, over the
emitted CFG, to a fixpoint -- so a back edge is an edge like any other. The
emitter renders the body once with the full carry, reads it, and renders it
again with the carry narrowed; the two renderings must be identical once every
carry line is struck from both, or the build fails.

**It is not a per-park decision, and the first version that treated it as one
was caught by the cross-park slot oracle.** The spill is
`%cxslot_svK_s = load T, ptr %s`: a genuine read of the slot, in the park's own
block. Striking every `%cxslot_` line from the scan -- right for the reload,
wrong for the spill -- made a slot read after park 23 look dead at parks 0..22,
and park 23's spill then saved whatever the entry block had re-initialised.
`tests/harness/cross-park-slot-oracle.ts` named sixteen of them in
`sc_cr_main`, at the spill's own line. It was right to fire. So `carry(k)` is a
fixpoint: the spill at state k counts as a read exactly when the carry at state
k is emitted.

## 3. What it bought

Same commit, same output directory, both legs re-run and byte-reproducible.

| column | base | with liveness | |
|---|---:|---:|---|
| `prog.ll` bytes (knob ON) | 4,252,082 | **1,551,195** | **−63.5%** |
| `prog.exe` bytes (knob ON) | 968,192 | **870,400** | **−10.1%** |
| `sc_cr_main` lines | 55,677 | **23,811** | −57.2% |
| `%cxslot_` in `sc_cr_main` | 43,632 | **1,144** | **−97.4%** |
| carry pairs, whole module | 5,486 | **169** | 3.08% kept |
| artifact / knob-OFF artifact | 6.88x | **2.51x** | |

Per function, which is where the shape of the answer is:

| function | slots | states | pairs base | pairs after | kept |
|---|---:|---:|---:|---:|---:|
| `sc_cr_main` | 54 | 101 | 5,454 | 143 | 2.6% |
| `sc_cr_wfy7` | 3 | 2 | 6 | 3 | 50.0% |
| `sc_cr_pu`, `sc_cr_wau`, `sc_cr_was` | 2 | 2 | 4 each | 3 each | 75.0% |
| `sc_cr_wfo1..5`, `sc_cr_wlfo`, `sc_cr_wfo3` | 2-4 | 1 | 2-4 | 2-4 | **100%** |

The `forOf` rows keeping **100%** are the result reading right rather than
reading green: the loop state is live across the back edge and not one carry
is dropped there.

**Compile time: no difference resolvable at this granularity.** Two legs of the
four-arm build with every arm directory deleted and `SCRIPTC_NO_CACHE=1`:
14.2s base, 15.7s narrowed, against a 40.3s first base leg whose zig cache
state differed. The 40.3s reading is n=1 against a different cache state and
supports nothing.

## 4. The controls, and that each could have come out red

- **Knob-absent identity.** `llvm-off.ll`, `llvm-off.exe`, `c-off.c`,
  `c-off.exe`, `c-on.c` and `c-on.exe` are **sha256-identical** between base
  and narrowed. Only the knob-ON LLVM arm moved.
- **ARMED.** An 8-byte literal planted on the single source site that emits a
  non-coro function define. Multiplicity derived from the artifacts before the
  run (`^define internal .*@sc_f_`: 116 in the OFF arm, 35 in the ON arm), so
  the predictions were `617,698 + 8*116 = 618,626` and
  `1,551,195 + 8*35 = 1,551,475`. **Both landed exactly.** `llvm-off.exe`
  changed its sha under the plant while keeping its size, so the exe column is
  not vacuous either -- and the prediction that it would NOT change was wrong,
  which is recorded because it was wrong: a content-derived PDB signature
  reaches the binary.
- **Determinism.** Base re-run byte-identical to base; narrowed re-run
  byte-identical to narrowed.
- **The oracle's population.** 81 suspending functions and 278 allocas
  examined, in BOTH legs, with 0 findings and 0 SSA control violations. The
  population is unchanged, so the green is not a smaller question.
- **Coverage, two derivations.** The ledger in the harness source
  (`LLVM_FLOOR` 79 + `LLVM_FLOOR_NON_WRAPPERS` 2 = 81) and
  `define ... @sc_cr_*` counted in the artifact (81) agree, on both legs, with
  0 missing and 0 extra. `NOT_LOWERED_BY_REASON` and
  `LLVM_NOT_LOWERED_NON_WRAPPERS` are both empty.
- **The analysis itself, both directions.**
  `tests/harness/slot-carry-liveness.test.ts` drives it on hand-written CFGs
  with no compiler and no toolchain. Every case asserts what is DROPPED as
  well as what is KEPT, because an analysis that answered "carry everything"
  would pass the oracle for ever and buy nothing. The back-edge case and the
  chain case each ship with their own negative twin, differing by one edge and
  by one store respectively.

## 5. Not measured, and the ceiling

- **Any program but this one.** `app182` was not built; the brief forbade the
  full differential corpus without notice. The share this removes is a
  property of the slot-to-state product, so a body with few states will see
  little and `sc_cr_main`'s 2.6% is not a rate to carry anywhere.
- **Peak working set.** This is an artifact-size result. The frame LAYOUT is
  unchanged by design -- `slotFields` keeps every index -- so no frame got
  smaller and no runtime memory claim follows from any of it.
- **THE CEILING IS NOW SOMEWHERE ELSE.** With the carry at 169 pairs, the
  remaining 1,551,195 bytes are 2.51x the knob-OFF artifact, and 1,157,336 of
  them are still `sc_cr_main`. The next term is not the slot carry.
