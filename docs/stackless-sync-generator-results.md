# The synchronous-generator slice: what the first builds measured

Companion to `stackless-sync-generator-slice.md`, which registered the
predictions (section 6) and the correction to them (section 6.1)
**before** any of this ran. This file is the other side of that paper:
what the runs actually said.

A separate file on purpose. Sections 6 and 6.1 record what was believed
beforehand, and editing predictions in place is how a prediction quietly
becomes a description.

## 0. The headline is not the green

Four runs. The one that mattered is the **first**, which was green on nine
arms and measured nothing.

| run | lane | result |
|---|---|---|
| 1 | LLVM (unpinned) | 11 of 12 red -- `conversions=0` |
| 2 | C | 10 red -- `conversions=2`, and the als arm exit 99 |
| 3 | C | 7 of 7 files green, `conversions=1` |
| 4 | C | green again, with section 6's last unasserted condition asserted |

## 0.1 Ten defects, and where they came from

The slice has produced **ten** defects. Three were found while writing it.
**The last five came from directed audits -- enumerating what a sibling
maintains and checking it line by line -- and not one of them from anything
failing.** The sixth-to-last came from a test, on the first run where that
test could see the lane at all.

That ratio is the strongest argument this slice makes for the method, and it
is an argument against the instinct it replaced. Every one of those five was
present while the slice was "complete as written", every gate was green, and
nothing was going to fail that would have pointed at them: a stranded
AsyncLocalStorage context, a negative object count, a census that could not
see a generator frame, a sentinel written over a cell that might hold a
payload, an enum member silently doing nothing. Four of the five are
invisible outside an audit build; the fifth cannot fire until a fence in
another file moves.

The cost of the method is an hour of reading. The cost of the alternative is
that those five ship.

## 1. Section 6's predictions, scored

**`EXPECTED_CONVERSIONS = 1`: CONFIRMED on the artefact.** One generator, one
resume function, `0` on every knob-absent build. It took two wrong readings
of the number to get there, and neither was in the emission.

**Section 6's triage for a `0` was wrong.** It said: *look at `stacklessPlan`'s
`syncGenerator` path, not at the lowering.* It was neither. `build()` never
pinned a backend, the CLI default is LLVM, and `index.ts` gates the stackless
lane on `backend === "c"` -- so both lanes compiled through LLVM and the two
builds under comparison were **the same build**. Section 6 did not
consider that the instrument might not be running the lane under test.

**Section 6's triage for a count above `1` was also wrong**, in the same
direction.
It said *I misread what one program emits*; the misreading was in the
counter, which matched the forward declaration as well as the definition:

    static void sc_cr_nums(ScrCoroBase *sc_b);
    static void sc_cr_nums(ScrCoroBase *sc_b) {

`coro-symbol-collect.ts` had already hit this and requires the brace, saying
why in its own comment. The parity guard was written without having read it.

**The generalisation both corrections share:** a reading that goes wrong
about a measurement is more often wrong about the *instrument* than about
the subject, and section 6's triage list pointed at the subject both times.

**Compile errors: predicted, and none appeared.** `tsc` was clean on the
first attempt and every attempt after. The C lane compiled the emitted
generator TU and the new runtime entry points without a diagnostic. The
prediction was reasonable and simply did not happen.

**The poison control: predicted to pass and to be least trustworthy if it
did -- correct, and it stayed untrustworthy longer than section 6
realised.** Section 6 required the conversion count to be non-zero *in the
same run* before the control's green meant anything. Nothing asserted that
until run 4. The control now asserts `conversions = 1` on the poisoned
build itself.

## 2. What the builds found that reading had not

Three defects, none visible without running:

**The instrument measured the wrong lane** (section 1 above). Two independent
instruments said so: the conversion counter, and the poison hook refusing
with *"injected ZERO sites"* because it lives in the C emitter. One fact,
two directions.

**`scr_gen_of_coro` never noted its allocation.** `scr_gen_new` calls
`scr_obj_alloc_note()`; `scr_gen_release` calls `scr_obj_free_note()` for
both backings; the frame lane's constructor called neither. Every converted
generator decremented a counter it had never incremented -- `-1 object(s)`,
a negative count, which is not a shape anyone searches for.

**`scr_gen_coro_alloc` never noted its frame.** Found by the directed audit
section 3 describes. The abandoned-coroutine line could not see a generator
frame at all, so the one lane of three that abandons in silence was also the one
whose comment claimed to be measured.

## 3. The site that inherits nothing

Three omissions at one constructor pair, found one at a time:

| omission | sibling it should have copied | found by |
|---|---|---|
| ALS context never released | `scr_coro_release` | reading, consumer audit |
| object allocation never noted | `scr_gen_new` | the als arm, first real run |
| frame never noted | `scr_coro_alloc` | directed audit after the other two |

Two omissions at one site is not a coincidence; it is a site that inherits
nothing from its siblings because it was written *beside* them rather than
*from* them. The third was found by enumerating every invariant the siblings
maintain and checking them one at a time, instead of waiting for a test to
trip over it. **That enumeration is the cheapest thing in this document and
it found the only defect nobody was looking for.**

## 4. Proof in both directions

Two defects fail in silence -- a stranded ALS context has no stdout, and an
unpromoted `.return` value is a plausible number. For those, *"the arm would
have caught it"* is a claim about an instrument nobody has seen move. So each
was watched failing:

| revert | reverted | restored |
|---|---|---|
| the GENRET promotion | RED | GREEN |
| the ALS release | RED | GREEN |

The ALS red names its own cause: `1 dyn value(s) live at exit`, and the site
table says `1 str` -- the string the arm puts in the context. Detected *and*
attributed.

**The predicted failure MODE was wrong and the arm caught it anyway.** The
GENRET revert was declared as *"no crash, `r.value` is WRONG"*. What happened
was `exit=1`, the unpromoted sentinel reaching the uncaught printer, and the
program dying after the first yield. Right about the colour, wrong about the
mechanism.

## 5. The instrument inside its own subject

Three times in one session, and it is the recurring shape of this front:

- the build cache answered a CLI probe with its own earlier artefact, and
  nearly bought a false conclusion about the knob;
- the conversion counter reported `0` both for *nothing converted* and for
  *there is no C here to read*, and the two are different facts;
- the gate's own provisioning line prints `compiler-dist=ok` for a
  three-day-old `dist`, because it checks presence where freshness is owed.

- the dist-provenance guard compared a formatted timestamp against a field
  that `ConvertFrom-Json` had already re-parsed into a `DateTime`, so a
  DateTime met a String and it reported UNKNOWN on a dist that had not moved
  at all -- a guard firing on its own subject being unchanged;
- and the assertion guarding that fix was over-broad, flagging the
  normaliser's own legitimate use of the field it was policing. It refused
  before writing, so the file was never touched.

In each case the instrument's answer was about the instrument. The defence
that worked every time was the same: **make a zero say which zero it is**,
and make the check name which branch it took.

The last two were caught by RUNNING the rig, not by reading it, which is the
same lesson as run 1 arriving at a smaller scale.

And a fifth, while writing this very section: a shell heredoc ate one
backslash, Python read the surviving two-character escape as a control
character, and a **0x08 byte landed in this document**. The encoding check
passed, because 0x08 is ASCII and that edit had been checked for encoding
and not for control bytes. The standing rule says to sweep control bytes,
non-ascii and the line-ending delta *every time, not by intuition about
which files are dangerous* -- and the intuition is precisely what skipped
it. Then the guard caught the same trap a second time, in the sentence
written to describe it.

The fix was not better escaping. The path was rewritten to contain no
backslash at all: **remove the surface, do not get it right once.**

## 6. Still owed, named rather than omitted

- The six-shard merge gate HAS now run; section 7 has the result. It is
  RED, on one defect of the slice's own and one infrastructure fault that
  says nothing about it.
- **`dist` in this worktree is now rebuilt and stamped.** `tsc` clean in
  60.4s, 120 files, and the worktree dirty count was 0 before and 0 after --
  `dist/` is gitignored (`.gitignore:16`, 0 files tracked), checked before
  building rather than discovered after.
- **The dist preflight is now proven in both directions**, which is the
  thing that was previously claimed only in one:

  | probe | before the rebuild | after |
  |---|---|---|
  | `syncGenerator` in `ir/liveness.js` | absent | present |
  | `emitGenCoroSpawn` in `emit-gen-coro.js` | no file | present |
  | `genCoroUnwind` in `emit-gen-coro.js` | no file | present |
  | `mangleCoroField` in `backend/mangle.js` | absent | present |
  | `poisonYieldArm` in `gen-poison.js` | no file | present |
  | **verdict** | **REFUSE (5 of 5)** | **PASS (0 of 5)** |

  The provenance check behind it was exercised on all three of its branches
  -- CURRENT on the real tree, STALE against a drifted source hash, UNKNOWN
  against a moved dist -- so no branch of it is untested.
- The gate log now carries what `PROVISION compiler-dist=ok` never did:

      PREFLIGHT dist-provenance=CURRENT
        srcTree=be5cfc0569edcd8ea8b1cd500383eef111009401
        commit=02ee5b42aaa26284078e4625ecc608e90c627ed3
        builtAt=2026-10-07T00:22:55.9341547Z files=120 node=v22.18.0

  The identity is the **source tree object**, not a commit and not an mtime:
  a commit moves for reasons that never touch the compiler, and an mtime is
  an LRU bump.
- `main`'s `dist` is still from 2026-10-03 and still predates the entire
  stackless front. That one is a process question -- who rebuilds, when,
  with what guarantee -- and is not this slice's to answer.
- The `gate-sharded.ps1` change that turns its `Test-Path` into a content
  check is **written and not applied** -- `gate-dist-freshness.READY.py`
  under the blocks root --
  because another block is executing a copy of that script right now and
  editing a running script has already corrupted one run on this front. Its
  anchor was dry-checked against the live file: 1 occurrence, file untouched.
- `generator-delegation-divergence.test.ts` is pinned to LLVM and says in
  its own header that it cannot see this lowering and will stay green
  regardless.

## 7. The first gate, and the eleventh finding

Six shards, 44.84 minutes, `green=3 red=3`, `verdict=RED`. Partition
complete: `expected=221 ran=221 missing=0 extra=0 dupes=0`. The tree hash at
the end equalled the baseline, so nothing moved under the run.

### Three reds, two causes, and only one of them is the slice

| shard | verdict | tests |
|---|---|---|
| 1 | RED | 1 failed, 982 passed, 1 skipped (984) |
| 2 | GREEN | 1717 passed, 2 skipped (1719) |
| 3 | RED | 733 passed, 10 skipped (743) -- **zero failed** |
| 4 | GREEN | 1752 passed, 2 skipped (1754) |
| 5 | RED | 1 failed, 763 passed, 36 skipped (800) |
| 6 | GREEN | 732 passed, 4 skipped (736) |

**Shard 3 says nothing about the slice.** Its `Why` is
`vitest reported errors: Errors 1 error`, and the error is

    Error: [vitest-worker]: Timeout calling "onTaskUpdate"

with **0 failed assertions out of 743**. Sixth occurrence of the signature
on this front, and the first on a different tree and branch -- pinned to
shard 3 both times, which a merely random timing fault would not be. Not
relaunched: the signature is not in the relaunch rule.

**Shards 1 and 5 are one defect seen twice.** `island.test.ts` and
`regex.test.ts` each build the same hello-world and each compare its `.text`
to the same recorded figure; both reported `.text GREW`. Two independent
detectors agreeing is a consistency check, not two problems.

### The breach is SHARED, and the anchor was not stale

With the knob absent the slice is supposed to be invisible. It was not: the
frame-lane branches in `scr_async.c` are emitted into every binary, because
only the CALL was guarded and never the branch test. Measured on main in the
recorded lane:

| program | main | recorded | delta |
|---|---|---|---|
| hello-world | 543,702 | 543,702 | **0, exact** |
| regex | 630,182 | 630,150 | +32, pre-existing |

So the failing anchor is exact on main and the branch owns all of that
growth. The regex figure carries 32 bytes of older drift that passes on
tolerance -- which is why the post-fix target there is main's 630,182 and
not the recorded 630,150. Repairing someone else's 32 bytes under cover of
this fix would be the same confusion as hiding my own residue inside the
tolerance, pointed the other way.

Two commits produced it, and naming both matters because neither alone is
the story:

- `8888b8842`, before my turn, added the `backing` branches in
  `scr_gen_release`, `scr_gen_resume_return` and `scr_gen_resume_throw`;
- `da841c0ed`, mine, added `scr_gen_coro_frame_free` on top.

**main is clean.** `8888b8842` is not an ancestor of main, so the shipping
criterion is not broken in production; the breach is confined to this
branch.

### Finding eleven arrived unasked

The ten in section 0.1 were found by reading or by a test written to look
for them. This one fired on its own, from a detector nobody consulted: a
size anchor whose only job is to notice bytes. It also caught a wrong fix
on the way. The first reading of the file counted three unguarded sites and
judged the rest handled -- but three of them had the guard INSIDE the `if`,
protecting the call while the branch test still emitted. A fix on that
reading would have returned `.text` to NEAR the baseline and the 256-byte
tolerance would have absorbed the rest: **the test that prompted the fix
would have passed it.** Seven sites, and none of them guarded the branch.

A third anchor is still unmeasured. `regex.test.ts` checks the regex
program's own figure AFTER the one that failed, and vitest stops a test at
its first failed expect -- so it has never been evaluated. A fix verified
only against the hello-world could leave it broken and read as green.

### The MACHINE column, raw

One line per shard, in shard order, against the reference run's column on a
different tree. No interpretation is offered here beyond the one the pair
already forces.

| shard | this run minFreeRamMB | reference minFreeRamMB |
|---|---|---|
| 1 | 2690 | 469 |
| 2 | 4077 | 1964 |
| 3 | 3657 | 2323 |
| 4 | 2913 | 2414 |
| 5 | 3503 | 3343 |
| 6 | 4017 | 3504 |

This run, in full: shard 1 `pct=6.6 cpu=100 disk%=125 MBps=77 n=54`; 2
`pct=10 cpu=100 disk%=1257 MBps=98 n=56`; 3 `pct=9 cpu=100 disk%=129
MBps=50 n=55`; 4 `pct=7.1 cpu=100 disk%=194 MBps=55 n=45`; 5 `pct=8.6
cpu=100 disk%=105 MBps=78 n=18`; 6 `pct=9.8 cpu=100 disk%=423 MBps=117
n=17`. Total RAM 40,831 MB, zero sampler failures.

**The reference column rises monotonically and this one does not.** That is
the whole result of the pair so far: monotonicity is not a property of the
machine, so the column indexes something about a particular run rather than
the shard identity, and a single run of it separates nothing. Two runs is
the smallest number that could have shown this, and it took the second one
being on a different tree.
