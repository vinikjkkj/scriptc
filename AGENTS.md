# Agent Guide

Guidance for agents (and humans) working on this repository. These conventions apply repo-wide; the docs site under `docs/` additionally has its own conventions in `docs/AGENTS.md`.

## Build and test

```bash
pnpm install && pnpm -r build   # build the workspace
pnpm test:sandbox              # default full gate: plain + sanitized lanes (~4 minutes)
```

Use focused local tests while iterating, then use `pnpm test:sandbox` whenever a
full validation gate is required. It loads Sandbox configuration from the
shell and `.env.local`, runs portable coverage across disposable Linux
Sandboxes, and retains the Darwin-native contracts on macOS. Linux hosts run
their supported native-clang contracts locally; other hosts retain those
checks in the Sandboxes. Both lanes green is the bar before shipping any
change.

Only when Vercel Sandbox credentials or `SCRIPTC_SANDBOX_IMAGE` are unavailable,
run the slower local fallback:

```bash
SCRIPTC_TEST_WORKERS=4 pnpm test                 # plain lane
SCRIPTC_TEST_WORKERS=4 SCRIPTC_SAN=1 pnpm test  # sanitized lane
```

`SCRIPTC_TEST_WORKERS` caps the vitest worker pool so concurrent agents don't
contend for cores; full local suites also queue behind an advisory lock per
lane.

`SCRIPTC_SAN=1` builds with AddressSanitizer *and* the runtime's refcount
audit. On toolchains that cannot LINK ASan — zig's mingw target has no asan
runtime to link the instrumentation against, so the whole Windows lane runs
unsanitized — the audit is still available on its own:

```bash
SCRIPTC_RC_AUDIT=1 pnpm test                     # leak detector, no ASan
```

It defines `-DSCR_RC_AUDIT`, which is pure C: a live counter per refcounted
kind and an atexit assertion that the count is zero. A program that leaks
prints `scriptc RC AUDIT FAILED: …` naming the per-kind counts and exits 99,
so the differential corpus becomes a leak suite. The define is part of the
build-cache key, so audited and plain binaries never share an entry, and
leaving the variable unset reproduces the historical command line exactly.

Corpus programs are differential tests against Node: every program runs under Node and as a compiled native binary, and stdout, stderr, and exit codes must match byte-for-byte. A new feature lands with corpus programs that pin its behavior both ways.

## Where things live

- `packages/compiler` — the frontend (tsc API to IR), the typed IR with validator and serializer, and the LLVM and C backends.
- `packages/runtime` — the C runtime compiled into every scriptc binary.
- `packages/cli` — `scriptc build | run | coverage`.
- `tests/` — the differential corpus, diagnostics snapshots, and the harness.
- `docs/` — the documentation site (standalone pnpm workspace); see `docs/AGENTS.md`.
- `scripts/` — repo tooling, including the release version stamp.

## Releases

Releases are maintainer-run; see [RELEASING.md](./RELEASING.md).
