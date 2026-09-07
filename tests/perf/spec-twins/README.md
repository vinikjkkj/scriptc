# provenance spec twins — the monorepo-subpackage blind spot

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

## What the cost actually is

Selecting by reference is NOT a speedup on these drivers, and an early guess
that it would be was wrong. `proto` is 1.87 MB of the 2.33 MB and looked like
pure waste; excluding it by hand cuts store-sqlite from 489.7 s to 128.2 s —
and **reintroduces three `WaClient` blockers** and collapses the reached
statement count from 46,963 to 1,557. `proto` is referenced. Both candidates
select it. The 8.1x is the cost of compiling the spec surface these drivers
genuinely use, not waste to be trimmed.

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
