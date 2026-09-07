
### Three figures for `wam` that must not be inherited

Two came from the standing queue and one from reading this survey's own table.
All three are wrong, and the third is the one worth dwelling on.

| figure | where it came from | measured |
| --- | --- | --- |
| "14 interface-receiver dispatch sites" | `statementsFailed: 14` in `sites-prov-7080/wam__index.json`, a **statement** count read as a site count | **69** sites, one file, 69 distinct lines |
| "`wam` has zero compiler-gap blockers" | true of the provenance lane at `5d0e8427`, where `SC1090` really was 0 — provenance did not reach `synthetic/fabrications.ts` then | **86** blocker sites, `86 errors.`, no binary |
| "82 roots means 82 distinct problems, not one spreading" | this survey's own roots/cascade column | **false.** 82 roots, but **12** distinct messages, and **69 of the 82 are one message in one file** |

The third is the trap the roots/cascade split cannot see. `SC2004` is the
compiler's cascade marker, so a survey that splits roots from cascade will call
anything else a root — and the 69 `commit` sites are `SC1090`. They are
nonetheless downstream: `WaWamCoordinator`'s own declaration failed to compile
on the older core, so no compiled declaration with a body resolved at any of the
69 call sites. Compile the **same wam source** against zapo-js 1.8.2 and 86
sites become **15**, the 69 become **0**, and reached statements go from 1,462
to 48,022 with failures from 76 to 10.

**A cascade that does not carry the cascade code is invisible to the split.**
The only thing that found it was compiling the same source two ways. Any
"roots = independent problems" reading of this document, or of any coverage
survey, is unsafe for exactly that reason.
