---

## 5c. The `store-sqlite` discrepancy — resolved, and the table row it re-labels

**The objection.** This survey measures `store-sqlite` at **7 blocker sites and
no binary**. But `tests/perf/zapo-rest/app182/zapo-rest.ts` was built from this
same `main` a few hours earlier, wired to the SQLite store on all twelve
domains with no memory-store branch anywhere in the program, and it compiled at
**zero diagnostics** into a **32,368,640-byte** binary that passes delivery
verification. Both cannot be a complete description of the same package.

**They are the same package, and the seven sites are not in it.** Neither of the
two obvious explanations is right: the artifact is not different (the driver
resolves the published `@zapo-js/store-sqlite@1.2.0` in both cases, and
`diff -r -q` makes its `src` byte-identical between the v1.8.0 and v1.8.2
checkouts), and the sites are not in an unreached corner of it (**all seven are
in zapo-js's own `src/`, and store-sqlite's own source contributes zero** — see
the owner table in §5).

**What differs is which zapo-js the store package was compiled against, and it
is decided by what the DRIVER imports.** The compiler says so itself, in the
shipped build's log:

> `provenance: zapo-js@1.8.2 ← https://github.com/vinikjkkj/zapo@refs/tags/v1.8.2 @ 757a8071b819 (source compiles statically)`
>
> `provenance: @zapo-js/store-sqlite@1.2.0 ← https://github.com/vinikjkkj/zapo@refs/tags/v1.8.0 @ 9a49e1fffdec (source compiles statically)`
>
> `provenance: 41 alias key(s) are spelled by more than one mapped package with
> different targets ('zapo-js/store', 'zapo-js/signal', 'zapo-js/auth',
> 'zapo-js/appstate', 'zapo-js/retry', …); tsconfig "paths" is one table per
> program, so zapo-js's answer is used for all of them and @zapo-js/store-sqlite
> compile against zapo-js's checkout for those specifiers`

`app182/zapo-rest.ts` imports **both**:

```ts
import { WaClient, createStore } from "zapo-js";
import { createSqliteStore, openSqliteConnection } from "@zapo-js/store-sqlite";
```

so `zapo-js@1.8.2` is a mapped package, it wins the one-table-per-program alias
collision, and store-sqlite's source is compiled against **1.8.2**. This
survey's lane-A driver imports **only** `@zapo-js/store-sqlite`, so `zapo-js` is
never a driver-level mapped package and the store's own attested **v1.8.0**
checkout answers every `zapo-js*` specifier through its tsconfig alias
`zapo-js → src`. The 7 sites are v1.8.0's.

The shipped log confirms which tree it actually compiled: of the 78 occurrences
of a provenance commit in it, **77 are `757a8071…` (v1.8.2) and every one of
those is an advisory**; `9a49e1ff…` (v1.8.0) appears exactly **once**, in the
provenance note, and never in a diagnostic path. `rg -c ' - error SC[0-9]{4}: '`
over that log reads **0**, and it ends `77 advisories (the build succeeded).`

### The A/B, run here, one line apart

`drivers/_x-sqlite-plus-zapo.ts` is `drivers/store-sqlite.ts` with one line
added — `import { WaClient } from 'zapo-js'` — and nothing else changed.
`drivers/_x-redis-plus-zapo.ts` is the same one-line change to
`drivers/store-redis.ts`, run as the contrast: if both arms went to zero the
mechanism would be something other than the alias table.

<!--AB-RESULT-->

### What this re-labels

The lane-A store rows in §5 are correct for the lane they name, and that lane is
**a consumer who imports the store package and not `zapo-js`**. That is not what
a real consumer does — you need `WaClient` or `createStore` from `zapo-js` to
have anything to give a store to — so for the store packages the realistic row
is the one with both imports. The table header now says which, and both numbers
are kept: the 7 is a true measurement of a real (if unrealistic) lane, and
hiding it would hide the fact that a package's attested tag reaches into every
program that names it.

**Neither the 7 nor the shipped zero was wrong. The row was under-labelled.**
