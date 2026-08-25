# mediavoip — static-lane survey of three zapo packages

A **measurement** harness, not a fix. It answers, for `@zapo-js/media-utils`,
`@zapo-js/voip` and `@zapo-js/wam`: how far does the static lane get, what
exactly refuses, and how many call sites does each distinct refusal own.

Nothing here runs in the gate. `tests/perf/` is excluded from the directory
gate and no vitest file imports any of it.

## Why a harness and not `scriptc coverage`

`scriptc coverage` renders blockers grouped by code and message but prints no
file or line, so the same message from twenty sites and from one site look the
same in a sweep. `harness/sites.mjs` calls the compiler's `analyze()` directly
and dumps **every** site as JSON with `code`, `message`, `file` and `line`.
`harness/rank.py` then dedupes by `(file, line, code, message)` — without that
dedupe a module pulled in by eight entries counts its sites eight times.

## Layout

| path | what |
| --- | --- |
| `harness/env.sh` | the block's environment (zig 0.16, `SCRIPTC_CC=zigcc`, per-block caches) |
| `harness/sites.mjs` | one `analyze()`, every coverage site to JSON with file+line |
| `harness/sweep2.sh` | per-module sweep over the three package trees, one lock per output dir |
| `harness/rank.py` | dedupe by site, rank distinct causes by call sites |
| `harness/sc1090.py` | split one diagnostic code into its distinct message variants |
| `harness/revalidate.sh` | self-test: a log naming neither "statements analyzed" nor "not analyzable" is DID-NOT-REPORT, not "no diagnostics" — re-runs those |
| `sites-default/*.json` | the recorded default-lane result, 40 modules |
| `drivers/*.ts` | the probes each finding rests on |

## The probes

| driver | what it establishes |
| --- | --- |
| `wam-wire.ts` | the WAM TLV encoder against zapo's own `wire.test.ts` byte oracle |
| `wam-wire-probe.ts` | the same, over copies with the two npm-island causes removed — 14 build errors become 1 |
| `wawam-values.ts` / `wawam-type.ts` | `--npm-static` on a 28k-line generated table: value-only imports compile 100%, adding one `type` import sends the whole package to the island |
| `cascade-a.ts` / `cascade-b.ts` | a class field typed by an island package makes every call of the class's generic methods refuse; the identical class with a local type is clean |
| `net-probe.ts` / `net-probe2.ts` | `node:dgram` compiles and runs statically (C backend); `net.isIPv6` has no lowering |
| `hang-a.ts` | `--provenance-sources` over a value import of `zapo-js`: 23m21s for a two-line program |

## Reproducing

The sweep needs a lab app outside the repo holding the three package sources
plus their installed dependencies (`zapo-js`, `@types/node`, `sharp`,
`file-type`, `@roamhq/wrtc`, `libmlow-wasm`, `@vinikjkkj/wa-wam`).

```sh
. harness/env.sh
bash harness/sweep2.sh "$LAB/sites-default"      # default static lane
bash harness/revalidate.sh "$LAB/sites-default"  # must report 0 invalid
python harness/rank.py "$LAB/sites-default"
python harness/sc1090.py "$LAB/sites-default" SC1090
```

`revalidate.sh` is not optional. During this survey two concurrent sweeps
raced on the same output directory and produced a 27-byte log — a coverage run
that exits 0 having written nothing is indistinguishable from a clean module
unless something checks.
