# block/wrtc — final status

Base main `9c3534a9`. 11 commits on `block/wrtc`.

## The clause, stage by stage

| stage | state |
| --- | --- |
| 0 — verify the brief | **done**, three corrections, all confirmed by the orchestrator |
| 0b — DTLS foundation | **done**, PASS by running (mbedtls 3.6.7, DTLS 1.2 client, 6 checks) |
| 1 — types exist, shapes compile, members refuse by name | **done**, both backends MATCH byte-exact vs node v25.9.0, engine scan 0/0/0 |
| 2 — connected-mode `node:dgram` | **DONE**: the one real blocker is fixed and MATCHes; C-only |
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


---

# Stage 2 — closed

## The twelve gate failures, by name

Eight inherited (four programs on two backends) and four contention, each of
the four verified passing alone. My earlier phrasing "all twelve resolve to the
four inherited" was wrong; the split is 8 + 4.

    1  every corpus program is 100% static (corpus and coverage agree)   contention
    2  differential corpus > 1360-spawn-sync.ts                          INHERITED
    3  differential corpus > 1482-spawnsync-error.ts                     INHERITED
    4  differential corpus > 1537-os-release-spawnsync-stdio.ts          INHERITED
    5  differential corpus > 2390-dot-requires\main.cjs                  INHERITED
    6  server differential > upgrade-read-fairness                       contention
    7  llvm differential corpus > 1360-spawn-sync.ts                     INHERITED
    8  llvm differential corpus > 1482-spawnsync-error.ts                INHERITED
    9  llvm differential corpus > 1537-os-release-spawnsync-stdio.ts     INHERITED
    10 llvm differential corpus > 2390-dot-requires\main.cjs             INHERITED
    11 llvm differential corpus > 2004-generic-methods-statics.ts        contention
    12 llvm differential corpus > tier accounting                        downstream of 11

## Blocker #1 was mine, and I retracted it

`import dgram from 'node:dgram'` is NOT a blocker. `program.ts:2345` already
admits a default import of any supported builtin under `esModuleInterop` or
`allowSyntheticDefaultImports`, and zapo's `packages/voip/tsconfig.json`
extends `tsconfig.packages.json`, which sets `esModuleInterop: true`. My probe's
tsconfig did not. **Second time in this clause that measuring outside the
shipping configuration produced a confident wrong answer** — the first was
measuring the fallback declarations for want of any tsconfig at all.
`probes/zapo-tsconfig.json` is now the one to copy.

## Blocker #2 is fixed

`socket.send(msg)` connected-mode now lowers: `scr_dgram_send_conn_str/bytes`,
two `IrLibFn` entries with validate signatures, may-throw rows and C emission,
and a static one-arg arm in `lower-dgram.ts`. sendto with a NULL address, which
also rides the existing win32 shim.

**The ordering bug it almost shipped with.** Every other entry point in
`scr_dgram.c` checks `closing` first and my first version did too. Node does
not: it validates the absent port argument before connection or running state,
so a merely CLOSED socket answers `ERR_SOCKET_BAD_PORT`, not "Not running".
That version passed the happy path and was wrong on the closed case — a refusal
turned into a quiet wrong answer. The differential probe caught it.

Byte-identical to node v25.9.0 on all three probes: zapo's exact spelling, both
error states, and the string arm. **1 TRAP→MATCH, 0 MATCH→WRONG.**

Targeted verification: `dgram.test.ts` 9/9, and `surface-manifest` +
`llvm-runtime-abi` + `ir` 44/44.

## Still C-only — flagging as its own item

The build reports `backend c (llvm refused: libCall:dgram.onMessage)`.
`dgram.sendStr`/`sendBytes` are absent from the LLVM emitter's map too, so the
two new entries join them rather than making it worse. **No dgram program is on
the LLVM tier today.** If the WebRTC path is dgram-based end to end, this whole
clause lands C-only until someone takes that.

## Stages 3 and 4

Not started. The SCTP packet layer's 51 green checks are a wire format proved
against published vectors — **not an association that works with any peer.**

---

# After the merge (main 31950bba): DTLS on a real socket, and the SCTP association

## Stage 3 finished: DTLS over real, lossy UDP

`probes/socket_test.c` — real loopback sockets, real mbedtls timers over a
real clock, deliberate drop and reorder. **36 checks, 0 failures; 60
consecutive runs green = 360 scenario executions, 0 handshake failures.**

The retransmission timer was indeed the first thing to break, and **two of my
three explanations for it were wrong**:

1. "40% loss fails" — true but useless: `-26880` is `WANT_READ`, not fatal.
   It had exhausted *my budget*, not the protocol.
2. "the 4 s retransmission ceiling starves it" — 1 failure/20 at 4000ms vs
   0/20 at 400ms looked decisive. **Sixty runs put it at 3/60 versus 3/60,
   identical**, refuting it. A 20-run sample produced a confident wrong
   answer.
3. The real cause: every failure showed `server=0` with the client stuck.
   The server had *finished*, and my loop stopped calling it, so a lost
   final flight was never resent. **A harness bug, not DTLS.** Draining the
   finished peer took 6 failures/360 to 0/360.

**The seed does not reproduce a run**, and the file now says so: the PRNG is
drawn per send, and real timers make the send sequence vary. Measured, not
assumed — same seed and binary, 30 s budget exhausted on one run, 145 ms on
the next.

## Stage 4: the association

`scr_sctp_assoc.c`, sans-io. **30 checks, 0 failures, byte-identical across
10 runs** — the virtual clock makes this one genuinely deterministic.

| loss | delivered | retransmits | wire |
| --- | --- | --- | --- |
| clean | 5/5 | 0 | 20 sent, 0 dropped |
| 10% | 5/5 | 2 | 22 sent, 4 dropped |
| 30% | 5/5 | 5 | 24 sent, 9 dropped |
| **50%** | **5/5** | 20 | 53 sent, 22 dropped, 1 duplicate |

**All three failures I hit were in the test peer, and each looked like a
client bug**: acking the highest TSN seen instead of the highest contiguous
one; never retransmitting its own DATA (so a dropped DCEP ACK killed the
channel); and a heartbeat check racing the exit condition, which failed at
30% and passed at 50% — a loss-*dependent* failure that was purely the test
leaving early.

## Still true, and worth repeating

- **The two halves are not joined.** DTLS works over sockets; the
  association works over a virtual wire. Neither is wired to `scr_dgram.c`,
  and neither has met a real WebRTC peer.
- **The SCTP unit's wire-format checks are published vectors, not an
  association with any peer** — the association above is likewise measured
  against a peer I wrote.
- **C backend only.** 16 of 20 `dgram.*` lib functions absent from the LLVM
  emitter; every dgram program demotes.
- **`mlow-codec.ts:26` is voip's other independent stop** (`SC2009` on
  `Promise<MlowModule> | null`), untouched and nothing to do with WebRTC.
  voip is not finished when this clause lands.

---

# The halves are joined

`probes/joined_test.c` — real loopback UDP, DTLS 1.2, SCTP association on top.
**36 checks, 0 failures; 25 consecutive runs = 100 joined scenario
executions, 0 failures.**

| loss | delivered | sctp rtx | udp dropped (handshake / data) |
| --- | --- | --- | --- |
| clean | 5/5 | 0 | 0/26 |
| 10% | 5/5 | 3 | 4/30 (0/4, 4/26) |
| 20% | 5/5 | 0 | 8/36 (5/14, 3/22) |
| 30% | 5/5 | 14 | 21/55 (5/12, 16/43) |

## Two interactions neither half could have shown

Both first appeared as a red from an assertion I had written too strongly.

1. **DTLS shields SCTP during the handshake.** At 20% loss, `rtx=0` despite 8
   drops. Splitting the counters by phase showed 5 of 8 landed in the
   handshake, which DTLS recovers itself — it retransmits its own flights and
   never retransmits application data. SCTP correctly did nothing.
2. **Cumulative SACK loss is self-healing.** Even after the phase split the
   case stayed red: 3 of 22 *data-phase* drops, `rtx` still 0, all five
   messages delivered. The drops were SACKs, and a lost SACK costs nothing
   when a later one carries a higher cumulative TSN. **A data-phase drop does
   not imply a retransmission** — the assertion was wrong twice over.

Retransmission is now reported per case and asserted once for the suite: 17
across the four cases.

## Reproducing

    . G:/blocks/wrtc-lab/env.sh
    V=packages/runtime/vendor/mbedtls
    # mbedtls archive (once): compile vendor/mbedtls/library/*.c, zig ar rcs
    zig cc -target x86_64-windows-gnu -std=c11 -O1 -Wall -Wextra \
      -I probes -I "$V/include" \
      packages/runtime/src/scr_wrtc_fp.c packages/runtime/src/scr_wrtc_cert.c \
      packages/runtime/src/scr_sctp.c packages/runtime/src/scr_sctp_assoc.c \
      probes/joined_test.c libmbedtls.a \
      -lbcrypt -lcrypt32 -lws2_32 -ladvapi32 -o joined_test.exe

`probes/sctp_peer.inc` is included by **both** `assoc_test.c` and
`joined_test.c`, so the hand-written peer has one source. The extraction was
verified byte-identical against `assoc_test`'s pre-refactor output.

## Still true

- **Not a real peer.** Both sides are code in this repository and the SCTP
  peer is one I wrote. Joining the halves did not change that.
- The SCTP wire-format unit's checks are **published vectors, not an
  association with any peer**.
- **C backend only** — 16 of 20 `dgram.*` absent from the LLVM emitter.
- `mlow-codec.ts:26` remains voip's other independent stop.
- None of this is wired into `scr_dgram.c` *inside a compiled scriptc
  binary* yet: the pump loop exists here as a test harness, not as runtime
  code the compiler emits.
