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

## 0.1 Where the defects came from, which is the part that does not age

**THE TOTAL IS NOT STATED HERE, and the number that used to be is
withdrawn rather than updated.** This section read *"the slice has
produced ten defects"* while section 7, 332 lines below it, is headed
*"Finding eleven arrived unasked"* -- the same stale-first collision
that section 12.9 was restructured to stop, recurring in a different
place. I did not re-derive the total, so I am not writing one: a count
you did not derive is not yours to trust, and a wrong one in the
document's opening carries more authority than a wrong one anywhere
else. The lower bound the document establishes about itself is
**eleven**, from section 7's heading, plus 12.9 and 12.10.

What this section actually argues does not need the total, and that is
why the number was dispensable. Three defects were found while writing
the slice.
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

The `onTaskUpdate` timeout signature is **not about this slice**. What
supports that is one property and only one: **every reproduction, without
exception, carries zero failing assertions.** The running count is below,
in one place. Separate it in any report, and do not relaunch it -- the
relaunch rule covers `CcCompileError` with zero `error:` lines, and this
is not that.

**TWO CLAUSES THAT USED TO SIT HERE ARE FALSE, and they were doing work.**
The sentence read *"every reproduction so far is on shard 3, across more
than 110 shard-runs, on trees that do not contain this slice"*. Both
halves are now contradicted by the record:

* **"every reproduction on shard 3"** -- run `20261007-011626` reproduced
  the signature on **shard 4** as well as shard 3, one occurrence each,
  zero in the other four. Section 19.2 records that measurement. **The
  universal is dead; the asymmetry is not, and the difference is the
  whole point.** Re-derived by the block that owns this front, by `runId`
  and by signature across every tree rather than one: **21 reproductions
  in 136 shard-runs, 20 on shard-3-derived sets against 1 on shard 4**,
  and restricted to complete six-shard gates, **8 of 22 on shard 3
  against 1 of 22 on shard 4**. "Always shard 3" was the wrong shape for
  a true thing. What is gone is the use of the shard number as a
  dismissal predicate; what remains is a strong prior that now carries a
  denominator.
* **"on trees that do not contain this slice"** -- of the three
  reproductions in this rig's own logs, run `20261006-215026` was on
  `f8e7f16ae`, run `20261006-234534` on `ffaa01b0a` and run
  `20261007-011626` on `ba15b0778`. All three are commits of this slice's
  branch. The clause was false when it was written and I did not check it;
  it is corrected here rather than quietly dropped.

**EVERY COUNT HERE CARRIES ITS POPULATION, because the one that did not
is how this section went wrong twice.** The inherited "twelve" turns out
to be reconstructible only as *gate-wt alone, shard 3 alone, as of about
00:43* -- three restrictions, none of them written beside the number, so
it read as a count over everything. A figure whose scope is recoverable
only by forensics is not a measurement; it is a number that acquired a
story afterwards. My own audit covers *this rig's logs alone*: four
occurrences across four runs in `syncgen-gate\logs`, three on shard 3 and one
on shard 4. Beyond that population I did **not** re-derive anything and
do not own the figures.

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

What may survive is weaker and different: a difference in **rate**. The
figure carried here was 2 of 4 under plain invocation against 11 of 11
under the gate's, Fisher **p = 0.057** -- suggestive, not established, a
separate hypothesis rather than the conjunction redressed.

**THAT p IS SUSPENDED, and the reason is arithmetic rather than
judgement.** The re-derivation that produced the 21 also gives **8 of 22
complete six-shard gates** reproducing on shard 3. An 11-of-11 arm cannot
be drawn from a population where complete gates reproduce 8 times in 22,
so the gate arm was counted over some narrower set that was never named
-- the identical defect as the twelve, located in a denominator instead
of a total. Until both arms are re-derived with their populations written
beside them, **this document does not quote p = 0.057**, and earlier
appearances of it are to be read as carrying this caveat.

Suspending is not refuting. The rate hypothesis may survive re-derivation
and may come back stronger; it is the number that is withdrawn, not the
idea. Noting also that a p recomputed from arms chosen after seeing the
result would not mean what the first one was meant to mean.

**THE CANONICAL STANDING FORM LIVES HERE AND NOWHERE ELSE.** It read
"eleven" here and "twelve" 486 lines further down, both labelled
*verbatim*, so a reader going top to bottom met the stale one first. A
wrong number carrying the authority of a canonical form is worse than a
wrong number. The repair is structural, not arithmetic: **the occurrence
count is not part of the form**, because it is the only part that ages.
Section 17.3 now points here instead of restating the sentence.

The standing form, verbatim, is: *known signature, zero failing
assertions in every occurrence, cause open; invocation is not necessary,
shard 3 is strongly but not exclusively favoured, and a rate difference
is hypothesised with its arms under re-derivation.*

The shard clause sits in the form in both directions deliberately. A form
that said "shard 3" flat was read as a predicate and used to dismiss a
red, and that is no longer available. A form that said only "not
exclusively 3" would throw away a real 20-to-1 asymmetry and invite the
opposite error. **What still dismisses a red is the zero, and only the
zero.** No count lives in the form: the count is the part that ages.

**The `p = 0.057` has come OUT of the form and is SUSPENDED, not
refuted.** It is quoted below with its reason.

**The running count, recorded once, each figure beside its population.**
A later run adds to this line and to no other.

| population | occurrences | shard 3 | shard 4 | denominator |
|---|---|---|---|---|
| all trees, by `runId` and signature (sibling block, re-derived) | **21** | 20 | 1 | 136 shard-runs |
| complete six-shard gates only (same re-derivation) | 9 | **8 of 22** | **1 of 22** | 22 gates |
| this rig's logs alone (audited by me) | 4 | 3 | 1 | 4 runs |

**The 21 supersedes the "fourteen" this line used to carry, and the
"twelve" before that.** Neither of those was wrong arithmetic. Both were
right counts over a population they did not name -- *gate-wt, shard 3, as
of 00:43* for the twelve, and that same inheritance plus my two for the
fourteen. A scope that has to be reconstructed is a scope that was
hidden, whatever the intent. The 21 is recorded as the sibling block's,
re-derived across every tree; I did not reproduce it, and the row says
so. Zero failing assertions in every one of the 21 holds, and that is the
only clause the attribution rests on.

**WHAT THE J DOES AND DOES NOT BOUND, corrected by a later result from the
block that owns this front.** The J = 0.9474 between shard-3 file sets
(section 7) was recorded as a caution: the reproductions sat on nearly
identical content, so "a different tree" bought little, and tree content
as a NECESSARY condition stood UNMEASURED because it had never been
varied. It has now been varied. **The shard-3 set reproduces with half its
files replaced by inert files from shard 5, provided the count and the
load are held at 37.** Reported to me rather than measured by me, and
recorded here as theirs.

**Localised further, same block, later still: the cause lives in 19 of
the 37 files**, and still needs accompanying load. The other 18, padded to
the parent's size with filler demonstrated inert, come back **green 2/2**.
So it is not the set, not the count, and no longer "some subset" either --
it is an identified subset, and the search space has halved.

**THIS LOCALISATION IS THE CLAIM RESTING ON A WEAK ARM, and naming which
claim that is matters more than the claim itself.** The instinct after the
shard-4 occurrence is to doubt the shard asymmetry. That instinct is
wrong: the asymmetry re-derives at 20 to 1 across every tree, and 8 of 22
against 1 of 22 within complete gates. The fragile claim is this one.
**Green 2/2** is two clean draws against a defect whose per-gate rate, by
that same re-derivation, is about 8 in 22. Two draws at that rate come
back clean a little under half the time by chance alone, so "the other 18
are inert" is close to uninformative as stated -- a null with its power
uncomputed, which is the shape this slice has been caught by before. The
owning block is remeasuring the L1-A arm at **n = 6 per arm**. Until that
lands, the 19-of-37 split is a working hypothesis and not a result, and
nothing here should lean on it.

Nothing in this document should be written to imply the whole set is
necessary. The caution the J supported is weaker than it looked: content
can differ by half and the signature still arrives, so a high J no longer
limits what a differing tree would have shown. The canonical form above is
unaffected -- it never claimed a cause.

**And duration orders nothing, not even within one family.** Two runs of
**2.09 minutes each** -- same file count, same rig, same tree -- came back
one red and one green. Anyone tempted to read a shard's wall time or the
`MACHINE` column as explaining a verdict has a clean counterexample.
Report that column raw and uninterpreted.

This is also why the earlier 0-of-2 green arm deserved the caution it got.
Two clean draws against a defect of unknown rate is not evidence of
absence, and the run that refuted it was the third.

### 12.10 DIAGNOSED: the zero that was not a zero, and the byte it planted

A patch script of mine returned **0 matches** against a document that
visibly contained the text, and the response at the time was to switch
method and carry on. That is the silencing move: a zero from a pattern you
wrote yourself is a hole in the instrument until it has a cause.

**The cause, reproduced.** `fix6.py` built its needle in a non-raw Python
triple-quoted literal containing `syncgen-gate` + backslash + `tmp`.
Python turned those two characters into a single TAB before the search
ever began, so the needle was `syncgen-gate<TAB>mp` while the document
held `syncgen-gate<BACKSLASH>tmp`. The document was never wrong. The
needle was mangled one parse layer below the place anyone was looking.

Proved in both directions against `efbffa3f2`'s version of this file, with
the input asserted non-empty in the same invocation:

| assertion | result |
|---|---|
| input length > 0, and contains `6.43 GB` | true |
| the needle `fix6.py` actually built contains a TAB | true |
| that needle matches the document | **0** -- the observed zero |
| the same needle with the backslash intact matches | **1** -- positive control |
| document holds `syncgen-gate<BACKSLASH>tmp` | 1 |
| document TAB count before `fix6.py` | **0** |

**And the escape did not stop at the needle.** The *replacement* half of
the same hunk carried the same unescaped sequence, so when the edit was
finally applied by another route the TAB rode into the text. Commit
`ba15b0778` -- the HEAD the merge gate then measured -- shipped exactly
one TAB in this file, inside `syncgen-gate<TAB>mp` at section 18.4, where
a reader sees `6.43 GB` attributed to a path that does not exist. It is
repaired in the same change that records this.

**Why every guard missed it.** The post-write control-byte scan treats TAB
as benign, alongside LF and CR, which is correct for source and wrong for
this file: this document contains exactly zero TABs by convention, so one
is a defect. A scan whose allowed set is chosen globally cannot see a
local invariant. The non-ascii check and the line-ending delta were both
clean and correct -- the byte is ASCII and no line ending moved.

**The lesson is narrower than "escape carefully".** The first script's
diagnosis was available for the asking and was not asked for; the
structural repair that followed -- no backslash in a literal,
`os.path.join`, `tarfile` instead of a shell -- protects the *next*
script and explains nothing about the one that failed. A fix applied
forward is not an answer to a question asked backward. Worse, in the
course of writing this section the same class struck again: the first
reproduction attempt ran through a shell heredoc, which ate one backslash
from the *corrected* needle too, and both arms came back 0 -- a false
confirmation that would have read as "the text was never there". It was
caught only because the positive control was required to come back
**1**, not merely to differ. The run that stands is the one with no shell
between the source and the interpreter.

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

Knob-on parity is unchanged by the fix: 12 of 12. **CORRECTED -- the
earlier enumeration here named eight of the twelve and read as if that
were all of them.** The twelve are: **3** channel arms (`f64`, `bool`,
`ref`), **6** lifecycle arms (`genret`, `genthrow`, `bodythrow`,
`nextval`, `als`, `collide`), **2** poison controls that prove the
comparison can see a wrong arm (the two `scalar` arms), and **1** record
that the `ref` arm is deliberately NOT poisonable. 3 + 6 + 2 + 1 = 12,
and the sum is written out so the next reader checks the closure instead
of trusting a part.

`EXPECTED_CONVERSIONS = 1` is asserted on the knob-on arm, so a green here
cannot mean the wrap silently disabled the lane -- 0 would fail.

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

**Two of the five built here record no driver at all.** The other three
record `zigcc`, which *classifies* the driver without *identifying* it:
both zigs on this host -- Chocolatey 0.15.2 and the tree's 0.16.0 -- spell
that same token.

CORRECTION, derived after the above: there are **six** cached vendored
units, not five. The sixth is the curl stub at `cc.ts:1272`, which keys on
`curl-stub-${target}` and nothing else -- no source identity, no flavour,
no driver. It does not appear in the table because it is a Linux stub and
is not built for this Windows lane, which is exactly why counting from a
Windows cache directory undercounts it. **Three of the six carry no driver
component at all.**

The source's own enumeration is wrong in the same two ways. `cc.ts:774`
reads "the five cached vendored units (the engine archive, lre, zlib,
SQLite, mbedTLS)" and says they key on `plain|asan` "plus the driver and
target". It omits the curl stub, and the "plus the driver" is false for two
of the five it does list: the observed directory names
`3c8f3d689539-plain-x86_64-windows-gnu` and
`mbedtls-3.6.7-plain-x86_64-windows-gnu` carry no driver token. A comment
that enumerates is a count, and this one was not re-derived when the sixth
unit arrived.

Another block reached six independently and by a different route. Two
derivations agreeing is worth more here than either, because the number I
first published came from counting directories in a cache -- a population
that can only contain what this lane happens to build.

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

It is also the strongest argument for the re-record -- stated carefully,
because the tempting phrasing is wrong. With the constant at 630,182 the
assertion does **not** become an exact-equality check: it is still
`recordedTextComplaint` against a 256-byte tolerance. What changes is that
the measured figure now sits at delta **0** instead of delta **32**, so the
test has its whole 256-byte budget available to catch a real regression
rather than 224. Calling it exact equality would be a new claim of the same
kind this section is about, so it is not made.

### 17.3 Shard 3, separated

`SHARD-RESULT n=3/6 rc=1 min=6.76 files=37 verdict=RED :: vitest reported
errors:      Errors  1 error`

```
      Tests  733 passed | 10 skipped (743)
      Error: [vitest-worker]: Timeout calling "onTaskUpdate"
      Vitest caught 1 unhandled error during the test run.
```

**Zero failing assertions.** This is the known signature, and **this run
contributes one occurrence** -- a fact about this run, which is why it is
stated here rather than a total, which is not. The running count and the
canonical standing form are in **section 12.9**, which is the only place
either is declared. Not relaunched: the relaunch rule covers
`CcCompileError` with zero `error:` lines and this is not that.

Its explanation, not its attribution, is open. The gate-invocation
hypothesis is **refuted** -- plain unaltered invocation reproduced it. What
may remain is a difference in **rate**, which is a different claim and
must not be reported as the old conjunction in new words.

**The arms and the p are deliberately absent from this paragraph.** They
used to be quoted here, and section 12.9 has since suspended them: the
gate arm cannot be reconciled with 8 of 22 complete gates reproducing, so
the denominator was never named. This paragraph said "the standing form
is not restated here" and then restated the number standing next to it,
which is the same drift in a narrower place -- a pointer that exempts the
prose beside it is not a pointer. See section 12.9 for both.

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

## 18. What the `ffaa01b0a` gate is evidence for, and what it is not

**It is valid for what it measured.** On `ffaa01b0a`, treehash
`e5b76ad846b8167f`, partition 221/221: the seven-site fix, both size
anchors, five green shards, and the first-ever evaluation of the `REGEX`
anchor. Nothing in section 17 is weakened by anything below.

**It is not a merge gate.** `main` moved **ten commits** after that run,
and one of them changes `packages/compiler/src/backend/cc.ts` by +141 --
the detector for vendor objects built by a different toolchain, which is
the durable half of the finding in section 15. A gate measures the tree it
ran on. That tree is no longer the tree that would land, so citing this run
for the merge question would be answering a question it was not asked.

These two statements have to be kept apart on purpose. A gate that is
genuinely valid is exactly the kind of evidence that gets quoted for the
wrong question later, and "five of six green" is quotable.

### 18.1 The tree that would actually land

`main` is merged in. Verified by content, not by the merge summary:

| check | result |
|---|---|
| `main` is an ancestor of HEAD | yes |
| `origin/main` is an ancestor of HEAD | yes |
| `scr_async.c` blob vs the measured bytes | `dfe31c7a9ab63a18`, identical |
| the permanent lane-guard test | present |
| `REGEX_CLASS_TEXT_RECORDED` | `630_182` |
| worktree dirty | 0 |

**TWO COUNTS, EACH WITH ITS OWN NAME, AS OF `a6ba4c985`** -- the last
commit before this correction, named because a bare commit count ages the
moment anyone commits, including the commit that writes it down. At that
ref: `origin/main..HEAD` = **73**, `main..HEAD` = **56**. The difference
is not a discrepancy: local `main` is **17 commits ahead of `origin/main`**
and unpushed, so 17 of the 73 are main's own drift and the slice's own
commits are 56. "73 commits" is true about the range and misleading about
the slice, and only the labelled form should be quoted. The 17 is the
durable figure here; the other two move with every commit.

One consequence is load-bearing for the merge question rather than for the
gate: **`origin/main` does not contain `scripts/machine-sampler.ps1` at
all.** It was added by `298bb7cc7`, which is inside those 17. The sampler
and the gate's four calls to it reach this branch through local `main`, so
"the branch has taken main, which carries the sampler" is true of the
local ref and false of the remote one. Landing this slice on `origin/main`
would carry those 17 commits -- the sampler, its gate calls, and the
`cc.ts` vendor-object detector -- with it. That is a fact about the merge,
which is the user's decision, not a defect in the slice.

**The partition stays at 221**, and that is re-derived rather than carried
over: expanding the three `include` globs from `vitest.config.ts` against
the merged tree yields 221 files. None of main's ten commits adds a test
file -- `packages/compiler/test/obj-cache-integrity.test.ts` is **modified,
not new**, and was already line 37 of the previous run's
`expected-files.txt`.

**The decomposition, with the sum visible.** An earlier version of this
paragraph said the third glob "contributes 55 of the 221". **That is
wrong: it contributes 80.** 55 is `packages/compiler/test` alone, one
package inside that glob.

| `include` glob | files |
|---|---|
| `tests/harness/**/*.test.ts` | 138 |
| `packages/*/src/**/*.test.ts` | 3 |
| `packages/*/test/**/*.test.ts` | **80** (cli 2, compiler 55, runtime 23) |
| **sum** | **138 + 3 + 80 = 221** |

The three sets are disjoint, so the sum closes exactly on the measured
union of 221 -- and that closure is the point of printing it. The
arithmetic already excluded 55 before anyone looked at a file: a reader
re-deriving as `138 + 3 + 55 = 196` concludes the partition moved by 25
files and goes hunting a drift that never happened. **A decomposition
quoted without its sum is an invitation to that hunt.** The original
warning this sentence carried was right in direction -- assuming only
`tests/harness/**` counts gives the wrong answer -- and wrong in its
number, which is the more durable kind of error, because the direction
reads as the point and the number rides in unchecked.

**LATENT, NAMED NOW RATHER THAN FOUND IN A RED RUN.** The gate's expected
set (`scripts/gate-sharded.ps1`, the `$roots` loop) skips `node_modules`
and nothing else. vitest's default `exclude` additionally drops
`**/dist/**`. Today the two agree, because no `*.test.ts` lies under any
`dist/` and the measured union is 221 either way -- so this is a risk, not
a defect, and 221 is not in doubt. But a future `*.test.ts` under
`packages/*/src/dist` or `packages/*/test/dist` would be **expected by the
gate and never run by vitest**, surfacing as `PARTITION-MISSING` that
belongs to the glob and not to the run. Written down it costs this
paragraph; discovered mid-gate it costs a hunt through a red partition.

### 18.2 The dist is now stale, by construction

`HEAD:packages/compiler/src` is `07cbac63c` against a stamp of
`be5cfc056`, because `cc.ts` moved. The gate preflight will report
`dist-provenance=STALE` and abort with `dist-provenance-not-current`.

**That is the check working, not failing.** The CLI-spawning tests resolve
the compiler to `dist`, so without this the run would measure a compiler it
could not name and report green about code it never executed. `dist-build
.ps1` reruns before the next gate, and the gate is deliberately not allowed
to repair its own subject.

### 18.3 Why the merge is still blocked, and by what

Not by quality. The contract requires six green shards; this run has five
and a red shard 3 that is the known `onTaskUpdate` signature with zero
failing assertions. Extending the relaunch rule to cover that signature is
a change to the contract, and that is the user's decision, pending with
them. The slice is blocked by a process question, not by a defect in it.

### 18.4 NAMED ITEM: the gate's TMP is swept by nothing, and it leaks

**The mechanism, which is structural rather than untidy.** Three trees
grow under a gate rig, and exactly one of them has no keeper:

| tree | bound |
|---|---|
| `node_modules/.cache/scriptc-tests` | `pruneScratchOnce`, cap `SCRIPTC_TEST_SCRATCH_MAX_MB` (8192 here) |
| `$GateRoot\cache` (the CAS) | its own size-capped LRU, and **explicitly excluded** from the scratch sweep |
| `$GateRoot\tmp` | **nothing** |

`$GateRoot\tmp` is `TMP`/`TEMP`/`TMPDIR` for every compile the run spawns,
so it fills with `scr-*` and `payload-*` directories and keeps them. It
falls between the two sweeps: the scratch pruner does not own it, and the
CAS cap does not reach it. Nobody is at fault, which is the shape of a
process leak rather than of a mess.

**The number, and the unit it is per.** `syncgen-gate\tmp` held **6.43
GB** accumulated across exactly **two** full six-shard runs -- the 21:50
cold one and the 23:45 warm one -- so **~3.2 GB per SIX-SHARD GATE, n = 2
runs in 1 rig.**

**THE RATE DEPENDS ON THE KIND OF RUN, and two true figures contradicted
each other until each named its population.** A sibling rig reports ~0.45
GB per run, and `gatefour/tmp` back at 874 MB after four mixed runs gives
~0.22 GB each. Those rigs are dominated by **short single-shard runs**;
mine held two **full six-shard gates**. Neither figure is wrong and
neither generalises:

| unit | leak |
|---|---|
| one six-shard merge gate | **~3.2 GB** |
| one subset / single-shard run | **~0.2-0.45 GB** |

A budget has to name which kind of run it is counting. This is the
slice's own predicate surfacing in the disk ledger: two measurements
disagreed only because neither carried its denominator, and reconciling
them needed no new measurement at all -- only the unit each was per.

**RETRACTED: an earlier report of this said ~0.45 GB/run.** That figure is
wrong by about sevenfold and I cannot reconstruct how it was produced,
which is the worst kind: it was quoted in a readiness report and would
have been banked into a disk budget. 6.43 / 2 is the derivation; the
earlier figure has none.

**What the sample cannot say, and why that is partly my doing.** The cold
and warm runs are averaged together and cannot be split, because I purged
the directory before bucketing its 752 entries by mtime -- the two runs
were cleanly separated in time (22:00-22:35 and 23:45-00:20) and the
split was there to be taken. **Measure, then purge.** There is no second
clean sample either: `armrig`, `boxparam`, `knobon-measure` and
`d2-valguard-gate` retain no `tmp` at all, and `gatefour`'s 830 MB over
four full runs is post-purge residue, not a cumulative total, because that
rig was purged mid-session.

**SUPERSEDED AS AN ESTIMATE, by measuring before purging this time.** The
~3.2 GB above is 6.43 / 2, an average over a cold and a warm run that
could not be separated. Run `20261007-011626` started with an empty `tmp`
and was measured before anything touched it, so one warm six-shard gate
now has a **direct** figure rather than an averaged one. It is in section
19.4, recorded once, and this paragraph is left standing because the
derivation it describes is still the derivation of the 6.43 figure.

**Why it is the dominant long-run term even though it hides inside a
smaller net.** A warm run's measured net drawdown is 2.68 GB while its TMP
grows by more than that, because the scratch sweep gives ~2 GB back inside
the same run. But scratch is capped and oscillates around its floor, and
the CAS plateaus; TMP is the only term that ratchets. So the per-run net
drawdown and the TMP leak converge, and over N runs the rig's disk cost is
essentially N times the leak.

**The fix is a separate decision and is not this window's.** Recorded here
so it is a named item with a derivation rather than folklore about gates
being hungry.

## 19. The merge gate of `20261007-011626`

Run `20261007-011626` against the worktree `G:\blocks\llvm-wt` on branch
`coro/sync-generators`, head `ba15b077834ee6041e5789d913ac53dcb9ba61cb`,
*"docs(stackless): the leak rate is per KIND of run, and shard 3 narrows
to 19 of 37"*. Six shards, **34.02 minutes**, verdict **RED**: four green,
two red. `GATE-EXIT rc=1`.

**THE TREE IS NAMED BECAUSE IT KEPT BEING NAMED WRONG.** Reports of this
run, mine included, referred to it by the rig directory. They are not the
same thing, and three paths get swapped for one another:

| path | what it is |
|---|---|
| `G:\blocks\llvm-wt` | **the tree this gate measured**, branch `coro/sync-generators` |
| `G:\blocks\syncgen-gate` | **not a tree at all** -- no `.git`, no source; `logs`, `tmp`, `cache`, `prov`, `zig`, `rig` |
| `G:\blocks\slice-wt` | a different worktree, branch `d15-knobon`, the 216-program corpus |
| `G:\blocks\gate-wt` | a different worktree again |

Verified on disk rather than inferred: `G:\blocks\syncgen-gate` holds no `.git` entry,
and all seven `TREEHASH` lines in this run's own log carry
`repo=G:\blocks\llvm-wt`. The rig lends a run its `runId` and its
`TMP`. It never lends it a tree.

**The tree was the same tree in all six shards.** `TREEHASH baseline=
d02d24996d2100d2`, and the per-shard `TREEHASH` line printed
`d02d24996d2100d2` before every one of the six. A gate log's `head=` is
not the tree; the per-shard hash is, and here it did not move.

**The reporter could have come out red.** Five harness controls ran before
the first shard and all five passed in the direction that proves it:
two specificity controls, where a clean log whose passing test *names*
contain `failed`/`FAILED`/`fails` must still read PASS, once plain and
once with ANSI colour on the summary; and three sensitivity controls --
one planted failure in the summary, a log truncated before the summary,
and a clean summary with a nonzero exit code -- each of which must read
FAIL. The verdicts below are not green by construction.

**Lane, declared.** `node=v25.9.0`, `zig=0.16.0` from
`G:\tools\zig\zig.exe` -- the 0.16.x lane, not the Chocolatey 0.15.2 on
`PATH` -- `SCRIPTC_TARGET=x86_64-windows-gnu`, `SCRIPTC_CC=zigcc`,
`SCRIPTC_TEST_CC=zig cc`, `workers=12`, `TMP=G:\blocks\syncgen-gate\tmp`.

```
PARTITION-RESULT expected=221 ran=221 missing=0 extra=0 dupes=0 verdict=OK
```

### 19.1 The four green shards

`Tests` verbatim from `SHARD-RESULT`:

| shard | verdict | min | files | Tests |
|---|---|---|---|---|
| 1 | GREEN | 6.96 | 37 | `Test Files  36 passed \| 1 skipped (37) ; Tests  985 passed \| 1 skipped (986)` |
| 2 | GREEN | 7.15 | 37 | `Test Files  37 passed (37) ; Tests  1717 passed \| 2 skipped (1719)` |
| 5 | GREEN | 2.97 | 37 | `Test Files  34 passed \| 3 skipped (37) ; Tests  769 passed \| 36 skipped (805)` |
| 6 | GREEN | 2.81 | 36 | `Test Files  36 passed (36) ; Tests  732 passed \| 4 skipped (736)` |

### 19.2 The two red shards, and the fact that is new

Both reds carry the same `SHARD-RESULT` tail and the same `Why`. The
`Tests` figures for these two come from the **JSON reporter**, not from
the log, because a run that ends in an unhandled error prints no `Tests`
summary line.

| shard | verdict | min | files | Tests (JSON) | failing assertions |
|---|---|---|---|---|---|
| 3 | RED | 7.3 | 37 | `733 passed \| 10 skipped (743)` | **0** |
| 4 | RED | 6.78 | 37 | `1752 passed \| 2 skipped (1754)` | **0** |

`SHARD-RESULT`, verbatim, both identical past the shard number and timing:

```
SHARD-RESULT n=3/6 rc=1 min=7.3 files=37 verdict=RED :: vitest reported errors:      Errors  1 error
SHARD-RESULT n=4/6 rc=1 min=6.78 files=37 verdict=RED :: vitest reported errors:      Errors  1 error
```

`Why`, verbatim, one occurrence in `shard-3.err` and one in `shard-4.err`:

```
Error: [vitest-worker]: Timeout calling "onTaskUpdate"
Vitest caught 1 unhandled error during the test run.
```

**THE MEASURED FACT, THIS RUN, UNINTERPRETED.** The `onTaskUpdate`
signature appears **once in `shard-3.err` and once in `shard-4.err`**, and
**zero times** in `shard-1.err`, `shard-2.err`, `shard-5.err` and
`shard-6.err`. Counted with `rg -c` over each of the six files
individually; the two matching files are the positive control that the
pattern and the reader both work, so the four zeros are absence and not a
dead instrument.

**This is the first occurrence recorded on any shard other than 3.**
Until this run the standing record was twelve reproductions, all on shard
3. That was described to me as a direct count, and it was -- over a
population nobody wrote down. Re-derived since: *gate-wt alone, shard 3
alone, as of about 00:43*. So this run did not overturn a complete
census; it added the first shard-4 occurrence to a record that had never
covered the other trees. Across all trees the standing figures are 21
reproductions in 136 shard-runs, 20 to 1 by shard.

What that *means* is not stated here and is not stated anywhere yet. One
occurrence is one occurrence, and against a 20-to-1 prior it is exactly
the observation that is easiest to over-read in either direction. The
standing form and the running count live in **section 12.9** and nowhere
else; 12.9 has been corrected for this.

**Zero failing assertions in all six shards**, from the JSON reporter
rather than from log formatting -- `numFailedTests` and
`numFailedTestSuites` are both 0 in every one:

| shard | failed | passed | pending | total |
|---|---|---|---|---|
| 1 | 0 | 985 | 1 | 986 |
| 2 | 0 | 1717 | 2 | 1719 |
| 3 | 0 | 733 | 10 | 743 |
| 4 | 0 | 1752 | 2 | 1754 |
| 5 | 0 | 769 | 36 | 805 |
| 6 | 0 | 732 | 4 | 736 |

**Not relaunched.** The relaunch rule covers `CcCompileError` with zero
`error:` lines. This signature is not in it, and quietly extending a rule
to cover the failure in front of you is how a rule stops being one.

### 19.3 The MACHINE sequence, raw

Six lines, in order, uninterpreted. `maxDiskPct` exceeds 100 on this host
because it is pending requests times 100; it is not a percentage occupied.
Duration and this column order nothing -- section 12.9 has the
counterexample of two 2.09-minute runs, one red and one green.

```
shard-1 minFreeRamMB=2843 minFreeRamPct=7   maxCpuPct=100 maxDiskPct=1547 maxDiskMBps=804 totalRamMB=40831 samples=38 failures=0
shard-2 minFreeRamMB=3536 minFreeRamPct=8.7 maxCpuPct=100 maxDiskPct=561  maxDiskMBps=71  totalRamMB=40831 samples=39 failures=0
shard-3 minFreeRamMB=3729 minFreeRamPct=9.1 maxCpuPct=100 maxDiskPct=999  maxDiskMBps=203 totalRamMB=40831 samples=40 failures=0
shard-4 minFreeRamMB=3613 minFreeRamPct=8.8 maxCpuPct=100 maxDiskPct=653  maxDiskMBps=53  totalRamMB=40831 samples=37 failures=0
shard-5 minFreeRamMB=4229 minFreeRamPct=10.4 maxCpuPct=100 maxDiskPct=821 maxDiskMBps=33  totalRamMB=40831 samples=16 failures=0
shard-6 minFreeRamMB=4255 minFreeRamPct=10.4 maxCpuPct=100 maxDiskPct=733 maxDiskMBps=40  totalRamMB=40831 samples=15 failures=0
```

Disk ran `free=39GB` at start to `free=35.5GB` at `GATE5-TOTAL`, against a
10 GB floor, troughing 37.28 -> 35.25 GB across the six shards.

### 19.4 The TMP leak, measured directly instead of averaged

Section 18.4's ~3.2 GB per six-shard gate is `6.43 / 2`: an average over a
cold and a warm run that had already been purged together. This run was
captured **before** any cleanup, which is the whole point of running the
capture first.

**One warm six-shard gate leaves 3.53 GB in `tmp`, across 380 top-level
entries.** Bucketed by mtime into runs, the directory yields exactly
**one** bucket, `01:17 .. 01:49`, which brackets the run's own
`01:16:26 .. 01:50:27`.

**The denominator is proved, not assumed.** `tmp` could have held residue
from an earlier run and inflated the figure. It did not: of the 380
entries, the earliest **creation** time is `01:16:35` and the latest
`01:49:09`, and **zero** were created before the gate's `01:16:26` start.
So every byte counted belongs to this run. Reading mtime alone would not
have settled it -- a directory's mtime moves when its contents change, so
an old entry touched by a new run looks new.

| figure | value | how |
|---|---|---|
| one warm six-shard gate | **3.53 GB**, 380 entries | direct, this run, pre-purge |
| one six-shard gate (18.4) | ~3.2 GB | `6.43 / 2`, averaged over cold + warm |
| one subset / single-shard run | ~0.2-0.45 GB | sibling rigs, short runs |

The direct figure and the average agree to about 10%, and the direct one
is for a **warm** run specifically. Neither replaces the other: 18.4's
number is per *either* kind, this one is per warm six-shard gate, and the
earlier unit confusion in that section is exactly what happens when a
figure travels without its denominator.

Free space on `G:` immediately after capture: **35.98 GB**.

### 19.5 VENDOR-CACHE, scored against its registered prediction

The prediction was `<= 10` distinct `VENDOR-CACHE-UNKNOWN` lines and **0**
`VENDOR-CACHE-MISMATCH`, with no failure. Measured across every `.log` and
`.err` in the run directory: **10 distinct UNKNOWN**, **0 MISMATCH**. Held
exactly at the bound.

The ten are six units over two targets -- `curl-stub`, `lre`, `mbedtls`,
`qjs`, `sqlite`, `zlib` across `x86_64-windows-gnu` and
`aarch64-linux-gnu.2.36` -- every one reading `built=<no-stamp>` against
`now=401f4d1e088e clang version 21.1.0`. `<no-stamp>` is the pre-key
cache, not a mismatch: the objects predate the compiler-identity field, so
the detector says UNKNOWN rather than guessing. That is section 15's
third face of the two-zig trap behaving as designed.

### 19.6 The instrument this section rests on, and what it did not have

Every number in 19.4 and 19.5 comes from `postrun-capture.py`. **It
shipped with no self-tests at all** -- it was handed over as having four
passing, and `rg` over the file returns no assertion, no test function and
no selftest entry point. The figures above were produced by an unexercised
instrument and only then tested.

Four were written afterwards and all pass, twelve assertions in total. The
one that mattered is the second: the live `tmp` produced exactly **one**
bucket, so the gap-splitting branch -- the only reason `tmp_buckets`
exists rather than a one-line sum -- was never reached by the real data
and would have been green forever. It is now driven by a synthetic
directory with a deliberate 70-minute gap, which splits into two buckets
of three, oldest first, and collapses back to one when `gap_s` is raised.
The fourth covers the direction instruments fail toward: an empty log
directory must report zero, so a zero from the real one means *no
MISMATCH lines* and not *no files read*.

This does not retract anything in 19.4 or 19.5. It records that the
testing came after the measuring, which is the wrong order, and that the
branch most likely to be wrong was the one the live data could not touch.
