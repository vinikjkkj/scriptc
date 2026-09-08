# The three-package claim — measured directly, and it holds site-for-site

The claim handed to this block was that `store-mysql` and `store-postgres`
"were said to have identical histograms and the same `Base*Store` shape, so
that one finding covers three packages", and that it **rested on a histogram
comparison**. A histogram is a weak instrument: two packages can agree on
`16 x SC1090, 2 x SC2013, 2 x SC2011, 19 x SC2004` and still be failing for
different reasons in different files.

So both were measured directly, on the lane a real consumer gets, and then the
full per-site dumps were compared rather than the totals.

## Lane and instrument

| | |
| --- | --- |
| repo | `<blocks>\storestatus\wt`, worktree of `<repo>`, branch `block/storestatus` |
| `main` | **`f91fcd55`** |
| compiler | `packages/compiler` then `packages/cli`, `tsc -p tsconfig.json` under node **v22.18.0**, rc=0/0 |
| measuring node | **v25.9.0**, read back from the spawned process on every run |
| zig | **0.16.0**, the tree's (`<zapo-work>\tools\zig`) |
| tar | GNU tar 1.35 (Git `usr/bin`), ahead of System32's bsdtar |
| entry (lane) | `drivers/_x-<pkg>-plus-zapo.ts` — the store package **and** `zapo-js`, which is what a real consumer imports |
| flags | `--provenance-sources`, strict, **no `--best-effort`** |
| level | `analyze()` — **analyse level, not a build.** See the build rows in `README.md` |
| instrument | `harness/analyse1.sh` → `harness/sites.mjs` → `harness/tally.mjs` |

## The totals

| package | driver islands on | stmts / failed | blocker SITES | roots | cascade `SC2004` | distinct msgs | runtime fences | advisories | unreached sites |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `@zapo-js/store-redis@1.3.0` | `ioredis@5.11.1` — **no attestation published** | 46,994 / 19 | **39** | 20 | 19 | 9 | 1 | 53 | 10 |
| `@zapo-js/store-mysql@1.2.0` | `mysql2@3.24.3` — **attested**, but `mysql2/promise` has *no source mapping* (published target `./promise.js`) | 47,006 / 19 | **39** | 20 | 19 | 9 | 1 | 53 | 13 |
| `@zapo-js/store-postgres@1.2.0` | `pg@8.23.0` — **no attestation published** | 46,993 / 19 | **39** | 20 | 19 | 9 | 1 | 53 | 13 |

## The verdict: not merely the same histogram — the same sites

`harness/tally.mjs --detail` was run on all three, the package name folded out,
and the blocker sections diffed against each other.

**`store-mysql` vs `store-postgres`: the blocker section is byte-identical
apart from one line — the reason the driver islands.** Same 39 sites, same 16
files by name, same codes, same messages, same by-owner split.

**`store-redis` differs in exactly three further places**, none of them a count:

* the published version (`1.3.0` vs `1.2.0`);
* the island reason;
* the file holding the **value** import of the driver — `createRedisStore.ts`
  in redis, `connection.ts` in mysql and postgres.

## The 39, clustered by cause rather than counted

The same cluster in all three. `<Base>` is `BaseRedisStore` / `BaseMysqlStore` /
`BasePgStore`; `<drv>` is `ioredis` / `mysql2` / `pg`.

| sites | code | where | what it says |
| --- | --- | --- | --- |
| 1 | `SC2013` | `<Base>Store.ts` | *values from the `<drv>` package run in the embedded dynamic engine* — the islanded type in the base class's shape |
| 16 | `SC1090` | the sixteen `*.store.ts` files | *extending classes not declared in the program (`<Base>`) is not supported yet* |
| 1 | `SC2013` | `createRedisStore.ts` / `connection.ts` | *importing `<drv>` requires the embedded dynamic engine* — the **value** import |
| 2 | `SC2011` | `create<Pkg>Store.ts` and the driver | *values of type `Wa<Pkg>StoreConfig` / `Wa<Pkg>StoreResult` have no static representation* |
| 19 | `SC2004` | the driver, one per `console.log` | *uses of `s` / `c` / `r` / `create<Pkg>Store` inherit the blocker on its declaration* — the compiler's own cascade marker |

**20 of the 39 are the driver's, not the package's** (1 root + 19 cascade), and
they are an artefact of the driver's shape: sixteen `console.log` lines each
taking a store out of a value that already failed. A different consumer gets a
different number there. The **19 that are the package's** are the ones that
matter, and they are the first four rows minus the driver's `SC2011`.

## Roots-vs-cascade does not see this, and that is the trap

Only 19 of the 39 carry `SC2004`, the compiler's cascade marker. The other 20
count as **roots**, including all sixteen `SC1090`s and the `SC2013` that
causes them. A roots-vs-cascade split therefore reports **20 independent
problems in three packages, 60 in all**, when substitution shows the real
number is **one, three times**.

The proof is not the histogram and not the file list. It is
[`LADDER.md`](LADDER.md): the same shape in 26 lines, one line substituted,
four sites to zero, with a byte-identical A/A arm reading exactly what the
baseline reads.

## Build level, run afterwards — and it agrees exactly

`analyze()` is not a build, so all three were also built: strict,
`--backend c`, `--provenance-sources`, no `--best-effort`, same entries.

| package | rc | compiler's own line | log error SITES | `SC2004` | `SC1090` | `SC2013` | `SC2011` | uncoded refusals | binary |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `store-redis` | 1 | `39 errors.` | 39 | 19 | 16 | 2 | 2 | **0** | none |
| `store-mysql` | 1 | `39 errors.` | 39 | 19 | 16 | 2 | 2 | **0** | none |
| `store-postgres` | 1 | `39 errors.` | 39 | 19 | 16 | 2 | 2 | **0** | none |

Build level and analyse level agree to the site and to the code in all three.
No binary, so the fence count is **n/a, not 0**, and the engine scan is **n/a,
not clean**. The `uncoded refusals` column is not decorative: a refusal need
not carry an `SC` code, and one in an earlier block's otherwise clean-looking
build carried none. Here there are none.

## What this does NOT say

* It does **not** say the three packages reach a binary if their driver stops
  islanding. The 39 is what is in front of them **now**; a substitution ladder
  shows the 39 is one cause, not that nothing lies behind it.
* It does **not** say `mysql2` is the same kind of island as `pg` and
  `ioredis`. It is not: mysql2 **publishes an attestation**, and the only
  reason it islands is the unmapped `mysql2/promise` subpath. The
  *consequence* is identical; the *route out* is not — `pg` and `ioredis` need
  an upstream publisher to attest, `mysql2` needs a subpath mapping.
* It does **not** rule out deeper walls behind the island. `mysql2` has form
  here: an earlier block found its deeper walls were *exposed* by a flag rather
  than caused by it. What is measured is that **on this lane, at this commit,
  every one of the 39 sites is in the island's chain** — 16 name the base
  class, 2 name the package, 2 name a type built from it, 19 are the driver
  inheriting it, and the 26-line ladder reproduces the whole chain from an
  islanded type alone.
