# App builds and RAM measurements on GitHub runners (`bench.yml`)

`gh workflow run bench.yml -R vinikjkkj/scriptc --ref <branch-with-bench.yml> -f target=<branch or FULL sha> -f programs="messaging-redis" -f variants=plain -f reps=3`

One job per program. The compiler under test is checked out from `target`; this directory, `tests/perf/dyncensus` and the clientbench transport come from the dispatched ref.

| step | script | what |
|---|---|---|
| fetch | `harness/fetch-tree.sh` | the zapo-js 1.8.2 checkout (commit 757a8071b819..., the one scriptc's provenance resolves), `npm ci` of `app/package.json`, pmon built from `harness/pmon.c` |
| program | `harness/mkbench.sh <store>` | `bench-messaging-<store>` from the checkout's own bench dir plus the measurement ladder (`ladder-*.mjs`); the checkout is never edited |
| build | `harness/build.sh <store> <backend> <out> <variant>` | the scriptc CLI over the entry; variants `plain` and `census` share ONE lowering (see below) |
| run | `harness/run.mjs` | pmon-wrapped runs, interleaved, a Node reference run, smaps at the peak, optional callgrind |

Variants. `census` adds `SCRIPTC_PROF_CFLAGS` (the dyn and string census headers). That variable reaches only the C compiler, so it is not part of the early build cache key: the second variant of the same program, built through the same `-o` path and `SCRIPTC_CACHE_DIR`, re-runs clang and the link only. Not implemented yet: `layout-profile` / `layout-order` (they change the codegen, so they need their own lowering and a profile run), the REST app.

Outputs per program (artifact `bench-<program>`): `out/*.build.log`, `out/build-summary.txt` (rc and build seconds), `result/*.pmon.json` (pmon: `rss_peak_kb`, cpu, phase marks), `result/*.smaps.json` (the smaps snapshot at the highest VmRSS by bucket), `result/results.json`, `result-summary.txt` (one line per arm), the binary as `bench-<program>-bin`.

Output parity. Each run prints the scenario JSON; it is reduced to `{name, messages}` per scenario (every other field is a timing or a memory figure) and hashed. An arm passes when the hash equals the Node run's (`parity=SAME`).

CPU. Shared runners make CPU and wall seconds noise; `rss_peak_kb` and the smaps buckets are the stable figures, and callgrind `Ir` (`-f ir=250`, ZAPO_BENCH_MESSAGES scenario size) is the only CPU figure. The Ir run also sets `ZAPO_BENCH_PREKEY_TIMEOUT_MS` high (the client is about 50x slower under valgrind than the server's wall timer allows).

Services. redis 8, mysql 8.4 and postgres 17 are service containers of the job (the box measures against MySQL 8.4.13 and PostgreSQL 17). Every run starts from an empty database (`harness/resetdb.mjs`). The fake server runs on Node and is never compiled.
