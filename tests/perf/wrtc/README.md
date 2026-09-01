# block/wrtc — WebRTC data-channel clause

Base main `9c3534a9`. Worktree `G:\blocks\wrtc`, lab `G:\blocks\wrtc-lab`, tmp `G:\blocks\wrtc-tmp`.
Toolchain: `zig 0.16.0`, build node `v22.18.0`, oracle node `v25.9.0`.
Everything below that carries a number was RUN. Anything unmeasured says so.

---

## Stage 0 — verifying the brief

Source read: the provenance checkout
`250f9af5229a545eec28ddbd3e8774a397cdb0bb`, `packages/voip/src/relay/WaSctpRelay.ts`
(1,025 lines).

### Confirmed as briefed

One import site, one binding (`:5`); `new wrtc.RTCPeerConnection({ iceServers: [] })`
at `:224` with genuinely empty `iceServers`; `createDataChannel('wa-web-call',
{ ordered: false })` at `:337`; `binaryType = 'arraybuffer'` at `:342`;
`createOffer()` at `:384` through `setRemoteDescription({type:'answer'})` at `:398`;
`MessageEvent` at `:312` and `:367`. Each of `addIceCandidate`, `onicecandidate`,
`createAnswer`, `ontrack`, `addTrack`, `maxRetransmits`, `maxPacketLifeTime`,
`RTCIceCandidate`, `restartIce` has `rg -c` = 0.

So: offerer-only, host candidates only, no trickle ICE, data channel only (no
SRTP, no codecs), unordered **reliable** — RFC 3758 FORWARD-TSN not required.

### Three corrections

1. **`close()` is a type-level member the 18-member list omits.**
   `closeQuietly(closeable: { close(): void } | ...)` at `:22` is called with
   `conn.peerConnection` (`:426`, `:637`, `:1006`), `conn.channel` (`:424`,
   `:1004`) and `conn.incomingChannels[]` (`:425`, `:636`, `:1005`). The
   declarations do not typecheck without it.

2. **Three further members ride `(pc as any)` — runtime surface is 21, not 18.**
   `getStats?.()` `:252`, `connectionState` `:274`, `ondatachannel =` `:301`.
   No type error, so they do not block stage 1. `getStats?.()` degrades safely,
   `connectionState` reads `undefined`, but **`ondatachannel` fails silently** —
   `conn.incomingChannels` would simply stay empty.

3. **zapo owns a second, non-wrtc relay path, and its own STUN stack.**
   `relay/stun.ts` is 567 lines of pure TypeScript over `node:dgram`.
   `connectToRelay` branches at `:211` on `relayInfo.isFna`; that branch calls
   `setupUdpRelay` (`:438`) and never constructs a peer connection.
   `sendToChannel` (`:659`) *prefers* the UDP socket — `channel.send` at `:684`
   is only reached when `udpSocket` is null.
   **Brief stage 2 (STUN connectivity checks in C) is therefore already zapo's
   own TypeScript.** What it needs from scriptc is connected-mode `node:dgram`
   (`socket.connect()`, single-arg `socket.send()`), not vendored C.

---

## Stage 0b — the DTLS foundation, verified by running it

`probes/dtls_probe.c`, x86_64-windows-gnu. All **109** mbedtls TUs
cross-compiled, 0 failures, 0 `error:` lines; archive 1,227,638 bytes.

    mbedtls 3.6.7
    MBEDTLS_SSL_PROTO_TLS1_2                yes
    MBEDTLS_SSL_PROTO_DTLS                  yes
    ssl_config_defaults(CLIENT, DATAGRAM)   yes
    ssl_setup with a DATAGRAM config        yes
    ssl_set_timer_cb linked                 yes
    TLS-ECDHE-ECDSA-WITH-AES-128-GCM-SHA256 yes
    TLS-ECDHE-RSA-WITH-AES-128-GCM-SHA256   yes
    TLS-ECDHE-ECDSA-WITH-AES-256-GCM-SHA384 yes
    SHA-256("abc") known answer             yes
    RESULT: PASS  rc=0

`MBEDTLS_SSL_DTLS_SRTP` is **not** enabled and does not need to be — no
`addTrack`/`ontrack`, so `use_srtp` never comes up.
win32 link needs `-lbcrypt -lcrypt32 -lws2_32 -ladvapi32`; without them the
failure is `BCryptGenRandom` and `inet_pton` undefined, which reads like a
broken vendor tree rather than a missing flag.

---

## The prior art, and the one place it was wrong

`tests/perf/voipfix/README.md` measured this same wall and concluded:

> a wrtc runtime that merely satisfies the DOM interface leaves `:94` refusing
> … that mapping is gated on the DOM declaration being a stdlib file

and therefore that the reverted `lib`-as-floor mechanism (commit `24e21a10`,
which cost six red test files) was a prerequisite.

**That premise is wrong, and in our favour.** The gate is not
`isSourceFileDefaultLibrary`; it is `lowerer.ts`'s `isStdlibFile`, which
already whitelists scriptc's own ambient files **by exact filename** —
including `this.sqliteAmbient`, whose comment says why. One `||` row buys
stdlib provenance with no `lib` change and no blast radius.

---

## Stage 1 — landed and measured

### 1a — the declarations (commit `6a4074f8`)

New `packages/compiler/ambient/scriptc-wrtc.d.ts`, wired the way
`scriptc-sqlite.d.ts` is: `wrtcDtsPath()` in `shared.ts`, an extra program
root in `program.ts`, the export row in `package.json`, and **the row in
`isStdlibFile`**. No stand-down condition — with `lib` forced to es2025 these
globals arrive from nowhere else, and `@roamhq/wrtc`'s own .d.ts re-exports
them rather than declaring them.

### 1b — the representation (commit `297f7530`)

Two IR kinds, copying **`request`** (the existing type-only representable
handle: a refcount word nothing allocates) rather than the sqlite handles —
because `request` also has an **array element** representation, and
`Connection.incomingChannels` is `RTCDataChannel[]`.

~20 sites: the kind union, `REF_TRUTHY_KINDS`, singletons, `typeKey`,
`isRefCounted`, `isJsonSafeAt`, `LIB_MODE_REFUSED_KINDS`, `moduleUsesWrtc`;
`formatIrTypeInner` and the provenance mapping arm; all six of `emit-types.ts`;
`truthyC`; **both** LLVM `truthy` switches; `scr_wrtc.c` + `scr_runtime.h`;
the `cc.ts` link gate.

### The measured progression, probe `rtc-shape.ts`

| | result |
| --- | --- |
| base | 2 errors, both `SC0001 Cannot find name`, **preflight-fatal** |
| after 1a | 6 errors; `SC2009` on `Map<string, Connection>` and on the record member |
| after 1b | **builds and runs** |

    backend=llvm  build rc=0  run rc=0  llvm refusals 0  vs oracle MATCH
    backend=c     build rc=0  run rc=0  llvm refusals 0  vs oracle MATCH
    engine scan quickjs/ScrDyn/JS_NewRuntime = 0/0/0 on both

The llvm-refusal count is quoted deliberately: a missing union-arm case would
have **demoted silently** to the C tier rather than failed, so 0 is what says
it did not.

### The refusal list, probe `rtc-live.ts` (the zapo construction shape)

The `'@roamhq/wrtc'` import **resolves** — no `SC2013`.

    SC2020  'RTCPeerConnection.createDataChannel' has no scriptc lowering yet
    SC2020  'RTCPeerConnection.signalingState'    ...
    SC2020  'RTCDataChannel.readyState'           ...
    SC2020  'RTCDataChannel.close'                ...
    SC2020  'RTCPeerConnection.close'             ...
    SC1090  constructing values other than classes declared in the program

**Two honest-but-unnamed gaps remain.** Construction reports the generic
SC1090 rather than naming `RTCPeerConnection`, and event-handler assignment
(`onopen`, `onmessage`, `oniceconnectionstatechange`, …) reports
`SC1090 assignment to non-variables are not supported yet` — nine of those in
`probes/rtc-members.ts`. Neither is a wrong answer; neither reads as well as
the SC2020s. Naming them is follow-up work.

### A methodology note that cost me a wrong conclusion

An earlier probe put every member inside exported functions **nothing called**.
It compiled `rc=0` with zero diagnostics, which reads exactly like "nothing
refuses" and is really "unreachable functions are skipped". The refusal list
above comes from a probe whose statements execute. *A clean compile of
unreached code is not evidence of anything* — and my first reading of it was
wrong until I made the code reachable.

I also nearly misfiled a real error as contention: a truncated stderr tail
ended at `N warnings generated.` with the `error:` line scrolled off. It was a
genuine missing `#include <stdlib.h>` in `scr_wrtc.c`. The tell only works
when you grep the whole buffer, not the tail.

---

## Status

- Stage 0 (verification) — **done**, three corrections to the brief.
- Stage 0b (DTLS foundation) — **done**, PASS by running.
- Stage 1 (types exist, shapes compile, members refuse by name) — **done**
  on probes and green on both backends against the v25.9.0 oracle.
  Not yet exercised against the real `WaSctpRelay.ts` in its own package.
- Gate — running at the time of writing; result not yet in.
- Stage 2 (ICE) — **rescoped by finding 3**: zapo's own `stun.ts` covers it
  for the FNA path; what is needed is connected-mode `node:dgram`. Unstarted.
- Stages 3 (DTLS) and 4 (SCTP) — unstarted.

---

## A gate I invalidated myself, and the rule that comes out of it

The first gate run reported **16 failures**. Every one of them was mine, and
none of them was the code:

- **14** were `SC0001 Cannot find name 'ThisNameDoesNotExistAnywhere'`, or a
  downstream `expected 'SC0001' to be 'SC4009'`. That name is the deliberate
  poison from a positive control I ran to prove that an error inside the
  shipped ambient file really does fail a build (it does). I edited the
  ambient file **while the gate was in flight**, and every test that compiled
  during that window failed.
- **1** was `llvm-runtime-abi.test.ts > every IrType kind has a row in the
  sample table`: `expected [...57] to deeply equal [...55]`. That one is
  real, and it is the test doing exactly its job — its comment says a new
  kind must land there as a failure so someone decides whether it is
  refcounted. Fixed by adding the two `KIND_SAMPLES` rows.

**Rule: never mutate the tree while a gate is running.** The results are not
merely noisy, they are attributable to the wrong cause — a reader seeing
fourteen `require`-suite failures would go looking at module resolution.
The positive control itself was worth running; running it concurrently was
not. Gate re-run clean afterwards.

---

## Stage 4 groundwork — the SCTP packet layer (written, RUN, not yet committed)

Held out of the worktree until the gate finishes; I invalidated one gate
already by editing the tree mid-run and will not do it twice.

`G:\blocks\wrtc-lab\sctp\` — `scr_sctp.c`, `scr_sctp.h`, `sctp_test.c`.
Wire format only: build and parse, **no association state machine, no
timers, no socket**. That split is deliberate — the packet layer is the
part provable offline against published answers, and a retransmission
timer over a wrong CRC is not worth writing.

`zig cc -target x86_64-windows-gnu -std=c11 -O1 -Wall -Wextra`:
**0 errors, 0 warnings**. `sctp_test.exe`: **51 checks, 0 failures, PASS, rc=0**.

What is covered:

- **CRC32c (RFC 3309)** against all four RFC 3720 B.4 iSCSI vectors plus the
  universal `crc32c("123456789") = 0xE3069283` and the empty-input case.
  Six published answers, none of them derived from running this code.
- **The little-endian checksum field.** RFC 3309's one exception to SCTP's
  big-endian wire format. Checked *explicitly against the byte order on the
  wire*, not just round-tripped — a big-endian store would round-trip
  through our own reader and pass every other test in the file.
- **DATA chunk byte layout**, RFC 4960 §3.3.1, byte-exact including the
  length field excluding padding (19 declared, 20 returned) and the padding
  being **zeroed** rather than left as whatever the buffer held.
- **DCEP DATA_CHANNEL_OPEN**, RFC 8832 §5.1, byte-exact for zapo's actual
  channel: `0x80 RELIABLE_UNORDERED`, reliability 0, label `wa-web-call`.
  Deliberately **unpadded** — the enclosing DATA chunk pads, and padding
  here would be read by the peer as protocol-string bytes.
- **Hostile input.** A chunk declaring length 0 ends the walk instead of
  looping forever; a chunk declaring a length past the end ends the walk
  instead of reading out of bounds; truncated datagrams are refused.
- **INIT ACK State Cookie extraction**, and cookie-absent reported as NULL
  rather than garbage.
- **Undersized buffers** return 0 from every builder rather than overrunning.

What zapo's measured usage lets this layer NOT implement, and why each is
sound rather than a shortcut:

| omitted | because |
| --- | --- |
| RFC 3758 FORWARD-TSN / PR-SCTP | `{ ordered: false }` with **no** `maxRetransmits` and **no** `maxPacketLifeTime` is unordered **reliable** |
| stream sequence numbers | the U bit is always set, and unordered DATA ignores SSN on receive (RFC 4960 §6.6) |
| State Cookie generation | zapo is offerer-only: this side sends INIT and COOKIE-ECHO, never validates a cookie of its own |
| gap-ack blocks | the cumulative ack alone, sufficient while the receive path acknowledges the contiguous prefix; the obvious next growth |

**Still unwritten for stage 4:** the association state machine, retransmission
and RTO timers, the congestion/receive windows, and the bonding of all of it
to DTLS over `scr_dgram.c`. The packet layer is the foundation, not the
feature — no association has been established with any peer, and I claim none.

---

## Gate, second (clean) run — under concurrent load

Started 21:36 under node v25.9.0, full env. It survived the session kill and
kept running; its three workers were burning CPU throughout, which is how I
confirmed it was alive rather than hung (the PARENT sits near-idle by design,
so parent CPU is not the liveness signal — worker CPU is).

**Another block's gate ran concurrently** from 21:46 (pid 12840, its own
workers). Six vitest workers on six physical cores. The suite lock did not
serialise them because it is keyed on `tmpdir()`, and each block has its own
`TMP` — so the lock is per-block here, not per-host.

**One failure:**

    × every corpus program is 100% static (corpus and coverage agree)  601867ms
      -> Test timed out in 600000ms

`coverage.test.ts:245`, hardcoded `600_000`. It calls `analyze()` once per
corpus file over 600-plus files. voipfix recorded this same test at
**578 s uncontended against the 600 s limit** and wrote that it is "one slow
neighbour from red for everyone, independently of anything here". It ran here
against a concurrent full gate.

**I am not calling that inherited without measuring it**, because there is a
mechanism by which it could be mine: this block adds a ~230-line ambient
declaration file to the roots of EVERY program, and that cost is paid once per
`analyze()` — 600-plus times inside this one test. Against a 22 s margin that
is exactly the right shape to matter.

`ambient-cost.mjs` is written for that: it runs the test's own `analyze()`
loop over a fixed, sorted sample with one untimed warm-up, and reports
mean/median per program. Run it with the ambient root present and again with
it removed, back to back on the same host, and the per-program delta times
600 is the answer. Comparing my wall time to voipfix's 578 s from another
revision on another day would not be a control.

**Not yet run.** `server.test.ts` had not reported when I last checked and its
`upgrade-read-fairness` is load-sensitive *by construction*, so I have stayed
off the CPU rather than contaminate it the way I contaminated the first run.

### The six failures, attributed

    × differential corpus (1725 programs) > 1360-spawn-sync.ts                 INHERITED
    × differential corpus (1725 programs) > 1482-spawnsync-error.ts            INHERITED
    × differential corpus (1725 programs) > 1537-os-release-spawnsync-stdio.ts INHERITED
    × differential corpus (1725 programs) > 2390-dot-requires\main.cjs         INHERITED
    × every corpus program is 100% static (corpus and coverage agree)          601867ms, LOAD?
    × server differential (78 programs) > upgrade-read-fairness                LOAD?

The first four are the inherited failure set **by name**, exactly the four the
block brief lists — not four by count.

The last two are the two the brief and the prior art independently predict
will flake under load, and this run had a second full gate on the same six
cores from 21:46:

- `upgrade-read-fairness` is described in the brief as load-sensitive **by
  construction**: it measures whether a writing peer can starve others, so
  under contention the host itself is that peer.
- `every corpus program is 100% static` was recorded by voipfix at **578 s
  uncontended against a hardcoded 600 s limit**; it came in at 601867 ms.

**Neither is called inherited yet.** Both need a solo re-run, and the static
one additionally needs the ambient-cost A/B, because this block adds a
~230-line ambient file to every program's roots and that test pays it 600-plus
times against a 22 s margin. `post-gate.sh` runs all three measurements.
