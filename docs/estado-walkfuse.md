# block/walkfuse - what `canDynCheckTo`'s nested walk cost before it had a memo

Worktree `<blocks>\walkfuse\wt` (branch `block/walkfuse`, from main `a2af1733a`).
Measured on `tests/perf/zapo-rest/app182` with `--provenance-sources`, frontend
lane (`SCRIPTC_KEYREAD_CENSUS_ONLY=1`), node v22.18.0, target
`x86_64-windows-gnu`, both arms on one commit pair.

The fix is `packages/compiler/src/ir/nodes.ts`. This file is the number, and
the two measurement errors made reaching it.

---

## 1. The mechanism, stated so it is recognisable elsewhere

`canDynCheckTo`'s inner walker carried a `stack` and no memo. The `stack`
answers the COINDUCTIVE question - "is this type already on my path" - and
nothing else. It is not a visited-set. So a type graph that is a DAG was
walked as if it were a TREE: every distinct path to a shared subtree
re-derived that subtree from scratch, and the visit count is multiplicative in
the sharing rather than linear in the graph.

Generated protobuf shapes are where that bites, because they share
aggressively: one `Long` reached from hundreds of field positions, each
position reached from several message types, several levels deep.

## 2. The number

    canDynCheckTo calls                        16,882
    DISTINCT types those calls reached        425,333   (~25 per call)
    nestedOk node visits                5,590,736,170   (~331,000 per call)
    worst single call                     169,819,943   visits
    re-derivation factor                       13,145 x

Read the middle two rows together. The walk had about twenty-five distinct
questions to answer per call and asked them three hundred and thirty-one
thousand times.

It was never WRONG - the answer was recomputed, not miscomputed - which is
exactly why it survived: nothing fails, the build is merely slow, and the
slowness lives in a predicate nobody suspects of being a loop.

On this rig that was ~954 s of a ~1601 s frontend lane. The single largest
term in the frontend, larger than the checker client, and larger than codegen
and the link combined (those were ~58 s of a 718 s full build).

## 3. Why the previous memo did not find it

`6df866b19` memoised `isJsonSafeType` for the duration of one call, taking its
nested calls from 5,591,101,070 to 444,970 - a 12,565x reduction, real and
byte-neutral. It made every inner question CHEAP. It could not make the
questions stop being ASKED, because the asking IS the outer walk, and the
outer walk was the thing without a memo. Afterwards the family was still 60%
of the profile, and the profile pointed at `nestedOk` and `nestedBody` - the
frames the memo had deliberately not touched.

The brief that followed read that as "fuse the two walks". That is the wrong
lesson by one step. The two walks being nested is not why the count was
5.59e9; the count was 5.59e9 because the OUTER one had no memo. Memoising the
outer removes the inner calls for free, which fusing would also have done, and
removes the outer re-descents, which fusing would not.

## 4. Two measurement errors, recorded on purpose

A record that hides the author's own measurement errors is worse than none.

**4a. A circular check, offered as the strongest result in the report.**
Predicting arm B from arm A's counters "reproduced" arm B exactly. Expand it:

    ns        = (A - B) / (va - vb)
    predicted = A - (va - vb) * ns  =  A - (A - B)  =  B

Identically B for any inputs; numerical residual -1.14e-13. It cannot miss, so
it is not a check. The orchestrator derived the same rate the same way and
amplified it as a mechanical coherence check before both of us caught it.

The rule that falls out: **a rate derived from a difference cannot validate
that difference.** There is a check only when the parameter comes from a
source that did not see the result.

What the samples DO support is weaker and stands: two A samples (1853.7,
1348.2 s) against three B samples (660.2, 685.5, 596.3 s), non-overlapping,
worst-case pairing 49.2% against a 37.5% within-arm spread. Enough to justify
measuring properly on a rotated rig; not enough to assert a factor.

**4b. A per-visit rate carried past its population.** The 174.1 ns/visit is a
residual derived from the ELIMINATED visits, which in arm A were all real
descents. It is not a cost-per-visit in general:

  * Applied to the 111.9M visits REMAINING it overstates badly, because ~80%
    of those are memo hits - a lookup, not a descent. That is what made a
    quoted "SCC memo ceiling of 3.01%" wrong. The honest band is
    `0.44% <= SCC prize < 3.01%`, nearer the floor.
  * It does not agree with the one independent figure available. An earlier
    profile gives self-time in `nestedOk` + `nestedBody` + `jsonSafe` of
    38.12% of 923.7 s = 352 s over the same 5.59e9 visits = **63 ns/visit**,
    2.8x below. The direction is expected (174 ns is total wall delta,
    including the `.every` callback frames and the GC the walk provokes; 63 ns
    is self-time in three frames, on another session) but the gap cannot be
    closed without profiling these arms.

So 174 ns is a scaling constant for this rig and this population. It is not a
physical cost per visit and must not be an input anywhere else.

## 5. What the fix was

One memo on `nestedOk`'s own answers, per call, written only where the
computation provably consulted nothing above the node (`minAssumed >=
myDepth`) - because the coinductive TRUE is an assumption about an ancestor,
so a result derived under it belongs to that path and not to the type.

    nestedOk node visits      5,590,736,170 -> 111,895,081     49.96x
    jsonSafe queries          5,590,767,513 ->  21,841,452    255.97x
    worst single walk           169,819,943 ->     595,277    285.27x

    distinct types reached          425,333 ->     425,333    IDENTICAL
    real isJsonSafeType walks       441,966 ->     441,966    IDENTICAL
    isJsonSafeType outside scope 76,244,335 ->  76,244,335    IDENTICAL

The last three rows are the proof. Without them a 49.96x reduction is
indistinguishable from having stopped doing necessary work.
