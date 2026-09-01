# block/wrtc — final status

Base main `9c3534a9`. 11 commits on `block/wrtc`.

## The clause, stage by stage

| stage | state |
| --- | --- |
| 0 — verify the brief | **done**, three corrections, all confirmed by the orchestrator |
| 0b — DTLS foundation | **done**, PASS by running (mbedtls 3.6.7, DTLS 1.2 client, 6 checks) |
| 1 — types exist, shapes compile, members refuse by name | **done**, both backends MATCH byte-exact vs node v25.9.0, engine scan 0/0/0 |
| 2 — connected-mode `node:dgram` | **measured**: plumbing works and MATCHes; exactly two blockers named |
| 3 — DTLS handshake over the socket | **not started** |
| 4 — SCTP | packet layer **done and tested** (51 checks); association/timers/bonding **not started** |

## Gate

`4 failed | 143 passed | 7 skipped` files; `12 failed | 5751 passed` tests, 2521 s,
under a concurrent sibling gate throughout.

**All twelve resolve to the four inherited programs on two backends, and
nothing else.** Every non-inherited failure passes alone:

    every corpus program is 100% static          387549 ms / 600000 ms   PASS alone
    server differential > upgrade-read-fairness    4768 ms               PASS alone
    llvm differential > 2004-generic-methods-statics.ts  1692 ms         PASS alone

`tier accounting` is downstream of 2004 and **cannot be run in isolation** —
`claimed`/`refused` are filled by the per-program tests, so a filtered run
compares 0 + 0 against 1725. My first solo run of it was a false signal.

**N WRONG→MATCH = 0, M MATCH→WRONG = 0.**

## The ambient file's price, and the sample that lied

A single A/B pair said **39 ms per program, 24%, 67 s over the corpus** —
decisive, and wrong: that A sample ran while a sibling's gate was spinning up.
Re-running A after B caught it.

Quiet host, three samples each: **with 160.32 ms** (spread 0.05),
**without 152.39 ms** (spread 12.4). **~8 ms per program, ~5%, ~14 s over
1725 programs.** Recorded as a design constraint: that is the unit price of one
always-shipped ~230-line ambient file, and stage 3/4 must not assume zero.

## What stage 2 actually needs (both exactly zapo's spelling)

1. `import dgram from 'node:dgram'` — **SC1012**, default imports.
   `builtinDefaultImportModule` allows only `assert`, `assert/strict`,
   `events`, `test`.
2. `socket.send(oneArg)` connected mode — **SC2020 'send with 1 arguments'
   has no scriptc lowering yet**. `connect()` already lowers; only the
   connected send does not.

Everything else works: bind, listening, message, address, close, and
`send(msg, port, address)` are byte-identical to node v25.9.0. Separately,
the LLVM backend refuses `libCall:dgram.onMessage` and demotes to C — so no
dgram program is on the LLVM tier today. Pre-existing, not this clause's.

## Method notes that changed answers

- **A member-reach survey has two blind spots**: casts, and structural
  constraints from a callee's signature. `close()` was the second kind.
- **A reverted mechanism in the repo's history is a claim, not a fact.**
  voipfix paid six red test files for `lib`-as-floor and concluded it was a
  prerequisite. It is not: `isStdlibFile` already whitelists scriptc's own
  ambient files by path, as `better-sqlite3` does. One `||` row.
- **Node types resolve only when a tsconfig exists** (`program.ts:249`).
  Measuring dgram without one silently measured the fallback and gave a
  different diagnostic. The `setBroadcast` positive control is what
  distinguished them.
- **Never mutate the tree during a gate.** I invalidated a whole run by
  editing the ambient file mid-flight; 14 failures pointed at module
  resolution.
- **A clean compile of unreached code is not evidence.** Members inside
  never-called functions compiled rc=0 with zero diagnostics.
- **`CcCompileError` with no `error:` line is contention**, and that tell
  held for 2004.
