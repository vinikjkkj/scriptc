# mediavoip-remeasure — the same three packages, re-measured

`tests/perf/mediavoip/` surveyed `@zapo-js/media-utils`, `@zapo-js/voip` and
`@zapo-js/wam` in the static lane at `e53c19ad` and recorded 33 distinct causes
over 234 unique refusal sites across 40 modules. Three provenance fixes have
landed since. This directory re-runs that survey against them, in **both**
lanes, and adds the controls the first harness could not carry.

Nothing here runs in the gate. `tests/perf/` is excluded from the directory
gate and no vitest file imports any of it.

## Why not just re-run `tests/perf/mediavoip/harness`

`harness/revalidate.sh` — the self-test the first survey's README calls "not
optional" — globs `$OUT/*.log`. `harness/sweep2.sh` writes `*.txt`. On a
sweep2 output directory the glob matches nothing, the loop body runs once
against the literal pattern, and the number it prints has no relation to the
sweep. It can neither report "nothing changed" nor fail for the right reason.

`harness/selftest.py` here replaces it. Five checks, and the last two are armed
controls that run **in the same lane as the corpus, on every sweep**:

| check | what it asserts |
| --- | --- |
| A | all 40 corpus modules produced a parseable JSON |
| B | every module's log ends `EXIT=0` |
| C | the `sites=` count in each log equals `len(sites)` in its JSON |
| D | **positive control** `typesprobe.ts` — a 4-argument `execFile`, which only real `@types/node` accepts — reports zero `SC0001` **and** names `@types/node` in a diagnostic. The fallback `.d.ts` cannot say that. |
| E | **negative control** `typesprobe-neg.ts` — a genuine type error — reports `SC0001`. If it does not, the query cannot see errors and every clean module in the sweep is void. |

`selftest.py` was shown to fail three separate ways before any number in the
report was quoted: an empty negative control, a positive control carrying the
fallback signature, and a dropped module.

## Layout

| path | what |
| --- | --- |
| `harness/env.sh` | the block's environment; every path under `G:\blocks\remeasure` |
| `harness/sweep.sh` | per-module sweep, one lock per output dir, **controls first** |
| `harness/selftest.py` | the five checks above |
| `harness/compare.py` | site-for-site diff of two sweep dirs, block-root independent |
| `harness/rank2.py` | global cause ranking split owned / unowned, with a rule table that prints rules matching zero |
| `harness/norm-selftest.py` | controls for the path normalisers inside `compare.py` and `rank2.py` |
| `harness/gate.sh` | the gate, under node v25 with `VITEST_EXIT` captured into its own variable |
| `harness/typesprobe.ts`, `typesprobe-neg.ts` | the two armed controls |
| `sites-default-7080/` | the default lane at this commit, 40 modules + 2 controls |
| `sites-prov-7080/` | the `--provenance-sources` lane, same |
| `drivers/` | the probes each finding rests on |
| `probe-wire/`, `probe-wire2/` | the wam wire path with one and with two source changes |

## Comparability across blocks

Two things in a sweep are block-specific and would make one cause count as two
if left alone: the lab-app root and the provenance cache's `<40-hex commit>`
directory. Both appear in site `file` fields **and inside diagnostic text** —
`SC0001` quotes a `node_modules` module path, and `SC1016` spells a whole
import cycle. `compare.py` and `rank2.py` fold both, and `norm-selftest.py`
controls the folding: four path spellings and two message spellings must
collapse, two plain strings must not.

That control exists because the first `rank2.py` regex reached disk with one
backslash missing — a character class that matched forward slashes only. It
would have counted every Windows-spelled cause once per block, silently.

## Reproducing

The sweep needs a lab app outside the repo holding the three package sources
plus their installed dependencies. Beyond the seven the first survey names,
**zapo-js's four optional peer dependencies must be installed too** —
`argo-codec`, `pino`, `pino-pretty`, `ws`. The default lane never resolves
them, so their absence is invisible there; the provenance lane compiles
zapo-js from source, and without them `src/argo-decoder.ts` raises `SC0001`
"Cannot find module 'argo-codec'" that looks exactly like a compiler defect.

```sh
. harness/env.sh
bash harness/sweep.sh "$LAB/sites-default"                        # default lane
bash harness/sweep.sh "$LAB/sites-prov" --provenance-sources      # provenance lane
python harness/selftest.py "$LAB/sites-default" 40                # must PASS
python harness/selftest.py "$LAB/sites-prov" 40                   # must PASS
python harness/norm-selftest.py                                   # must PASS
python harness/compare.py sites-default-7080 "$LAB/sites-prov"
python harness/rank2.py "$LAB/sites-prov" "provenance lane"
```

The provenance lane is not fast and one module is not slow-looking, it is
slow: `voip/media/WaAudioEngine.ts` pulls in the whole of zapo-js and takes
**950 seconds to analyse 45,645 statements**. The per-module timeout in
`sweep.sh` is 1800s for that reason. Slow is not hung.
