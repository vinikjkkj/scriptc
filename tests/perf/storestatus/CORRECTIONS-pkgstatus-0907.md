# Which rows of `tests/perf/pkgstatus-0907/` are now wrong, and why

`pkgstatus-0907` measured `main` at **`3f3dd523`** (2026-09-07 12:52 -03).
This block measures `main` at **`f91fcd55`**, **56 commits** later. Four of
those commits move numbers in that table:

| commit | what it changes | which rows it moves |
| --- | --- | --- |
| `d2c952ca` `fix(provenance)` | a monorepo subpackage's spec twins live at the **tree root**, not under `pkg.dir`; `provenanceDeclSiblings()` walked `join(pkgDir, "spec")` and found nothing | **every store row.** Reach opens by ~32x, so a package that was barely analysed is now analysed through |
| `ee920f54` `feat(provenance)` | the authored-JavaScript mapping becomes a whitelist | `wam` (not this block's clause) |
| `82bf8caa` / `dd4c8ebd` `fix(lowering)` | a compound assignment pins its receiver; a compound array-element write admits a repeatable receiver | any row whose blockers included those |
| `8477dad2` / `a659bdd2` `fix(child)` | the null arm on `child.stdout` is the ABI | `media-utils` (not this block's clause) |

**Nothing in `pkgstatus-0907` was measured wrongly.** Every row was true for
the lane and the commit it names, and that document labels its lanes carefully.
What follows is the list of rows a reader would today quote as current and be
wrong about.

---

## 1. `table-lane-a.md` and §5 — the three islanded store rows

The lane-A table records, for `store-mysql`, `store-postgres` and `store-redis`:

```
| store-mysql    | no | n/a | n/a | 46 | 46 errors. | ANALYSED | 1462 / 24 | 46 | 26 | 20 | 16 | 0 | 1 | 208 |
| store-postgres | no | n/a | n/a | 46 | 46 errors. | ANALYSED | 1449 / 24 | 46 | 26 | 20 | 16 | 0 | 1 | 208 |
| store-redis    | no | n/a | n/a | 46 | 46 errors. | ANALYSED | 1450 / 24 | 46 | 26 | 20 | 16 | 0 | 1 | 205 |
```

**Stale in four columns.** On `f91fcd55`, on the lane a real consumer gets
(`drivers/_x-<pkg>-plus-zapo.ts`, `--provenance-sources`, strict, `analyze()`):

| package | 0907 stmts / failed | now | 0907 blocker sites | now | 0907 roots / cascade | now | 0907 distinct msgs | now |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `store-mysql` | 1,462 / 24 | **47,006 / 19** | 46 | **39** | 26 / 20 | **20 / 19** | 16 | **9** |
| `store-postgres` | 1,449 / 24 | **46,993 / 19** | 46 | **39** | 26 / 20 | **20 / 19** | 16 | **9** |
| `store-redis` | 1,450 / 24 | **46,994 / 19** | 46 | **39** | 26 / 20 | **20 / 19** | 16 | **9** |

The **statement count is the important one**, not the site count: reach opened
by a factor of about 32, so the 46 was taken over a program the compiler could
barely see into and the 39 is taken over one it analyses through. The seven
zapo-js-core sites that made up the difference are gone, and `advisories` moved
from 1 to 53 and `runtime fences` from 0 to 1 for the same reason.

`store-mongo` and `store-sqlite` also change; they have their own rows below.

## 2. §5c's headline pair — *"46 isolated / 39 as a consumer"* — is dead

§5c records `store-redis` at **46** with the store package alone and **39**
with `zapo-js` added, and reads the seven-site difference as the alias-table
mechanism. That was correct at `3f3dd523`.

Both lanes were re-measured here at `f91fcd55`, in this block's own worktree
and compiler build:

| lane | entry | provenance packages resolved | stmts / failed | blocker SITES | roots / cascade |
| --- | --- | --- | --- | --- | --- |
| CONSUMER | `_x-redis-plus-zapo.ts` | `zapo-js@1.8.2` + `@zapo-js/store-redis@1.3.0` | 46,994 / 19 | **39** | 20 / 19 |
| BARE | `store-redis.ts` | `@zapo-js/store-redis@1.3.0` **only** | 46,878 / 19 | **39** | 20 / 19 |

**Equal to the site, to the code and to the file.** Block `wamcoord` reported
the same two figures at `e48c5e52`; this is an independent reproduction, and
the consumer arm reproduces `wamcoord`'s published triple exactly
(`sites=103 total=46994 failed=19`).

**Any table still carrying "46 isolated / 39 as a consumer" for `store-redis`
is out of date.** The spec-twin fix removed the reason the lane difference
existed here.

## 3. §0 headline 3 — *"most of what the objective is waiting on is a release"*

> *"The five published store packages attest tag v1.8.0; the compiler has
> already outgrown it. The seven-site cluster that blocks all five is v1.8.0's
> zapo-js core, and it does not exist in 1.8.2."*

True as written at `3f3dd523`, and **misleading if quoted today for the store
packages**, for two independent reasons.

1. `diff -rq` between `packages/<pkg>` in the two attested checkouts
   (`9a49e1fffdec` = v1.8.0, `757a8071b819` = v1.8.2) reports **no differences
   at all** for all five store packages — 22, 24, 24, 27 and 22 `.ts` files
   respectively, byte-identical. §4 of `pkgstatus-0907` says this too. A
   republished store package would therefore ship *the same source*.
2. The seven-site core cluster the release was supposed to remove **is already
   gone at `f91fcd55` without a release**, because the spec-twin fix changed
   what the compiler can resolve.

What remains in front of `store-mysql`, `store-postgres` and `store-redis` is
**not a zapo release**. It is an upstream one: `pg` and `ioredis` publish no
provenance attestation, and `mysql2` publishes one whose `mysql2/promise`
subpath has no source mapping.

## 4. `store-mongo`'s row — 242, and the cost of reaching it

§5 records `store-mongo` at **3,131 statements / 149 failed, 242 blocker sites
(201 roots + 41 cascade, 181 distinct messages)**, with a build that stops at
**1 error** (`SC1012 export = assignments` in `@mongodb-js/saslprep`).

Measured here on the **consumer** lane at `f91fcd55`:

| | `3f3dd523`, bare lane | `f91fcd55`, consumer lane |
| --- | --- | --- |
| statements / failed | 3,131 / 149 | **48,647 / 177** |
| blocker sites (analyse) | 242 | **284** |
| roots / cascade | 201 / 41 | **244 / 40** |
| distinct messages | 181 | **180** |
| build error sites | **1** (`SC1012` in `@mongodb-js/saslprep`) | **284** |
| build's own line | `1 error.` | **`284 errors.`** |

So `242`, `3,131` and — most misleadingly — the **`1`** are all stale. That
`1` was the headline example of *"two counts that are not the same question"*,
and on this lane the two counts now **agree exactly, 284 = 284, code for
code**. The reason is worth more than the number: on the consumer lane
`@mongodb-js/saslprep` is **islanded**, evicted by the 16-package provenance
limit, so the `export =` module-link refusal that stopped that build never
happens. §3c of `README.md`.

The important row is neither: **278 of the 284 sites are inside `mongodb`
(197) and `bson` (81), and `@zapo-js/store-mongo` itself contributes one.**

Block `mongodriver` was working the same package in more depth at the same
time; where its numbers and these differ, compare the lane, the entry, **and
which sixteen packages were attested**, before the totals.

## 4b. `store-sqlite`'s lane-A row — **7 → 0**, on the bare lane too

`table-lane-a.md` records `store-sqlite` at **7 build error sites, 7 blocker
sites, 1,535 statements / 5 failed**, `binary? no`, on the lane where the
driver imports the store package **and nothing else**.

Re-measured on that same bare lane at `f91fcd55`:

```
b-store-sqlite  ANALYSED  46,963 statements / 0 failed
                BLOCKER SITES = 0   roots 0   cascade 0   distinct messages 0
                runtimeFence 1   advisory 53   unreached-sites 7
                prov: @zapo-js/store-sqlite@1.2.0 <- 9a49e1fffdec   (no zapo-js resolved)
```

**Zero, on the lane that reported seven, without `zapo-js` being resolved at
all.** §5c of `pkgstatus-0907` reads the 7 → 0 move as the alias table
answering with 1.8.2; at `f91fcd55` the store package's own attested checkout
answers for those specifiers out of its **tree root** `spec/`, which is what
`d2c952ca` changed, and the 7 are gone whether or not a driver names
`zapo-js`. And on the **consumer** lane the same package is a
**28,903,936-byte binary that runs and matches node byte-for-byte**.

## 5. What is NOT wrong and should keep being quoted

* **§2a's counter traps.** A build log carries `` - error SCxxxx: ``; an
  emitted C TU carries `[SCxxxx at file:line]`. Scanning one with the other's
  pattern reads a silent zero. Still true; this block uses both patterns and
  prints the byte size of what it scanned.
* **§2e's engine scan.** `JS_NewRuntime`, `JS_Eval` and `__island_eval` read
  **zero in a binary that certainly embeds the engine**. Re-armed here on
  `f91fcd55` and still true: only `quickjs` and `ScrDyn` discriminate.
* **§7.8's fence-counter finding.** `<name>.c` is not the program; the C
  backend splits into `<name>.partN.c` plus `<name>.scrh`. Confirmed again
  here — `_x-sqlite-plus-zapo` emits **16** translation units
  (`.c`, `.part1.c` … `.part14.c`, `.scrh`), 141,386,592 bytes, and the one
  fence is in **part4**.
* **§5's decomposition** `46 = zapo-js core 7 + own 19 + driver 20`, and *"only
  19 of the 46 are the package's own code, and 16 of those 19 are a single
  cause"*. The `7` is gone; **the `19 + 20` split survives exactly**, and this
  block proves the "single cause" part by substitution rather than by
  inspection (`LADDER.md`).
* **The lane caveat itself.** *"What a package is measured against is decided
  by what the DRIVER imports."* Still the largest single lever on any number in
  either document.

---

## A note on where corrections live

A correction that lives only in a new file does not stop the old table being
cited. `pkgstatus-0907/README.md`, `table-lane-a.md` and `table-lane-f.md`
therefore carry a pointer to this file at the top, added by this block. Their
measurements are left untouched: they were true, and rewriting another block's
numbers in place would destroy the record of what the compiler did at
`3f3dd523`.
