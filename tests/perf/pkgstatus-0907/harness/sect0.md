## 0. What a reader should take away first

1. **Three of the named subjects reach a binary today, and which zapo-js they
   are compiled against is what decides it.**
   * `store-memory` — 17,807,360 B (18,467,328 B on `--backend c`), runs, oracle
     MATCH byte-exact. It is not a package: there is no `@zapo-js/store-memory`
     on npm; the in-memory store ships inside `zapo-js` core.
   * `store-sqlite` — its own source against zapo-js 1.8.2: 47,078 statements,
     **0 failed, 0 blocker sites**, **28,903,424 B**, runs, oracle MATCH. And
     independently: `tests/perf/zapo-rest/app182` ships a 32,368,640 B service
     built on it at **zero errors and 77 advisories**.
   * `zapo-js` 1.8.2's own `WaClient` path — 46,957 statements, 0 blocker sites,
     **28,824,064 B**, runs, oracle MATCH.
2. **`media-utils` and `voip` cannot be measured through npm at all.** Neither
   publishes a provenance attestation, at any published version, so
   `--provenance-sources` islands them and the compiler says so unprompted.
   Their npm-lane numbers are the **island's** refusals, not the packages' —
   reported as **UNMEASURED**, never as a zero. Measured properly from source
   they are **27** and **59** sites, both real and both non-zero.
3. **Most of what the objective is waiting on is a release, not a compiler
   change.** The five published store packages attest tag **v1.8.0**; the
   compiler has already outgrown it. The seven-site cluster that blocks all five
   is v1.8.0's zapo-js core, and it does not exist in 1.8.2. Same for `wam`: the
   same source against 1.8.2 goes from 86 sites to 15.
4. **A cascade that does not carry the cascade code is invisible to a
   roots/cascade split.** 69 of `wam`'s 82 "roots" are one cause in one file and
   clear together. Only compiling the same source two ways showed it. §6a.

