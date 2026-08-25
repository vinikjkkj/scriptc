# prov2 — the two provenance path defects, measured

A **measurement** harness for the two defects `tests/perf/mediavoip/`
located: `--provenance-sources` could map no `zapo-js` subpath, and it
never engaged for a type-only import. Nothing here runs in the gate;
`tests/perf/` is excluded from the directory gate and no vitest file
imports any of it. The gate-visible pins for the same two defects live in
`tests/harness/provenance-dist-esm.test.ts`.

## Two lanes, and why both are here

`mediavoip`'s survey ran the **default** static lane (`analyze()`, no
flags) and found 234 unique sites over 40 modules. Both defects live
behind `--provenance-sources`, so **the default lane cannot move** — and
that is a claim worth measuring rather than asserting. `results/`
carries both lanes for both compilers:

| directory | compiler | flags |
| --- | --- | --- |
| `results/sites-base-default/` | main | none |
| `results/sites-branch-default/` | main + both fixes | none |
| `results/sites-base-prov/` | main | `--provenance-sources` |
| `results/sites-branch-prov/` | main + both fixes | `--provenance-sources` |

`harness/compare.py` diffs two sweeps by unique site after normalizing
the lab and compiler-tree roots out of the paths, and says **NO
DIFFERENCE** out loud when there is none — which is the whole point of
running the default lane twice.

## The mapping census

`harness/map-census.mjs` calls `resolveProvenanceSources()` and nothing
else. It records, per module, every specifier that mapped and **the
absolute file it mapped to**, plus whether that file exists. It runs in
milliseconds where a full provenance `analyze()` runs in minutes, and it
measures exactly the step both defects live in.

`harness/mapdump.py` collapses a census to a `specifier -> file` table
and reports any specifier that resolved to MORE THAN ONE file — the
shape a bad path heuristic produces.

`results/census-subpaths.json` is the census of `harness/all-subpaths.ts`,
which imports all fourteen code subpaths `zapo-js` exports plus one it
does not. It is the negative control: thirteen subpaths and the root must
each name their own source twin, and `zapo-js/does-not-exist` must map to
nothing and be named in a note.

## Self-test

`harness/validate.py` refuses to call a sweep directory usable unless
every expected module has both a log that reports and a JSON that parses
with an analysis in it. A sweep that exits 0 having written nothing is
indistinguishable from a module with no diagnostics; this is what tells
them apart. It was armed by sabotage — a deleted JSON, an unparseable
JSON, a timed-out log and a missing module — and reported all four.

## Reproducing

The sweep needs a lab app outside the repo holding the three package
sources under `pkgs/<package>/` (the packages' `src/` trees, flattened one
level) plus their installed dependencies. `harness/lab-package.json` and
`harness/lab-tsconfig.json` are that app's two files.

**The tsconfig is not optional.** `program.ts` resolves the project's real
`@types/node` only when a tsconfig was found (`loadProgram7`:
`config.configFile ? resolveNodeTypes7(...) : null`), and forces
`skipLibCheck` only in that case. Without one, the sweep runs against the
fallback declarations and reports 318 sites instead of 235 — 83 of them
`SC0001` duplicate-identifier noise out of `@types/node`'s own `.d.ts`
files, which looks exactly like a compiler regression.

```sh
. harness/env.sh
bash harness/sweep.sh "$BASE" "$LAB/sites-base-default"
bash harness/sweep.sh "$WT"   "$LAB/sites-branch-default"
python harness/validate.py "$LAB/sites-base-default" 40    # must exit 0
python harness/compare.py "$LAB/sites-base-default" "$LAB/sites-branch-default"

SCRIPTC_PROVENANCE_MANIFEST=harness/prov-manifest.json \
  bash harness/sweep.sh "$WT" "$LAB/sites-branch-prov" --provenance-sources
```

The manifest pins `zapo-js` to a local checkout of its attested commit so
the provenance lane is offline and deterministic; it skips the attestation
fetch and the source download and nothing else — the mapping step both
defects live in is the same code either way.
