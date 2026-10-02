# block/libcache - what a per-library lowering fragment was worth, and why it was not built

Worktree `<blocks>\libcache\wt` (branch `block/libcache`, 19 commits over main
`b6a763983`, final tree `d4c94e92a`). Measured on
`tests/perf/zapo-rest/app182` with `--provenance-sources`, node v22.18.0,
target `x86_64-windows-gnu`, with a `cc` stub that stops the build at the LINK
so both lowering passes and the emit have run and the 40-minute link has not.

STOPPED 2026-10-01, deliberately and with the number in hand. What is on this
branch is the IDENTITY layer, the GUARDS and the MEASUREMENT. All of it is
env-gated and behaviour-neutral: one env read per instrument, nothing in the
compiler reads the output back, a flush cannot fail a build. The serializer,
the assembly and the invalidation are NOT built and are not going to be.

This file exists because the block's findings were spread over 19 commit
messages and the agent that wrote them is gone. Section 9 is why it stopped;
section 10 is the part most likely to be useful to somebody working on
something else.

---

## 1. The number the block exists for

    T               355.6 s      build wall, on f21d51ba1 over b6a763983
    entry             2.7 s      0.8%    (was 380.7 s before the formatting fix)
    C               203.5 s     57.2%    non-entry attributed lowering -- the CEILING
    C_reachable     184.6 s     51.9%    cacheable only -- what it would DELIVER
    modules         340 of 351 cacheable (96.9%);  C reachable = 90.7% of C
    refusals        11, ALL form-collision, zero opaque
                    client/WaClient.ts alone is 15.3 s of 18.9 s
    bar             12.8% of T  ->  PASSES by 4x

C is the work a per-module fragment COULD reach. C_reachable is what survives
the census: every module that hits a refusal is not cacheable, and until the
census ran, "the fragment works" and "the fragment delivers the seconds" were
different claims with only the first supported.

The attribution and the census are written by the SAME `lowerToIr` call, with
both env vars set in one invocation. That is a condition, not a convenience:
joining an attribution and a census from two builds is silent in the worst
way, because each number is individually true and only the table is nonsense.

**Three lower-bound caveats, all of which make the real number no better than
the one above.**

  * `<width>` is a synthetic `loc.file`. The census counts it as a module
    though it is not one, so the 351 denominator is one too large. It has NO
    attributed seconds at all, so it does not enter `C_reachable` and cannot
    distort it. `census-weight.mjs` reports it as a cross-build MISMATCH -- 1
    of 351 census rows naming a module the attribution never saw. That warning
    is a FALSE POSITIVE here and the table stands: the two files came from one
    invocation. The check is still the right check; `<width>` is simply the
    one row it cannot tell from a mismatched pair.
  * `npm-static` reads 0 in the census and the report says, in its own output,
    that this is NOT CHECKED rather than none. `LowerOptions` does not carry
    `npmStatic`, so the build-level refusal cannot be evaluated at that layer.
    A measured-looking zero from a check that never ran is the defect this
    block retracted a finding over; the report refuses to print one.
  * An attributed file with no census row is counted in C but in NEITHER
    cacheable nor refused, so `C_reachable` is reported as a lower bound
    rather than being silently dropped into one side.

**Provenance of this table.** It was re-derived while banking the block, by
running `census-weight.mjs` over the stored artifacts
(`census5-attrib.jsonl`, `census5-census.txt.modules.tsv`, T from
`census5-T.txt`), and it reproduces the block's reading exactly. That is
arithmetic over a stored log, not a new measurement.

**And T is a draw, not a value.** The run's own log records 31 node processes
at launch, which is not a quiet box. The IMMEDIATELY PRECEDING run of the same
script on the same tree at the same recorded process count read **402.2 s** --
12.8% above 355.6 s, both cold (the script deletes its cache directory each
time). So the spread on T is at least 13% here, and the 57.2% is the column
that survives it. That is the block's own conclusion arriving one more time,
from its own logs.

## 2. The ratio governs, and it was declared before the number existed

C/T across the compilers this was measured on:

    compiler                            entry      C        T       C/T
    pre-walkfuse   229184b35            380.7s   299.4s   895.4s   33.4%
    post-walkfuse  147496b5a8  p1        20.4s   232.0s   402.1s   57.7%
                               p2        23.3s   268.5s   445.3s   60.3%
    intermediate, pre-formatting-fix      3.2s   238.6s      --       --
    + type formatting  b6a763983          2.7s   203.5s   355.6s   57.2%

T fell from the 936 s the threshold was written against to 355.6 s. The ratio
did not follow it down. Once the entry stopped dominating, C/T settled in the
high fifties and stayed: 57.7% and 60.3% on two passes of the post-walkfuse
compiler, 57.2% two compilers later. That is three readings over two compilers
plus an intermediate tree whose T was not preserved in the surviving logs -- so
that row carries a C and no ratio. It is included because its C is the one
`collect-split.mjs` got wrong (section 10, defect 7).

**The cuts landed on the ENTRY, not on library lowering.** 380.7 -> 21.9 ->
2.7 s, a 140x reduction in the part a per-module fragment can never reach,
against 299.4 -> 203.5 s in the part it can. `phi = 0.120`: of the 407.9 s
walkfuse removed from attributed lowering, 88% came out of the entry and 12%
out of the cacheable remainder. walkfuse and the fragment are strongly
COMPLEMENTARY -- walkfuse cheapens precisely what a per-module cache cannot
touch.

**Why an absolute threshold would have been wrong three times.** The bar was
first written as 120 s of wall on an edited-entry rebuild. Restated as a
ratio, 12.8% of T, BEFORE any C existed, and the restatement is the reason the
decision is readable at all:

    at T = 936 s    absolute 120 s = 12.8% of T    ratio 12.8% = 120 s
    at T = 360 s    absolute 120 s = 33.3% of T    ratio 12.8% =  46 s

The two forms disagree by 2.6x at the T that actually arrived. The original
tie-break ("if T exceeds the 936 s reference by more than 10%, the ratio
governs") was scoped to LOAD INFLATION and did not cover a T far BELOW the
reference; by its letter the absolute would have governed. It was REPLACED
rather than stretched, and the replacement weakens the bar in absolute terms
(46 s where it was 120 s), which is said plainly because choosing the more
permissive form after seeing which way the number went would be the whole sin.
It was declared with no C measured against it. It is also not a no-op: on a
synthetic case built to make the two forms disagree (C = 60 s of a T = 360 s
build) the ratio returns PASS where the absolute returns FAIL.

The same instability is what makes the ratio the right column generally. Two
archived profiles of the SAME compiler under a 1.68x load difference move C
from 317.3 s to 543.6 s -- a 71% swing that crosses any absolute threshold --
while C/T moves 39.9% to 40.7%.

## 3. The identity theorem: a fragment is identifiable without positional ids

A fragment is the PRE-CROSS-MODULE product of one module. Lowering answers one
`IrModule` for the closed graph and every pass that rewrites shared layout runs
after the last body is down, so a fragment is not a compiled unit and never
becomes one; the cross-module passes are replayed on every build over the
assembled whole. Measured, those passes mint no positional ids at all, so
replaying them cannot perturb the id space they run over.

Three rules, each asserted somewhere rather than only stated.

**Rule 1 -- a fragment owns no collection id.** Collection runs before any
body, as one whole-program phase, and mints 57.3% of all positional ids
(3,210 of 5,598 on app182). Those belong to no module: they are REPRODUCED on
every build, never replayed. A fragment owning one would mint the entity twice
and renumber everything after it, in a program that still validates.
`assertFragmentOwnsNoCollectionIds` throws, and it shipped WITH the identity
layer rather than after it, because the failure it catches arrives months
later in somebody else's commit.

**Rule 2, as the block finally stated it -- NO ID IS STORED AS AN IDENTITY,
AND IDS DO APPEAR AS LOCAL REFERENCES THAT THE FRAGMENT'S DICTIONARY
RESOLVES.** The first spelling of the rule was "no positional id is stored as
a literal", and that spelling made the fragment UNREPLAYABLE: `SymbolicMint`
carried a `structure` but no `localId`, so nothing mapped an `r3541` inside a
stored body to what it means. The bodies are the module's real IR and are full
of ids; the whole mechanism of replay is that every one of them is resolvable
from the fragment's own dictionary, and the dictionary had no keys. The
identity is the STRUCTURE; the ids are a local alphabet the dictionary
translates.

This defect was not visible from reading the type. It appeared the moment
something had to CONSUME the fragment -- which is why the controls were
written before the producer existed, and found it.

**Rule 3 -- nothing a later pass rewrites is stored.** `ownmask`, `reqabsent`
and `srcproto` are outputs of `armOwnMasks`; they are excluded from the
structural form, and `SHAPE_FIELD_ROLE` / `UNION_FIELD_ROLE` are
`Record<keyof T, ...>` so adding a field to `IrRecordShape` without
classifying it is a TYPE ERROR rather than a silent omission.

**Why expansion and not `ShapeRegistry.keyOf`.** `keyOf` spells a nested type
as `record:r3541`, so a key built from it is structural exactly one level
deep. The block's first cross-build comparison used it and produced a
confident wrong answer: one extra shape minted early shifted every nested
reference below it, and 28 identical entities compared as absent in each
direction -- symmetric, plausible, and meaningless. The form now expands until
nothing below the top level carries a number, with cycles cut by a De
Bruijn-style back-reference so a recursive shape has one spelling.

## 4. The structural form and its two guards, which are a pair

`assertNoIdLeak` proves no positional id got INTO a form. The collision check
proves no two distinct entities came OUT of one. Both failures are fatal and
they fail in opposite directions:

    a leaked id   two builds of the same source miss forever. Slow, visible
                  eventually, ships nothing wrong.
    a collision   the dictionary maps two different entities onto ONE id at
                  assembly, so a value of one shape lands in another shape's
                  slot. No diagnostic, no build failure, and it ships.

**The colliding case is REAL and is documented in `ShapeRegistry.recIds`.** In
the registry's own words: "two INDEPENDENT structurally identical recursive
declarations intern as distinct shapes, so values of one fence at the other's
slots with the ordinary shape-mismatch diagnostic". Per-declaration identity
is DELIBERATE -- tsc admits the assignment, the exact-shape stance reports it,
and that is the documented v1 width/assignability consequence. So two ids that
are structurally equal are a thing this compiler MEANS, and `structuralForm`
cannot see the difference, because what separates them is the declaration site
and not the structure. A form that collapsed them would put a value of one in
the other's slot with no diagnostic.

All 11 refusals in section 1's census are this case.

`assertNoIdLeak` is deliberately NOT an enumeration of type kinds. Writing the
walk proved why: `array`, `map`, `set` and `promise` were handled and
`weakmap`, `generator`, `asyncGenerator` and `func` were NOT -- four kinds
carrying a nested `IrType` that would have JSON-stringified a literal shapeId
straight into a form whose entire purpose is to contain none. All eight are
handled now, but the DEFENCE is the assertion, which scans the produced form
for a positional id and throws. It catches the kinds nobody remembered,
including ones added after it was written. The same choice is made by
`fragmentUnresolvableIds`, which scans the serialized bodies with a regex
rather than walking `IrExpr`: a walk enumerates node kinds and enumerations of
the input go stale.

    GUARD THE PROPERTY OF THE OUTPUT, NOT THE COMPLETENESS OF THE INPUT.
    A list of cases is a claim about what exists today; an assertion about
    the product is true as long as the product is.

Opaque forms are counted separately and count harder: a form that reached an
unresolved placeholder is less discriminating by construction, so two of them
colliding is the likeliest way this fires. Reporting them apart makes the
reason legible instead of inferred. On the real build, 0 of the 11 were
opaque.

Both guards are controlled in both directions. `assertNoIdLeak` fires on a
leaked shapeId and on a leaked unionId and is silent on a clean form. The
collision check reports nothing on a sound fragment, catches a forced pair of
distinct localIds sharing one form, catches a collision ACROSS two
dictionaries, and reports an opaque collision AS opaque.

## 5. Fail closed, named as a property

    A cache can be wrong two ways and only one is tolerable:
    missing a hit is COST, serving a wrong hit is CORRUPTION.

Every refusal becomes a MISS. The fragment is unusable, the module re-lowers,
nothing incorrect ships.

The form-collision guard is the PRECEDENT and it is the hard case, because it
refuses a situation the compiler DELIBERATELY creates rather than widening the
identity to accommodate it. Widening the form with a declaration discriminator
would let those modules cache too, and is deliberately not done: a
discriminator is a second identity, and a second identity is a second thing to
get wrong. The moment to propose one is with a measurement of what NOT having
it costs, argued separately and in daylight -- not folded in beside a guard
where it would read as an implementation detail. No future decision about
fragments should land on the other side of that line.

`--npm-static` builds follow the same precedent and are REFUSED outright
rather than witnessed (section 7).

Every refusal is counted by CODE, never by parsing a message. The codes are a
closed union bound to a runtime array in BOTH directions -- the `Record` forces
the array to cover every member, the union type forces every entry to be one --
so a refusal added later gets its own bucket automatically instead of
disappearing into an "other" total. Every code is present at zero in a fresh
census, so a zero is a MEASURED zero and not an absent key. A module refused
for several reasons counts under EACH, so the per-code numbers sum to at least
the refused total rather than partitioning it; the report says so in its own
output, because a reader who assumes they partition will mis-add them.

## 6. The tail is a reproducible suffix, so a re-mint is a replay

`SCRIPTC_MINT_ORDER` logs each minted shape and union id with the PHASE that
minted it and its structural key. On app182, 5,598 ids in the emit pass:

    collection            3,210   57.3%   one whole-program phase, before any body
    file bodies + inits   2,283   40.8%   198 files
    tail (queue drains)     105    1.9%

The structure is what decides it, not the sizes:

    201 (loop, file) phases, 201 runs        CONTIGUOUS -- one unbroken run each
    last body mint 2226, first init 2227     the two loops do not overlap
    first tail id at 5,493 of 5,598          the tail is a pure SUFFIX
    tail shapes r3541..r3607 (67), unions u1952..u1989 (38)   contiguous TOP ranges

Top-contiguous is stronger than suffix: suffix is a statement about the
interleaved sequence, top-contiguous is a property of the counters. Nothing
below those watermarks can move, by construction.

**And the tail survives an entry edit.** Base against an entry whose bytes are
the base entry's plus a block that mints a shape, a lambda and two interned
helpers:

    tail entities            base 105   pert 105
    distinct expanded keys   base 105   pert 105
    in base, ABSENT from pert   0
    in pert, absent from base   0
    shared entities  105        ORDER STABLE

So a re-mint that replays each fragment's recorded mint sequence in
`moduleOrder` -- body groups, then init groups -- reproduces today's numbering
exactly. No renaming, no canonical tail ordering, and the ten test files that
assert on positional ids would stay untouched.

The comparator asks **COUNT BEFORE ORDER**, because the two failures are not
the same severity: an entity present in base and missing from the perturbed arm
means the two builds produced different PROGRAMS, and ordering is not worth
discussing until the counts agree. It prints DISTINCT EXPANDED KEYS beside the
entity count so a key collision cannot fake agreement, and it is shown to
discriminate on both axes (swap two adjacent tail entries -> ORDER MOVED; drop
one entity -> 1 ABSENT, DIFFERENT PROGRAM).

What this does NOT show: it measures an entry edit with every module still
lowered, not a partial re-lowering with libraries replayed from fragments,
which cannot be measured until fragments exist. What it establishes is that
the tail's entity set and order are a function of the library CALL SITES
rather than of the entry's content -- the property a fragment needs -- and it
leaves the fragment owing an ordered record of each module's queue
contributions.

Two zeros here are CONTROLLED. `tail:lifted 0` and `tail:passes 0` say the
cross-module passes and the lifted-function push mint nothing.
`SCRIPTC_MINT_CONTROL=1` mints a throwaway shape at each of those two phases;
both buckets go 0 -> 1, so the phase markers are live there and the zeros are
measured rather than mechanical. The control caught a real defect on its first
run, though not the compiler's: both hook calls had silently failed to apply
because `lowerer.ts` is CRLF and the patch used LF, so the buckets could not
have moved whatever the compiler did.

`setMintPhase` now ASSERTS the shape on every build -- collection precedes
every body, each `(loop, file)` phase is entered exactly once, nothing mints at
an earlier stage after a later one begins -- and throws with a message naming
the consequence. Breaking the invariant does not fail on its own: it
RENUMBERS, and a renumbered fragment emits a valid program that is not the
program. So the check has to be the thing that fails. One `Set` lookup per
phase change.

## 7. The blind-spot class, which is the most transferable thing here

    A CONSULTATION WHOSE NEGATIVE OR ABSENT ANSWER CHANGES BEHAVIOUR LEAVES
    NO TRACE IN THE PRODUCT, BY CONSTRUCTION.

The product records what HAPPENED, and this class is defined by nothing having
happened. A key consulted without effect, a registry that answers "no" and
diverts, an option read that turns a pass off.

This matters because the rest of the witness is derived FROM THE PRODUCT and
not from the producer. The obvious way to capture what a module consumed is to
instrument every place the Lowerer consumes something -- a dozen call sites,
each of which has to be found, and each of which a later change can quietly
stop going through. The finished IR already SAYS which shapes a module
references, which helpers it calls and which ids it minted, so the witness is
read back out of it, and a consumption site added tomorrow is captured for
free. The predicted cost of the product-side approach was "a dozen places in
Lowerer state". The ACTUAL cost is ONE, and it is the one a product cannot
show: the overflow grant's "asked, and answered NEITHER".

The grant answers granted, denied, or neither, and all three are stored. A
fragment recording only the grants would replay happily into a build where a
key that was previously neither has since become DENIED, and the shape would
carry an overflow the program must not have. The recording happens BEFORE any
early return; recording after would capture only the keys that got a positive
answer, which is the same defect as storing only the grants.

**Two consequences.**

**`SCRIPTC_CACHE_VERIFY` is the ONLY defence against this class**, and that
raises what it has to be. A verifier run on builds that opted in catches the
case somebody already suspected. The case it must catch is the negative
consultation nobody remembered to witness six months from now -- and nobody
will be looking on that build. It has to run over the WHOLE CORPUS,
REGULARLY, not on demand. Sizing it for that is cheaper than discovering later
that the architecture will not carry it. Verification is per FIELD and one
level into the witness: it takes the union of both sides' own keys at both
levels rather than a list somebody remembered to extend, because the witness
is exactly where a field gets ADDED. The mutant test mutates every top-level
field and every witness field INDIVIDUALLY and requires each to be named in
the output -- a whole-record mutant is caught by any coarse check and proves
nothing about granularity, which is the only thing that mode exists to prove.

**Candidates are findable even though completeness is not.**
`tests/perf/libcache/blindspot-scan.mjs` lists every consultation of a
module-level registry in the frontend. 25 sites over 21 registries:

    8  constant tables (DYN_DISPATCH_METHODS and friends) -- part of the
       compiler dist, already in the key
    3  this block's own instruments
    6  memos whose negative answer only means "compute it"
    2  the overflow grant -- witnessed, all three answers
    2  NOT WITNESSED: rewrittenPaths and offenders, both npm-static.ts

An unbounded class narrowed to two things to read. That is what a scan is for;
it is not a proof and is not offered as one.

**The scan's own first cut is the warning label.** It looked for a NEGATIVE
test -- `!x.has(`, `x.get() === undefined` -- and reported ZERO, with the
overflow grant sitting in range. The grant is spelled as a positive early
return and a ternary. The negative answer was never a syntactic form; it is
the OTHER branch of whatever form the author chose, and there are unboundedly
many forms. So the scan now reports every consultation of a long-lived
registry and lets the reader classify, and it carries a positive control that
FAILS the run if the known instance is missing from its own output. A scan
that cannot find the case you already know about is not calibrated, and its
zero means nothing. (It also counted 222 registries before restricting to
column 0: a function-local `Set` is not the hazard, because its contents derive
from the code being lowered and therefore DO show up in the product.)

**And the two remaining sites are closed by REFUSAL, not by witnessing.**
`rewrittenPaths` and `offenders` are whole-program REWRITE STATE, which is
precisely what a PER-MODULE fragment structurally cannot represent.
`--npm-static` builds are refused outright, once per module so the census
counts them in the same units as every other refusal. The cost was checked and
controlled rather than assumed: `--npm-static` / `npmStatic` appear 0 times
under `tests/perf/zapo-rest` and 0 times in any block build script on disk,
while the control search for `--provenance-sources` over the same paths finds
5 -- and `CompileOptions.npmStatic` is optional with no default and is assigned
only from the CLI flag, so there is no implicit path that turns it on.

## 8. What was NOT built, and the order to build it in

In order, if anyone returns to this:

 1. **The serializer.** Write a fragment and read it back. The identity layer,
    the dictionary, the witness and all four guards already exist and are
    tested; nothing writes one to disk.
 2. **Assembly.** Load fragments, re-mint in `moduleOrder` (body groups then
    init groups, per section 6), replay the cross-module pass chain over the
    assembled whole, validate, emit.
 3. **Wiring into `compile()`**, beside the early cache, whose two whole-build
    fingerprints the fragment key already inherits.

The keying deliberately inherits those fingerprints plus this module's probes
and witness, rather than listing "things that should invalidate": an allowlist
is written from what its author remembered, and the next instrument added is
the one not on it.

Also not done, and deliberately: the declaration discriminator that would make
the 11 form-collision modules cacheable (section 5), and any witnessing of
whole-program rewrite state (section 7).

One thing the census is NOT valid for. Every refusal code it counts is
structural, and none of them reads `helpersReused`, `edges` or `probes`; those
are left empty, so the census is exact for the classes it counts and would NOT
answer "can this fragment be replayed", which needs all three.

## 9. Why it was stopped

**The prize halved in absolute terms while the risk stayed fixed.**

    at the design's reference   33.8% of 936 s  =  316 s   CEILING
    as finally measured         51.9% of 355 s  =  185 s   DELIVERED

Those two are not the same quantity and the comparison is worth stating twice,
because mixing them is this block's own error family. 33.8% was a CEILING --
non-entry attributed lowering, before any census -- and 51.9% is what survives
the census. Ceiling against ceiling the fall is 316 s -> 203.5 s; delivered
against delivered cannot be computed, because nothing measured the delivered
figure at the old T. Either way the prize roughly halved.

The payoff is a fraction of a SHRINKING total. The risk -- a permanent surface
whose failure mode is a silently wrong binary -- does not shrink with it. Every
perf win that lands makes this cache less worth having, and three landed during
the block's own life: walkfuse, the two lowering caches, and the type-formatting
fix. T went from the 936 s reference to 355.6 s across them -- how much of that
belongs to each is not measured here. The fragment's case was
strongest at 15.6 min, is weaker at 6, and the formatting fix made it weaker
again because that work sits INSIDE the library lowering a fragment would
cache.

**And what remains to build is the wrong half.** What exists VERIFIES: the
structural form, the two guards, the witness, the census, the refusal codes.
What is missing DECIDES REUSE: the serializer, the assembly, the invalidation.
Correctness bugs live in the deciding half. The block built the half that can
only ever produce a miss and stopped before the half that can produce a wrong
hit.

The bar PASSES by 4x. It was stopped anyway, with the number, not for want of
one. That is the honest shape of the decision and it should not be re-litigated
by rediscovering that 51.9% clears 12.8%.

## 10. The measurement defects found in one day

This is the strongest available argument about what the unbuilt half would have
produced, and it is the section most likely to be useful to somebody working on
something else. Every one of these was in an INSTRUMENT, not in the compiler;
all but one were found by a control, and the one that was not was found because
a number was too large to pass over.

**The family: a right measurement carried past its scope.**

 1. **`?? 0` and the defaulting entry.** A branch without `%discovery-collect`
    has no such key, and `?? 0` reported `0.0s` for it -- a value that was
    ABSENT presenting itself as MEASURED, with the decision hanging on it. The
    same shape, worse, in the entry lookup: entry-not-found would have silently
    made C the WHOLE attributed total, which is the most optimistic answer the
    rig can produce, from no data. Both readers now distinguish NOT TAPPED
    from zero, and the entry is a required argument whose unmatched pattern
    REFUSES.
 2. **"The heaviest attributed file IS the entry."** True in the data the
    reporter was written against, false in the data it was written for.
    walkfuse cut the entry 17x, so on the new arm the heaviest file became a
    LIBRARY (`spec/proto/index.js`) and the reporter subtracted IT as the
    entry: the entry's cost stayed inside C and a library's was removed from
    it. C read 193.6 s where it is 250.3 s -- understated by 23%. Worth more
    than the fix: a DERIVED IDENTITY drew less suspicion than a derived number
    would have. A number gets checked; an identity gets read as a definition.
    The fix is a NO-OP on the arm the heuristic was valid for (296.4/302.4
    unchanged) -- a correction that moved the arm it was already right on
    would have been a second bug, and nearly nobody checks that.
 3. **The census counts MODULES; the decision is in SECONDS.** Controlled on a
    case built to make them disagree -- two cheap modules cacheable, one
    expensive module refused:

        modules cacheable   66.7%   of modules
        C  reachable        20.0%   of C
        C_reachable/T        5.6%   -> FAIL

    A module-count report would have said 67% and read like a pass. The
    weighted one fails by a factor of three. It is not a small gap on this
    program either: one library file was 220 s of 1156 s attributed, so a
    handful of refusals among the expensive modules can cost more than a
    hundred cheap ones.
 4. **Nothing checked that the attribution and the census came from the SAME
    build.** The existing warning covered attributed-without-census, which is
    the direction that does NOT indicate a mismatched pair. A census row
    naming a module the attribution never saw is the one that does. Below half
    overlap the tool now REFUSES to print a verdict rather than printing a
    weaker one. Controlled both ways: matched pair exit 0, mismatched pair
    exit 2.
 5. **A DAG walked as a tree, OOM at 4 GB.** `structuralForm` expanded a shape
    referenced from N places N times, and zapo's protobuf unions exhausted the
    heap: the census could not run at all. This is the same defect walkfuse
    fixed in `canDynCheckTo` and the same unbounded expansion the
    type-formatting fix bounded at 37.67 GB of string -- three independent
    instances on one program, one of them written AFTER reading both of the
    others. The memo that fixes it is CALLER-OWNED, never module-level,
    because an id means nothing outside the registry that minted it; and only
    PATH-INDEPENDENT forms are cached, because `%back(k)` counts depth from
    where the walk entered.
 6. **A backwards global tag parse.** File tags are `%m<i>.` per module and the
    EMPTY STRING for the entry, so `/^%g\.([^%]*)/` captured `""` on
    `%g.%m12.exports` -- which resolves to the ENTRY's tag, so every module
    global was attributed to the entry -- and captured `"exports"` on
    `%g.default`, which resolves to nothing, so every ENTRY global was reported
    unplaced. 1,014 unplaced globals was the only reason it surfaced; the
    number was too large to pass over. Now 0.
 7. **`collect-split.mjs` STILL inferred the entry from cost.** Defect 2 was
    found and fixed in `attrib-decide.mjs` and LEFT HERE, because the
    correction was filed under the tool it was found in instead of under the
    property it protects. It then failed the same way, worse: with the entry
    nearly free (3.2 s of 241.7 s attributed) the heaviest attributed file is a
    library at 105.4 s, and C read **136.3 s where it is 238.6 s -- wrong by
    43%, in the direction that makes the cache look WORSE.**

**And four more in the same day, in the tools rather than in the readings.**

 8. **A log read with an instrument that postdates it.** A finding was
    published and RETRACTED: 373.9 s of a 443.9 s discovery pass "attributed to
    no file", which would have cut the design's ceiling from 33.8% to ~19%.
    The log predated the five-bucket tap it was read with; the older format
    wrote per-file buckets UNPREFIXED, and on this machine an unprefixed
    absolute path starts `G:/`, indistinguishable from the `G:` emit-generic
    prefix. 350 emit buckets parsed as generic-instance buckets and the
    "unattributed" remainder was an artifact of the parse. The 33.8% stood.
 9. **A mutation harness reporting NOT-APPLIED as SURVIVED.** Mutations were
    passed as Python inside a bash heredoc, so escapes crossed two parse
    layers; three silently failed to apply and were reported with the same word
    the harness uses for "the property is not pinned" -- two different facts
    under one label, in the tool whose only job is telling them apart. It also
    died mid-loop without restoring, leaving `if (true) return [];` planted in
    `fragment.ts`, and the next run read BASELINE RED, which looks like a
    regression in the suite rather than wreckage from the harness. A tool that
    edits the tree has to put it back even when it fails, or its next failure
    is a lie about the code instead of about itself.
10. **An exit code read through the wrong process.** A control read `$?` after
    a pipeline and got `tail`'s status, not node's, and so read 0. A control
    read through the wrong process is the same class as the thing it controls.
11. **A patch that could not have applied.** Two hook calls silently did not
    land because `lowerer.ts` is CRLF and the patch used LF, so the buckets
    could not have moved whatever the compiler did. Found by the control, which
    is the point of keeping one that perturbs the program by design.

**And one found while banking the block, recorded under the same rule.** The
gate that bound this branch to its built artifact aborted on its first live run
over `structuralForm`: expected 25, dist had 28. The counter was right and the
EXPECTATION was wrong -- it had been derived with `rg -c`, which counts
matching LINES, not occurrences. Two independent counters agree at 28. The
binding has now said "no" once, for a real reason, which is the only thing that
distinguishes it from a check that cannot fire.
