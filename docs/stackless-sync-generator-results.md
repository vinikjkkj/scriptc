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

with **0 failed assertions out of 743**. Not relaunched: the signature is
not in the relaunch rule.

**A CORRECTION TO WHAT THIS RUN ADDS.** I first wrote that this was the
sixth occurrence and the first "on a different tree and branch", implying
the shard-3 content differed and the signature followed the position. That
overstates it. vitest partitions by SHA-1 of the relative path and
`ceil(220/6) = ceil(221/6) = 37`, so shard 3's window is `[74,111)` in BOTH
runs and only the contents slide: **J = 0.9474** against the reference
run's shard 3, with J = 1.0000 on shards 1 and 2 and the single displaced
file landing in shard 4 here. So this is the same signature over a set
**94.7% identical** -- consistent with everything, and NOT the
content-independence my phrasing suggested. "Different tree" buys almost
nothing here, and quoting the occurrence without the J overstates it.

What DOES separate the causes is another block's experiment, and it is the
first positive structure this front has on the signature rather than a
refutation: shard 3's 37 files invoked BY THE GATE with no preceding shard
go red 2 of 2 in about 2.2 minutes; shard 5's 37 under the same conditions
go green 2 of 2; and shard 3's same 37 by plain invocation outside the gate
go green 2 of 2. **Neither the content nor the invocation is sufficient
alone; both are necessary.**

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

### KNOWN DRIFT, UNATTRIBUTED: the regex program is +32 and stays that way

Recorded here because a tolerated delta that nobody writes down is exactly
how a tolerance becomes a hiding place. Measured 2026-10-06 on main, in the
recorded lane: the regex program's `.text` is **630,182** against the
recorded **630,150** -- **+32 bytes**, passing only because 32 is under the
256-byte tolerance. **Nobody has attributed it.**

**The recorded figure is deliberately NOT being updated to 630,182.**
Re-recording would erase the drift and make 630,150 unverifiable forever.
The baseline stays; the +32 stays visible here. The next person to touch
this either explains it or at least does not add their own on top of an
undocumented one and keep passing.

WHY ONE PROGRAM AND NOT THE OTHER, since both compile the same runtime --
a short answer, and the evidence rules more out than it rules in. They do
NOT compile the same runtime: the regex program additionally links
`scr_regex.c`, libregexp and libunicode, and **none of those changed** in
the window. Of the shared runtime, only `scr_async.c` moved on main since
the recording commit (+102 lines) -- and the hello-world, which links it,
is EXACTLY on its recorded figure, so those 102 lines cost zero `.text` and
cannot be the source of the regex delta either.

That leaves the compiler side, which did move on main in the same window
(`cc.ts`, `emit-exprs.ts`, `emit-stmts.ts`, `emitter.ts`, `mangle.ts`). The
regex program's source exercises far more of the emitter than a three-token
hello-world -- a regex literal, a unicode property escape, `replace`,
`test` -- so a lowering change can move it while leaving the hello-world
byte-identical. **That is a plausible mechanism, not a measured one.** It
is also uncomfortable, because several of those files belong to this very
front: if a knob-absent lowering change moved the regex program by 32
bytes, that is the same shipping-criterion breach in miniature, already on
main. The test is a bisect of the regex program's `.text` across
`e03bdf0aa..main`, and it has not been run.

Two commits produced it, and naming both matters because neither alone is
the story:

- `8888b8842`, before my turn, added the `backing` branches in
  `scr_gen_release`, `scr_gen_resume_return` and `scr_gen_resume_throw`;
- `da841c0ed`, mine, added `scr_gen_coro_frame_free` on top.

**main is clean.** `8888b8842` is not an ancestor of main, so the shipping
criterion is not broken in production; the breach is confined to this
branch.

### D1 WAS GUARDED CORRECTLY, WHICH MAKES THIS A REGRESSION

The elimination above carries a second result, and it is the severe
reading. `scr_async.c` gained **+102 lines on main** since the recording
commit, it is linked into every binary, and the hello-world is **exactly**
on its recorded figure. Those 102 lines cost **zero** `.text`.

That is direct proof that the D1 slice guarded its additions properly. So
the seven unguarded sites in this slice are not a new hazard nobody had
met and not a standard nobody had set -- they are a **regression against
this front's own immediate predecessor**, which had already met it. The
pattern was there to copy and was not copied.

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

### REGISTERED BEFORE IT RUNS: the bisect of the +32

Last item of the window, after the fix, the verification, the parity run
and the gate are committed. The slice is the deliverable; this is a
different question. It is cheap -- `textanchor.mts` already takes any tree
-- and it answers the only non-negotiable rule on this front: whether the
shipping criterion is **already violated on main**.

**The target is the NUMBER, not the verdict.** The regex program's `.text`
is recorded at every step across `e03bdf0aa..main`, not "moved / did not
move". A 32-byte step can be two steps of 16, and then the answer is two
causes and not one.

**The lane is pinned at every step**: `x86_64-windows-gnu`, `SCRIPTC_CC=zigcc`,
zig **0.16.0** with `G:/tools/zig` ahead of chocolatey's 0.15.2 on PATH.
The two differ by about 20 KB, so one step run on the wrong zig invents a
step three orders of magnitude too large and would be believed.

**The rig is controlled before any step is trusted.** A bisect worktree
needs `node_modules`, and a shared or linked one is how a measurement ends
up compiling the WRONG tree: pnpm's workspace links are absolute, so
`@scriptc/compiler` can resolve back into the donor tree while the
checkout being measured sits unused. `textanchor.mts` sidesteps that by
importing the compiler through an explicit file path, but the transitive
resolution of the runtime sources is not proven to. So the first
measurement is the bisect worktree **at main's tip**, which must reproduce
630,182 exactly. If it does not, the rig is wrong and no step from it
means anything.

**What would surprise me, declared now:**

- **The step lands on a commit of THIS front.** Then a knob-absent
  lowering change moved an emitted program, the same shipping-criterion
  breach in miniature is already on main, and it stops being a
  documentation item and becomes the user's decision.
- **The step lands outside this front.** Unsurprising: someone else's
  debt, and it needs only to stay written down.
- **There is no single step.** Then the +32 accumulated, which means the
  tolerance has been absorbing small changes for a while and the
  interesting number is how many, not which.
- **The number does not reproduce at main's tip.** Then the rig is the
  finding and the bisect is void until it is fixed.

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
## 12. Three tools that could not fail, and two numbers that were wrong

The fix for section 11 was written, queued, and not applied. Auditing the
queued tooling before firing it found three defects in it, all of the same
family -- **green by construction** -- plus two wrong figures that had been
repeated into briefings. None of this came from something failing.

### 12.1 The patcher's completeness check was blind where it mattered most

`p16` wraps the seven frame-lane sites and then asserts that no
`SCR_GEN_BACKED_FRAME` branch remains outside `#ifdef SCR_CORO_LANE`. Its
tracker decremented its nesting depth only on an `#endif` whose **text**
named the lane. `scr_async.c` has bare `#endif`s -- the first at line 5478
-- so the depth never returned to zero and every line after it read as
guarded. **Five of the seven sites are after that line.**

Run against the **unpatched** file, where the correct count of exposed
lines is **11**, it reported **3**, and one of those three was a comment.
It could not have caught the partial fix it was written to catch.

Compounding it: `--dry` returned **before** that assert. So "9 of 9 anchors
dry-checked" was true and told you nothing about the check that blocks.

### 12.2 The permanent test went red on a correct fix

`p17` adds the cause as a permanent test beside the size anchor that
detected it. Its tracker is a real preprocessor nesting tracker and is
correct. But it tested the **raw line** for the marker, and
`scr_async.c:4714` is

```c
  ScrCoroBase *frame; /* non-NULL iff backing == SCR_GEN_BACKED_FRAME */
```

-- a field of `struct ScrGen` that must stay **unconditional**, so both
builds share one struct layout. It is the same argument the test already
made for exempting the enum, and the field costs zero `.text`. Only its
trailing comment names the marker.

So after a **perfect** fix the test would still have failed, on a line that
must not change. A test that fails after the repair it demanded is a test
that gets deleted.

Its four controls all passed throughout, because all four were written from
the shapes the fix was about and all four were comment-free. **A control
set drawn only from the cases you already have in mind is a control set
that agrees with you.**

### 12.3 Two trackers, one meaning

The deeper defect is not that `p16`'s tracker was wrong; it is that there
were **two** trackers for one notion of "guarded", free to disagree -- and
they did, 3 against 12 on the same file. `p16` now calls `p17`'s.

### 12.4 What the fixes are, and the proof that they bite

Both scanners strip block and line comments before testing for the marker,
and strip **first**, which also subsumes the old whole-line-comment skip
and is strictly more sensitive than it was: a line opening with a comment
and then carrying code was previously skipped outright, marker and all.

`p16` now asserts **both directions on the real file on every run**,
`--dry` included: 11 exposed before the patch, 0 after. Asserting only the
0 is what green-by-construction looks like.

| scanner | unpatched file | patched file |
|---|---|---|
| old `lane_map` | 3 of 11 | 0 |
| blind scanner (control) | 0 | 0 |
| shared tracker, comment-stripped | **11** | **0** |

Both wrong scanners are now **refused** by the sensitivity assert, checked
by substituting each one in: the old `lane_map`, and a scanner returning
nothing for everything, are rejected on the real file before any write
happens.

`p17` gains two controls the four lacked: a marker inside a trailing
comment on an unconditional field (must be **ignored**), and real code
after a leading comment (must still be **seen**). The second was written
because the first, alone, is passed by a scanner that simply skips any line
containing a comment -- and it caught exactly that in the first draft of
this fix.

All eight -- six controls plus the real file both ways -- were run as the
**actual JavaScript** extracted from the test, not a transliteration.

### 12.5 CORRECTED: the added-line split

A split of "269 lines inside the lane `#ifdef`, 24 outside" was quoted
forward from this front. **It does not reproduce, and it never summed:**
269 + 24 is 293, and the branch adds 343 lines to `scr_async.c`. Measured
over the three-dot diff against main:

| | lines |
|---|---|
| added to `scr_async.c` | **343** |
| inside `#ifdef SCR_CORO_LANE` | **245** |
| outside | **98** |

and the 98 decompose -- which is the part that matters, because it is what
isolates the cost:

| outside the lane | lines | costs `.text`? |
|---|---|---|
| comment | 47 | no |
| blank | 4 | no |
| preprocessor | 3 | no |
| code | 44 | 3 no, 41 yes |

The three free code lines are the `ScrGenBacking` enum and the `backing`
and `frame` fields: declarations, one struct layout in both builds, no
emitted instructions. **The `.text`-bearing figure is 41 of 343**, and they
are precisely the seven sites.

### 12.6 CORRECTED: the ancestry claim, and why the conclusion survived

Section 11 states main is clean because `8888b8842` is not an ancestor of
main. **That is correct and is re-verified here** -- as is the same for
`da841c0ed`. What was wrong was a stronger claim repeated alongside it,
that main was an ancestor of this branch. It was not: the merge-base was
`597286d1d` and main carried **8** commits this branch did not.

The measurement survived, but **not for the reason given**. It survived
because none of those 8 touches `packages/compiler/src` or
`packages/runtime/src`, so the targets measured against main -- 543,702 and
630,182 -- were unmoved. A right conclusion resting on a wrong premise is
the thing this front exists to catch, and it was load-bearing here: the
gate that matters is the one on what will actually land.

Main is now merged in, so the relation holds as stated rather than by
accident.

### 12.7 The merge retired an apparatus, and exposed a live defect

main now carries the machine sampler as committed code
(`scripts/machine-sampler.ps1` plus the four calls in
`scripts/gate-sharded.ps1`). The slice's gate wrapper had been snapshotting
an **uncommitted** copy of the whole gate and proving by `Compare-Object`
that the snapshot was this branch's gate plus exactly four sampler lines.
That apparatus is deleted rather than repaired: the gate is now the
committed file, and the wrapper's dirty-worktree check already pins it.

Taking main exposed one thing the merge did not fix. The committed gate
still dot-sourced an **absolute path into the blocks root** for the
sampler, so it read a file outside the tree it judges -- one another block
edits while runs are in flight.

**No measurement derived from it, and the structure is still wrong.** The
divergence I measured -- 5,825 bytes committed against 4,625 on disk -- is
**comment only**, confirmed by the block that owns the file: 20 lines of
note added to the worktree copy on its way into the tree and never written
back to the blocks-root file. The executable content is identical, so no
run on either side read different code. That is worth stating plainly
rather than leaving the byte difference to imply a corrupted result.

What remains is the shape, and the shape is the defect: **a gate that
judges a tree cannot read a file outside it.** The content matching was
luck held in place by one block's discipline, not a property of the
arrangement -- a single edit to the blocks-root copy, by anyone, at any
time, would have changed what the gate executed without changing the tree
it reported on. The fix resolves the dot-source through `$PSScriptRoot`.

It is **this branch's only**. main is at `e7a85c7d6` and line 302 there
still reads the absolute path; the repair travels with this branch's merge
and not before it.

**The two gates are the same instrument, and a later reader must not
conclude otherwise.** The other block deliberately did **not** repoint its
own variants at `scripts/`, and it is right not to: swapping the
instrument midway up a ladder makes the new rungs incomparable to the old
ones, which is a worse loss than an ugly path. So for as long as both are
in flight, this slice's gate resolves the sampler through `$PSScriptRoot`
and that block's variants resolve it through the absolute path, and **both
load byte-identical executable code**. Different resolution, one
instrument. Runs from the two are comparable on this axis.

### 12.8 The size anchor is no longer its own target

`textanchor.mts` had 630,150 compiled into it, so it printed `NOT EXACT`
for a regex program that was exactly right -- the post-fix target is main's
**630,182**, and the 32 bytes between the two are the drift section 11
deliberately preserves. Embedding 630,182 instead would have erased that
drift from the one instrument still able to see it. Neither number belongs
in the tool; the caller now passes both, and equality is exact:

```
node textanchor.mts <repo-root> 543702 630182
```

### 12.9 CORRECTED: shard 3's attribution holds, its explanation does not

The `onTaskUpdate` timeout signature is **not about this slice**, and that
is now better supported than when it was first set aside: **eleven**
reproductions, **all** on shard 3, across more than 110 shard-runs, on
trees that do not contain this slice, every one of them with **zero failing
assertions**. Separate it in any report, and do not relaunch it -- the
relaunch rule covers `CcCompileError` with zero `error:` lines, and this is
not that.

**What collapsed is the explanation, not the attribution**, and the two
must not be swapped for one another.

It was previously described as specific to the gate's invocation, and then
as a conjunction of content and invocation, neither sufficient alone. That
rested on the plain-invocation arm reading green. It does not: the
controlling block took that arm from 0 of 2 -- which excludes nothing -- and
the **first** additional run reproduced the signature under plain,
unaltered invocation with a warm cache, `onTaskUpdate=1`, zero failing
assertions. It stopped there, as pre-registered, and did not spend the
remaining two.

So **invocation is refuted as necessary.** The conjunction claim is dead,
and must not reappear in other words.

What may survive is weaker and different: a difference in **rate**, 2 of 4
under plain invocation against 11 of 11 under the gate's, Fisher
**p = 0.057**. Suggestive, not established. It is a separate hypothesis
with its own evidence, not the conjunction redressed, and nothing in this
document should state it more strongly than that.

The standing form, verbatim, is: *known signature, eleven reproductions,
all on shard 3, cause open; invocation is not necessary, and a rate
difference stands at p = 0.057.*

This is also why the earlier 0-of-2 green arm deserved the caution it got.
Two clean draws against a defect of unknown rate is not evidence of
absence, and the run that refuted it was the third.

## 13. The fix, and the +144 that was never in the source

### 13.1 The seven sites close the breach exactly

Measured in RECORDED_LANE (`SCRIPTC_TARGET=x86_64-windows-gnu`,
`SCRIPTC_CC=zigcc`, zig 0.16.0), knob **absent**, against main's figures:

| program | main | branch, before | branch, after | target met |
|---|---|---|---|---|
| hello-world | 543,702 | 544,214 (+512) | **543,702** | exact |
| regex | 630,182 | 630,838 (+656) | **630,182** | exact |

The seven sites cost **512 bytes in both programs**. The shipping criterion
holds on both, by exact equality and not by tolerance.

The permanent test fires on the real file: reverting one of the seven --
`throw default`, put back to `#ifdef`-inside-the-`if`, the exact shape the
first reading mistook for guarded -- turns it red naming **line 5780**,
while its controls stay green. That is sensitivity on the subject, not only
on synthetic input.

Knob-on parity is unchanged by the fix: 12 of 12, including all six
lifecycle arms (`genret`, `genthrow`, `bodythrow`, `nextval`, `als`,
`collide`) and the two poison controls that prove the comparison can see a
wrong arm. `EXPECTED_CONVERSIONS = 1` is asserted on the knob-on arm, so a
green here cannot mean the wrap silently disabled the lane -- 0 would fail.

### 13.2 The +144 was a stale vendor object cache, not code

Between those two columns sat a false lead worth recording, because the
wrong conclusion was one measurement away and it would have been a
plausible one.

After the fix the hello-world was exact but the regex program read
**630,326**, +144 over main. The obvious reading -- a second breach of the
same class, in code only the regex program links -- is wrong. What killed
it was that the +144 **did not follow the source**:

| tree | regex `.text` |
|---|---|
| main, untouched | 630,182 |
| main runtime + **branch compiler** | 630,182 |
| main + each of the 5 changed runtime files, **alone** | 630,182 (5 of 5) |
| main + **all five** changed runtime files | 630,182 |
| **the branch worktree itself** | **630,326** |

Same compiler source, same runtime source, two different numbers. So it was
never in `packages/compiler/src` or `packages/runtime/src`.

A byte-level comparison of the two runtime trees found it:

```
packages/runtime/vendor/.cache/3c8f3d689539-lre-plain-zigcc-x86_64-windows-gnu/
    libregexp.o    llvm-wt 39,578 B @ 12:04     fresh 39,776 B @ 23:35
    libunicode.o   llvm-wt 70,046 B @ 12:04     fresh 70,098 B @ 23:35
```

Exactly the two libraries the regex program links and the hello-world does
not, which is why the residual appeared on one program and not the other.
The branch worktree was linking objects built eleven hours earlier under
conditions that no longer hold. Moving that directory aside and rebuilding
produced **630,182, exact**.

Three things make this worth more than its own fix:

**The cache key does not capture what built the object.** Both trees name
the directory `3c8f3d689539-lre-plain-zigcc-x86_64-windows-gnu` -- a source
hash, the variant, the driver, the target -- and the contents still differ.
Whatever changed between 12:04 and now is outside the key. On a host with
**two zigs** that differ by ~20 KB on the size class, an object cache keyed
without the compiler identity is a standing hazard, not a one-off.

**It is invisible to every check we run.** `vendor/.cache` matches
`.cache*/` in `.gitignore`, so it is untracked: `git status` is clean, the
gate's dirty-worktree guard passes, the treehash is unchanged, and a fresh
worktree simply has none. Nothing in the gate can see it.

**It lands inside the thing it measures.** A size anchor exists to detect
bytes that appear without a source change; a stale object cache produces
bytes without a source change. The instrument and the defect have the same
signature, so the anchor reports a code regression and names no file.

### 13.3 What this does to the registered +32 bisection

The bisection registered in section 11 walks `e03bdf0aa..main` for a step
that explains the regex program's **+32** against its recorded 630,150. Its
step zero -- the rig must reproduce main's 630,182 exactly -- **passes**:
measured here at 630,182 on a clean worktree.

But section 13.2 supplies a candidate the walk cannot find, because it is
not in any commit. The recorded 630,150 was taken at `e03bdf0aa` in
whatever worktree existed then, with whatever vendor objects it held. If
those differed from a freshly built set the way today's did, the +32 is a
property of the **recording environment**, not of any change between the
two commits -- and 97 commits would be walked for a step that does not
exist.

So the first step is no longer the first commit. It is to measure
`e03bdf0aa` itself, on a clean worktree with **no** vendor cache:

- it reads **630,150** -> the recorded figure is reproducible, the +32 is a
  real code step, and the walk is sound as registered;
- it reads **630,182** -> the +32 never was a code step; both commits agree
  today and the recorded figure carries a stale-cache artifact. The walk is
  cancelled and the baseline comment gets the explanation instead.

Either way it is one measurement, and it is the one that decides whether
the other ninety-seven are worth taking.

## 14. The +32 bisection, answered by its own step zero

The walk registered in section 11 was never run, because the cheaper first
step from section 13.3 settled it.

`e03bdf0aa` -- the commit the baselines were recorded at -- was checked out
into a fresh worktree with **no** `vendor/.cache`, and measured in
RECORDED_LANE with the knob absent:

| program | recorded at `e03bdf0aa` | measured at `e03bdf0aa` today | |
|---|---|---|---|
| hello-world | 543,702 | **543,702** | reproduces |
| regex | 630,150 | **630,182** | **does not reproduce, +32** |

**The recorded regex figure does not reproduce at its own commit.** The
hello-world's does, exactly -- which is what makes the result readable
rather than a broken rig: the same tree, the same lane, the same run, one
figure exact and the other 32 bytes out.

So the +32 is **not a code step**. Both ends of the window measure 630,182
today:

| tree | regex `.text` |
|---|---|
| `e03bdf0aa` (the recording commit) | 630,182 |
| `main` | 630,182 |
| this branch, after the fix | 630,182 |

There is nothing between them to find. The 97-commit walk is **cancelled**,
and not for want of evidence -- it is cancelled because the quantity it was
chartered to attribute does not exist as a difference between commits. A
step zero that kills its own bisection is a step zero doing its job; that
is the whole reason it was registered before the walk rather than after it.

### What the +32 actually is

The regex program links `libregexp` and `libunicode`; the hello-world does
not. That is exactly the asymmetry section 13.2 measured, where an
eleven-hour-old `vendor/.cache` moved the regex program by 144 bytes and
the hello-world by zero, under an unchanged cache key. The recording
session at `e03bdf0aa` will have had its own vendor objects, and the only
figure that moved is the only figure those objects can move.

This is a claim about a mechanism of the right shape and the right
selectivity, demonstrated on the same two libraries earlier today. It is
not a reconstruction of that session, which is gone. Stated at its true
strength: **the +32 is an artifact of the recording environment, of the
class demonstrated in 13.2, and is not a change in the source.**

### 14.1 The baseline is re-recorded, and why the ban on doing so fell

Section 11 declined to re-record `REGEX_CLASS_TEXT_RECORDED`, on the
grounds that re-recording "would erase the drift and make 630,150
unverifiable forever."

**That reasoning was correct, and it has expired.** It was correct because
the +32 was *unattributed*: re-recording an unexplained number buries the
only evidence that something unexplained happened, and the figure would
have been gone before anyone could ask what it meant. The ban protected an
open question.

The question is now closed, by measurement at the recording commit itself.
What lifted the ban is **the arrival of attribution, not a change in
convenience** -- and the distinction matters enough to write down, because
"we looked again and decided it was fine" is what this failure mode sounds
like from outside. Nothing became more convenient. A measurement was taken
that could have come out the other way: had `e03bdf0aa` reproduced 630,150,
the +32 would have been a real code step, the 97-commit walk would have
been necessary, and the ban would have stood untouched.

So the constant moves to **630,182**, in a commit of its own, separate from
the gate and from the slice's fix. A calibration must not move inside a
commit about something else -- that part of the earlier reasoning stands
and is honoured by the separation.

Leaving it would have cost something concrete and permanent: the anchor's
budget is 256 bytes, and 32 of them were being spent on an artifact, so the
test that exists to catch a real regression had **12.5% less room than its
own comment claimed**, for a reason nothing in the file recorded.

## 15. The two-zig trap has a third face, and it lives in a cache

The trap already recorded on this front is that two zigs are installed --
Chocolatey **0.15.2** at `C:/ProgramData/chocolatey/bin/zig.exe`, on PATH,
and the tree's **0.16.0** at `G:/tools/zig` -- and that they build the size
class about 20 KB apart. The standing defence is to pin the lane and assert
`zig version` before measuring. Every measurement in sections 13 and 14
does exactly that and the assert passed every time.

**It is not sufficient.** Pinning the compiler pins what gets compiled
*now*; it says nothing about objects already sitting in a cache. The two
vendor objects from section 13.2, under an identical cache key:

| | stale (12:04) | fresh (23:35, zig 0.16.0 asserted) |
|---|---|---|
| `libregexp.o` | 39,578 B | 39,776 B |
| producer string | **none** | `clang version 21.1.0` |
| `.debug$S` section | **absent** | present |

They are not the same build. The fresh one is zig 0.16.0's clang; the
stale one carries no producer at all, so it cannot be pinned to a version
by this evidence -- what it demonstrably is, is **a different toolchain
than the one the run asserted**, linked into a binary whose lane line said
`zig=0.16.0`.

That is the third face, and it is the worst of the three, because the first
two are visible and this one is not:

1. running the wrong zig -- caught by asserting `zig version`;
2. two trees disagreeing -- caught by naming the tree;
3. **a cache serving objects built by the other one** -- caught by
   nothing. The lane assert passes, the version is right, the log is
   honest, and the bytes are from the other compiler.

`vendor/.cache` matches `.cache*/` in `.gitignore`. It is untracked, so it
survives `git status`, the gate's dirty-worktree guard, and the treehash;
it is per-worktree, so one block's worktree can hold it for hours while
another's does not; and a fresh checkout has none, which is why the two
trees disagreed at all and the only reason this was ever seen.

**The rule this earns:** a size measurement must name the state of the
vendor object cache, and a measurement intended as a baseline must be taken
with that cache **absent**. The three worktrees used in sections 13 and 14
each started with none, which is what makes 543,702 and 630,182 reproduce
across all three. The two numbers that did not reproduce -- the branch's
630,326 and the recorded 630,150 -- are both from trees that had one.

A durable fix belongs in the cache key: it names the source hash, the
variant, the driver and the target, and it must also name the compiler
identity. That is a change to the build, outside this slice, and it is
written here rather than done here.

### 15.1 The provisional procedure, until the cache key is fixed

The durable fix is the compiler identity in the cache key. That is a build
change outside this slice and is deliberately not made here. Until it
lands, this is the rule that would have saved most of a session:

**When a size number moves and no combination of source changes reproduces
it, stop bisecting source and byte-diff the build trees -- gitignored
caches first.**

The order matters, and it is the opposite of the instinct. The instinct is
to narrow within the source: swap the compiler, swap each runtime file,
swap pairs. All of that was done here, all of it came back clean, and
every clean result was *evidence the search was in the wrong space* that
was read instead as "not that one either." Five arms reading identical is
not five exclusions; it is a signal the variable is not in the set.

The concrete steps, as run in section 13.2:

1. Reproduce the number in a **fresh worktree** of the same commit. If it
   does not reproduce, the difference is environmental and no amount of
   source bisection will find it.
2. Byte-diff the two trees whole -- including ignored files. `git status`,
   the dirty-worktree guard and the treehash are all blind to anything
   matching `.gitignore`, so the diff has to be done against the
   filesystem, not against git.
3. Suspect the files whose **selectivity matches the symptom** first. The
   residual appeared on the regex program and not the hello-world, and the
   objects that differed were exactly the two libraries only the regex
   program links. Selectivity is the cheapest discriminator available and
   it pointed straight at the cause once anyone looked.
4. Before trusting any arm of such a search, **positive-control the rig**:
   make a change that must move the number and confirm it does. Here the
   branch's unfixed `scr_async.c` moved both programs by exactly +512,
   which is the only reason the five identical arms could be believed at
   all rather than suspected of being a broken copy step.

And a standing requirement that follows from it: **a measurement intended
as a baseline must be taken with the vendor object cache absent**, and must
say so. The three worktrees in sections 13 and 14 each started with none,
which is why 543,702 and 630,182 reproduce across all three. Both numbers
that failed to reproduce -- the branch's 630,326 and the recorded 630,150
-- came from trees that had one.

## 16. Provenance of the before/after pair, and what the cache could not have caused

A fair challenge: the +512 is a paired measurement, and the vendor cache
was quarantined *between* the fix and the final figure. If the two halves
of the pair straddled a cache change, the 512 would rest on an argument
rather than on a comparison. It does not, and the evidence is in the
quarantined directory itself.

### 16.1 Both halves of the pair used byte-identical vendor objects

The directory moved aside at 23:41 contains **32 files, and not one was
written after 14:21**:

| | time |
|---|---|
| newest object in the quarantined cache | 2026-10-06 **14:21** |
| BEFORE measured, 544,214 / 630,838 | 23:29 |
| AFTER measured, 543,702 / 630,326 | 23:30 |
| cache quarantined | 23:41 |

Had either measurement written a vendor object, that object's mtime would
fall in the measurement window. None does: `find -newermt "23:00"` returns
nothing, against a positive control at `12:00` that returns all 32. So the
objects present at 23:29 are the same bytes as the objects present at
23:30, and the hello-world's 544,214 -> 543,702 and the regex program's
630,838 -> 630,326 are **direct paired comparisons under an unchanged
cache**. Both move by exactly 512. No inference is carried.

### 16.2 The hello-world figure is invariant to the cache, and that is measured

Independently of the pair, the hello-world was measured under **both**
cache states with the fix in place:

| cache state | hello-world `.text` |
|---|---|
| stale objects from 12:04 | 543,702 |
| no cache, rebuilt fresh | 543,702 |

Identical. The hello-world does not link `libregexp` or `libunicode`, and
nothing else in the cache moves it. So **no vendor-cache state can produce
a delta on the hello-world** -- this is a control, not an argument from
plausibility.

### 16.3 The 21:50 gate did not write that cache, and its two reds stand

The premise behind retracting the 21:50 attribution was that the cache had
been written during that run. It was not: nothing in the directory has an
mtime between 21:00 and 23:00. That gate **consumed** 12:04-14:21 objects;
it created none.

And both of its reds were the **regex-free** program -- shard 1's island
anchor directly, and shard 5's `regex.test.ts` failure at the `STATIC`
assertion, which precedes the `REGEX` one in that test and therefore fails
first. Both are the figure 16.2 shows is cache-invariant.

So the reds are not unattributed. They were the seven sites, by three
independent routes: a paired measurement under a constant cache, a control
showing the only candidate confounder cannot move that figure, and
intervention in both directions -- reverting one site turns the permanent
test red naming line 5780, and fixing all seven brings both programs to
exact equality.

The retraction was still the right instinct. Nobody had checked whether
the cache could produce that delta, and "it probably can't" is not a
measurement. The check took four minutes and the answer is that it cannot.

### 16.4 The lre unit is one of the BETTER-keyed ones

The cache key defect is not specific to the unit that caused this. Across
the five vendor units built for this lane:

| unit | driver in key |
|---|---|
| `3c8f3d689539-lre-plain-zigcc-...` | `zigcc` |
| `sqlite-3.53.4-plain-zigcc-...` | `zigcc` |
| `zlib-1.3.1-plain-zigcc-...` | `zigcc` |
| `3c8f3d689539-plain-...` (libqjs) | **none** |
| `mbedtls-3.6.7-plain-...` | **none** |

**Two of five record no driver at all.** The other three record `zigcc`,
which *classifies* the driver without *identifying* it: both zigs on this
host -- Chocolatey 0.15.2 and the tree's 0.16.0 -- spell that same token.

The unit that actually served objects from another toolchain, `lre`, is one
of the three **better**-keyed ones. Its key named the driver and still
could not tell the two zigs apart. The two unkeyed units are strictly worse
and neither is small: `libqjs.a` is the island engine, `libmbedtls.a` is
TLS. Nothing here is a property of libregexp; it is the general shape, and
this was the mildest instance of it.

## 17. The merge gate, knob absent

Run `20261006-234534` on `ffaa01b0a`, treehash `e5b76ad846b8167f`, six
shards, 34.46 minutes, `PARTITION-RESULT expected=221 ran=221 missing=0
extra=0 dupes=0 verdict=OK`. Preflight: `dist-provenance=CURRENT`,
`worktree-dirty-files=0`, `rig=committed`, `machine-column=present`.

### 17.1 The five shards of the slice

| shard | verdict | Tests |
|---|---|---|
| 1 | GREEN | `985 passed \| 1 skipped (986)` |
| 2 | GREEN | `1717 passed \| 2 skipped (1719)` |
| 4 | GREEN | `1752 passed \| 2 skipped (1754)` |
| 5 | GREEN | `764 passed \| 36 skipped (800)` |
| 6 | GREEN | `732 passed \| 4 skipped (736)` |

Shards 1 and 5 were the two RED shards of the 21:50 run; both are now
green, and shards 2, 4 and 6 are unchanged from it test-for-test.

### 17.2 Shard 5, and the REGEX anchor inside it

Shard 5 deserves separating from its own shard. The test that flipped:

```
  regex (scriptc-only behavior) > regex-free programs never reference the
  regex runtime; regex use stays in its size class
```

`regex.test.ts` asserts the `STATIC` anchor before the `REGEX` one, and
vitest stops a test at its first failed `expect`. `STATIC` was the failing
assertion, so the `REGEX` line was never reached in any previous run: its
state was unknown, not assumed-good. **This run is the first evaluation of
`REGEX_CLASS_TEXT_RECORDED` in the project's history**, and it passed.

That matters because until now the fix was validated asymmetrically: the
hello-world by **intervention** -- revert one of the seven sites and the
permanent test reddens on line 5780, fix all seven and it reaches exact
equality -- and the regex program only by a direct measurement outside the
gate. Shard 5 is where the two meet.

**But the gate corroborates; it does not reproduce.** It never prints the
measured value on success. Passing `recordedTextComplaint` against the
recorded 630,150 with `TEXT_DRIFT_TOLERANCE = 256` bounds the figure to
**[629,895, 630,405]** and says nothing finer. The direct measurement pins
it at **630,182**, inside that window. Those are two different strengths of
claim, and merging them is exactly how 32 bytes of drift live forever --
which is literally what happened until today.

It is also the strongest argument for the re-record. With the constant at
630,182 this assertion becomes an **exact-equality** check instead of a
tolerance test that happens to pass.

### 17.3 Shard 3, separated

`SHARD-RESULT n=3/6 rc=1 min=6.76 files=37 verdict=RED :: vitest reported
errors:      Errors  1 error`

```
      Tests  733 passed | 10 skipped (743)
      Error: [vitest-worker]: Timeout calling "onTaskUpdate"
      Vitest caught 1 unhandled error during the test run.
```

**Zero failing assertions.** This is the known signature, now at **twelve**
reproductions, all of them on shard 3, across trees that do not contain
this slice. Not relaunched: the relaunch rule covers `CcCompileError` with
zero `error:` lines and this is not that.

Its explanation, not its attribution, is open. The gate-invocation
hypothesis is **refuted** -- plain unaltered invocation reproduced it. What
may remain is a difference in rate, 2 of 4 under plain invocation against
11 of 11 under the gate's, Fisher **p = 0.057**: suggestive, not
established, and a different claim that must not be reported as the old
conjunction in new words. The standing form is: *known signature, twelve
reproductions, all on shard 3, cause open; invocation is not necessary, and
a rate difference stands at p = 0.057.*

A red shard 3 with zero failing assertions says nothing about this slice.
One with failing assertions would.

### 17.4 The MACHINE sequence, raw

Six lines, in order, uninterpreted. `maxDiskPct` exceeds 100 on this host
because it is pending requests times 100; it is not a percentage occupied.

```
shard-1 minFreeRamMB=1931 minFreeRamPct=4.7 maxCpuPct=100 maxDiskPct=1210 maxDiskMBps=142 totalRamMB=40831 samples=38 failures=0
shard-2 minFreeRamMB=2798 minFreeRamPct=6.9 maxCpuPct=100 maxDiskPct=802  maxDiskMBps=93  totalRamMB=40831 samples=44 failures=0
shard-3 minFreeRamMB=2608 minFreeRamPct=6.4 maxCpuPct=100 maxDiskPct=577  maxDiskMBps=65  totalRamMB=40831 samples=37 failures=0
shard-4 minFreeRamMB=2104 minFreeRamPct=5.2 maxCpuPct=100 maxDiskPct=595  maxDiskMBps=82  totalRamMB=40831 samples=37 failures=0
shard-5 minFreeRamMB=2486 minFreeRamPct=6.1 maxCpuPct=100 maxDiskPct=166  maxDiskMBps=22  totalRamMB=40831 samples=16 failures=0
shard-6 minFreeRamMB=2876 minFreeRamPct=7   maxCpuPct=100 maxDiskPct=300  maxDiskMBps=93  totalRamMB=40831 samples=15 failures=0
```

Disk troughed 27.37 -> 25.3 GB across the run against a 10 GB floor.

### 17.5 The test count, reconciled

Shard 1 went from `(984)` to `(986)`. The permanent test was described as
"the test plus four controls", which would read as +5, and the two numbers
do not meet. The count, not the explanation:

`p17` added **two `test()` cases**. Vitest counts cases, not assertions,
and the controls are assertions inside one of them:

| case | `expect()` calls |
|---|---|
| `CONTROL: the scanner sees an unguarded branch, and does not see a guarded one` | **6** -- bare branch seen; guarded branch not seen; bare `#endif` still closes; `#else` arm is the non-lane build; marker in a trailing comment is prose; stripping a comment must not strip the code beside it |
| `scr_async.c emits no frame-lane code outside #ifdef SCR_CORO_LANE` | 1 |

Two cases, seven assertions. `island.test.ts` reports `(27 tests)` where it
reported 25, and shard 1 moves 984 -> 986. +2 equals +2.

Confirmed from `shard-1.json` rather than from log formatting: both cases
appear by full name with status `passed`. The earlier phrasing was the
defect -- it conflated assertions with cases -- and not the test.
