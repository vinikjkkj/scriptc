# provenance spec twins — the monorepo-subpackage blind spot

> **This is not a speedup, and "surgical fix" is a misleading name for it.**
> Both candidate mechanisms select all five spec modules on both drivers
> measured -- the same five the blunt directory walk selects. There is nothing
> to trim. The 8.1x is what compiling the spec surface these drivers genuinely
> use costs. What the change buys is a selection that is correct PER DRIVER and
> adapts, not a smaller one. Read the finding, not the label.

## What was wrong

`provenanceDeclSiblings()` walked `join(d, "spec")` for each registered
`packageDirs` entry. For a monorepo SUBPACKAGE `pkg.dir` is the subdirectory
inside the attested tree (`<tree>/packages/store-mongo`), while the shared
`spec/` sits at the tree ROOT — so the walk looked in a `spec/` that does not
exist, and every consumer reached through that subpackage refused at each spec
reference with *"ships only a declaration file"*, while the SAME tree entered
through its root package compiled.

Measured directly, before the fix:

    @zapo-js/store-mongo@1.2.0
       dir: ...\prov\9a49e1fffdec...\packages\store-mongo
       spec exists: FALSE

All five spec modules have `.d.ts` + `.js` twins at `<tree>/spec/`:
abprops (398 KB), appstate (32.6 KB), version (221 B), mex (29.9 KB),
proto (1.87 MB).

Natural experiment across the 0907 artifacts: **44 declaration-file sites
(4 of them reached blockers) on all three subpackage drivers** (mongo, sqlite,
redis) and **0 on `store-memory`**, the one driver that resolves zapo-js as a
ROOT package — and which compiles 30,690 statements into a matching binary.

## The fix: select by REFERENCE, not by presence

A directory listing cannot tell a referenced spec module from an unreferenced
one. The prescan closure in `provenance.ts` (`bareImportsWalk`) already walks
the attested tree's relative-import graph before the program loads, and already
*sees* declaration edges — it just declines to enqueue them. Recording the `.js`
twin at that point costs one `stat` per declaration edge and no extra traversal.

Roots are fixed before `ts.createProgram`, and `declTwinOf` resolves the twin
IN THE PROGRAM, so referencedness cannot be decided in the pass that needs it.
The prescan is the earliest pass that knows an edge was taken.

## Two candidates, measured against each other

| | mechanism | cost |
|---|---|---|
| **scan** (shipped) | record the twin when the prescan closure takes an edge to a `.d.ts` with an implementation beside it | rides a walk that already happens |
| **twophase** (oracle, retained) | build the program, ask which declarations it loaded, rebuild with those roots | a second full `ts.createProgram` |

They selected the **identical five twins on `store-sqlite` and on `store-redis`**.
The scan follows relative and alias edges only, so it can in principle miss a
declaration the checker reaches another way; `provenanceSpecTwinsInProgram` is
kept reachable so a new driver can be re-validated against the exact answer:

    SCRIPTC_PROVENANCE_SPEC_TWINS=twophase   SCRIPTC_PROVENANCE_SPEC_WHY=1

## Why the scan lives in provenance.ts and cannot move

The ts7 adapter (`frontend/ts7/adapter.ts`) DELIBERATELY does not re-export
`ts.preProcessFile` or `ts.createSourceFile` ("no client-side parser in 7; the
npm.ts edge scan keeps 5.9.3 (island)"), nor `ts.resolveModuleName` /
`ts.resolveTypeReferenceDirective` ("resolution helpers stay 5.9.3-hosted for
now ... tsgo resolves the embedded program itself, server-side"). Its header
lists these as the survey's MISSING set, by design, and no scriptc source may
import `typescript5` outside the sanctioned island files.

So a module-specifier scan is NOT freely implementable anywhere in the
frontend. It is possible here only because `provenance.ts` is already one of
those island files AND already runs the closure walk it needs
(`bareImportsWalk`, the bare-import prescan) before the program loads. The scan
adds no new machinery, no new parser, and no new boundary crossing -- it reads
an edge the existing walk already resolves.

If someone later moves provenance resolution off the island, or replaces the
prescan with tsgo-side resolution, THIS SCAN GOES WITH IT and the two-phase
oracle below becomes the only available mechanism.

## What the cost actually is

Selecting by reference is NOT a speedup on these drivers, and an early guess
that it would be was wrong. `proto` is 1.87 MB of the 2.33 MB and looked like
pure waste; excluding it by hand cuts store-sqlite from 489.7 s to 128.2 s —
and **reintroduces three `WaClient` blockers** and collapses the reached
statement count from 46,963 to 1,557. `proto` is referenced. Both candidates
select it. The 8.1x is the cost of compiling the spec surface these drivers
genuinely use, not waste to be trimmed.

## store-mongo: it DOES terminate, and the fix helps it

An earlier draft of this file said store-mongo's armed analyze "does not
return". That was wrong -- it was written while the run was still going, from
runs that had been killed or were being sampled mid-flight. It completes.
Corrected, on a contended host:

  * OFF (pre-fix):  1,692 sites, 242 blockers,  3,131 statements / 149 failed
  * ON  (this fix): 1,543 sites, 238 blockers, 48,563 statements / 147 failed

Reached statements go up 15.5x and all four declaration-file blockers close;
"ships only a declaration file" appears zero times. What it costs is wall
clock: the armed analyze took about 26 minutes against roughly 84 seconds for
the off arm, both under a four-load machine, so both figures are contended
floors and the RATIO is the only part worth quoting until someone re-measures
quiet.

store-mongo still reaches no binary, in either arm. Its remaining 238 blockers
are, by attested tree:

    mongodb   167     (387b6dd2...)
    bson       59     (302f96e9...)
    other       9
    driver      3
    zapo core   1     (9a49e1ff...)

226 of 238 are mongodb's and bson's own sources. We do not fully compile the
mongodb driver -- that is unchanged by this work and is the next wall on that
driver, not something this fix was ever going to move. What DID move is zapo's
side: one blocker left in the attested zapo tree.

THE ESCAPE HATCH IS VERIFIED, on store-mongo itself:

    SCRIPTC_PROVENANCE_SPEC_TWINS=off

restores the pre-fix behaviour exactly -- 1,692 sites, 242 blockers,
3,131/149 statements, 0 added / 0 removed against the pre-fix revision. The
single raw textual difference across all 1,692 sites is a checker-internal
unique-symbol serial inside one SC2020 message (`__@kDecoratedKeys@354` vs
`@1962`) on an `unreached` site; scrubbing those serials makes the two runs
byte-identical. That is a program-construction artifact, not a behaviour
change. Anyone who wants the fast diagnostic answer back on store-mongo has
it, exactly.

## Arms

    spec-twins-ab.ps1 -drv store-sqlite -arm off      # NULL arm: must be
                                                      # site-for-site identical
                                                      # to the pre-fix revision
    spec-twins-ab.ps1 -drv store-sqlite -arm on       # shipped default
    spec-twins-ab.ps1 -drv store-sqlite -arm twophase # exact oracle

`sites-diff.mjs a.json b.json` reports added/removed sites, grouped by message.
A harness that cannot report "nothing changed" cannot be trusted when it
reports a change — the `off` arm is that check, and it is why the numbers below
are attributable to the selection and nothing else.

`build-drv.ps1` is the build-level arm: `analyze()` stops before the IR
validator and before both emitters, so a closed site count is not a build.

## Results (npm lane, `napp/drivers/*.ts --provenance-sources`)

Compiler at the commit that adds this directory; build node v22.18.0, gate node
v25.9.0, zig 0.16.0, `SCRIPTC_TARGET=x86_64-windows-gnu`, `SCRIPTC_CC=zigcc`.
`store-mongo` resolves its own attested v1.8.0 core @ `9a49e1fffdec`, not 1.8.2.

See the block report for the per-driver table.
