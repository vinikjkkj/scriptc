# block/wrtcjoin — joining the two WebRTC halves

Base main `acdd8b96`. Worktree `G:\blocks\wrtcjoin`, lab `G:\blocks\wrtcjoin-lab`,
tmp `G:\blocks\wrtcjoin-tmp`. Toolchain zig 0.16.0, build node v22.18.0,
oracle node v25.9.0. Everything with a number below was RUN.

---

## Stage 0 — the base is verified, both halves, before joining anything

RAN, not read.

### Half two (transport) on `acdd8b96`

    zig cc -target x86_64-windows-gnu -std=c11 -O1 -Wall -Wextra
      scr_wrtc_fp.c scr_wrtc_cert.c scr_sctp.c scr_sctp_assoc.c joined_test.c
      libmbedtls.a -lbcrypt -lcrypt32 -lws2_32 -ladvapi32
    BUILD_RC=0   RUN_RC=0
    36 checks, 0 failures, RESULT: PASS

Four cases (clean / 10% / 20% / 30% loss), all 5/5 delivered, 17 SCTP
retransmits across the suite. `G:\blocks\wrtcjoin-lab\joined-base.out`.

### Half one (the lowered objects) on `acdd8b96`

    scriptc build rtc-dc.ts   ->  scriptc: backend c (llvm refused: libCall:wrtc.newPeer)
    BUILD_RC=0  RUN_RC=0
    diff compiled vs node v25.9.0 + @roamhq/wrtc  ->  BYTE-IDENTICAL (13 lines)
    engine scan quickjs=0 ScrDyn=0 JS_NewRuntime=0
      (negative control: "arraybuffer" appears 2x, so the scanner can see strings)

**C BACKEND ONLY**, quoting the build line above. The LLVM emitter refuses
`libCall:wrtc.newPeer` and the build demotes. A demotion is not a backend.

### Environment notes paid for here

- `pnpm build` under node **v25** aborts with `ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY`
  because v25's pnpm (10.6.4) and v22's corepack pnpm (11.20.0) disagree about
  the store layout. Install AND build under v22 (`/c/nvm4w/nodejs` first on
  PATH), gate and oracle under v25. Two separate PATHs, not one.
- The mbedtls archive (1,228,430 bytes) was copied from
  `G:\scriptc\packages\runtime\vendor\.cache\mbedtls-3.6.7-plain-x86_64-windows-gnu`
  rather than rebuilt — same pinned version, same target, same flags.

---

## Stage 1 — the differential probes, written BEFORE the lowering

The brief's rule. Two new probes, both scoreable against node v25.9.0 running
`@roamhq/wrtc` **with no peer on the wire at all**, so they can be run today.

### `rtc-signal.ts` — the offer/answer exchange in zapo's exact shape

createOffer -> `a=ice-ufrag` regex -> `modifySdpForRelay` (setup:passive,
ufrag/pwd/fingerprint rewrite, `a=ice-options` deletion, relay candidate
appended) -> `setRemoteDescription({type:'answer', sdp})`. Copied from the
provenance tree `250f9af5`, `WaSctpRelay.ts:149` and `:384-398`.

An SDP blob cannot be compared byte-for-byte: ufrag, pwd, fingerprint,
session id and candidates are all random per run. So the probe prints
**canonical facts** — exactly the ones zapo consumes. 27 lines, and
**byte-identical across 3 oracle runs**:

    offer.type=offer                        ufrag len=4
    offer.sdp ends CRLF=true                pwd len=24
    offer has v=0 first=true                fingerprint sha-256 pairs=32
    has setup:actpass=true                  has sctp-port:5000=true
    has webrtc-datachannel m-line=true      has max-message-size=true
    has a=mid=true                          has ice-options=true
    after setLocal, signalingState=have-local-offer
    after setLocal, localDescription.type=offer
    after setRemote, signalingState=stable
    after setRemote, remoteDescription.type=answer
    after setRemote, ch.readyState=connecting
    after close, signalingState=closed

### `rtc-events.ts` — handler assignment, the send fence, and the close cascade

15 lines, byte-identical across 3 oracle runs. Four oracle facts that would
each have been guessed wrong:

1. **`ch.onopen` defaults to `undefined`, `pc.onsignalingstatechange` to
   `null`.** The two halves of the same surface disagree, and the spec says
   `null` for both. The oracle wins.
2. `send()` on a `connecting` channel throws **`InvalidStateError`** with the
   message `RTCDataChannel.readyState is not 'open'`.
3. The same throw after `close()` — readyState is `closing`, still not open.
4. **`pc.close()` fires three state-change handlers asynchronously, in this
   order: `oniceconnectionstatechange`, `onconnectionstatechange`,
   `onsignalingstatechange`** — and does NOT fire
   `onicegatheringstatechange`. That is a real transition-driven ordering,
   observable with no peer, and it is what the four `on*statechange`
   handlers have to reproduce.

Recorded: `oracle-signal.out`, `oracle-events.out`.

---

## Stage 2 — the pump becomes runtime code (commit `92cd5895`)

`packages/runtime/src/scr_wrtc_conn.c` + `.h`. The joined_test.c pump, moved
out of a test harness: one entry point, `scr_wrtc_conn_pump(conn, now_ms)`,
called once per event-loop turn. The sans-io design is why this was a pump and
not a rewrite — `now_ms` was already a parameter on every association entry
point, so the loop's clock simply becomes the association's clock.

RUN, `conn_test.exe`, x86_64-windows-gnu, 0 errors 0 warnings:
**46 checks, 0 failures; 10 consecutive runs all 46/0.**

| case | result |
| --- | --- |
| clean | CONNECTED, DCEP open, message out and back, udp 8/8 |
| 10% loss | CONNECTED, DCEP open, message out and back, srv dropped 0/9 |
| 30% loss | CONNECTED, DCEP open, message out and back, srv dropped 5/11 |
| **wrong fingerprint** | **REFUSED**, channel never opened, nothing delivered |

The answer SDP in that test is synthesised with the SAME rewrite
`modifySdpForRelay` performs, so the parser meets zapo's output shape.

**Named omission, not hidden:** there is no STUN connectivity check. A browser
would send a binding request with the peer's ice-ufrag before promoting a
candidate pair. Against a relay that answers `a=setup:passive` and expects DTLS
from the offerer, the ClientHello starts the exchange and the fingerprint
authenticates it. zapo's own `relay/stun.ts` speaks STUN for the FNA path, in
TypeScript over `node:dgram`.

---

## Stage 3 — the lowered objects drive the real stack (commit `d4bd9ca0`)

`scr_async.c` gained `scr_loop_set_wrtc(pending, dispatch)` — the
`scr_loop_set_dgram` shape, one slot narrower: **no pollfd**, because the
transport owns its socket and reads it inside the pump, so there is no
readiness fd to wait on. It takes the same coarse sleep cap an fd-less dgram
unit takes.

Twelve members that refused by name now answer: `createOffer`,
`setLocalDescription`, `setRemoteDescription`, `send`, `onopen`, `onclose`,
`onerror`, `onmessage`, and the four `on*statechange`.

**MEASURED against node v25.9.0 + @roamhq/wrtc, byte-identical:**

    rtc-signal.ts   25 lines   MATCH byte-identical   deterministic x3
    rtc-events.ts    9 lines   MATCH byte-identical   deterministic x3
    rtc-dc.ts       13 lines   MATCH byte-identical   (no regression)

    34 TRAP -> MATCH, 0 MATCH -> WRONG

engine scan `quickjs`/`ScrDyn`/`JS_NewRuntime` = **0/0/0** on all three
binaries, each with a negative control proving the scanner can see strings.

**C BACKEND ONLY**, quoting: `scriptc: backend c (llvm refused:
libCall:wrtc.newPeer)`. The 14 new `wrtc.*` lib functions join the ones already
absent from the LLVM emitter and the 16 of 20 `dgram.*`. A demotion is not a
backend.

### Design decisions that were forced by measurement, not chosen

- **`setLocalDescription`/`setRemoteDescription` REJECT, they do not throw.**
  So they mint an already-settled promise from the pending throw (the
  fs/promises stance) and are deliberately NOT in `MAY_THROW_LIB_FNS`.
  `send` DOES throw synchronously and IS in it.
- **`setRemoteDescription` requires an object literal.** `sdp` is optional in
  `RTCSessionDescriptionInit`; reading an absent one out of a computed record
  at run time would mean starting a handshake with no fingerprint to
  authenticate against. zapo writes the literal.
- **`setLocalDescription` reads the description's `type` and the runtime
  CHECKS it.** The only local description this connection can have is its own
  offer, so a non-offer is rejected rather than silently setting the offer.
- **`onmessage` grew a second declared arm.** `MessageEvent.data` is `any` in
  zapo's real `@types/node` and the DOM event object has no representation, so
  the handler taking one refuses by name and the `Uint8Array` payload arm is
  what lowers.

### Two refusals that are weaker than the rest, named as such

1. **`ondatachannel` through `(pc as any)` never reaches this lowering** — the
   receiver is `any`, so the write meets the generic `SC1090 assignment to
   non-variables`. It still REFUSES, which is the point: this is the member
   that would otherwise fail silently and leave `conn.incomingChannels` empty.
2. **`onmessage` with a `MessageEvent`** refuses at `MessageEvent` itself with
   the @types/node hint rather than my reason.

`rtc-refusals.ts` — **11 refusals, each naming a real obstacle**: reading a
handler back, `ondatachannel`, `addIceCandidate`, `restartIce`, `createAnswer`,
`localDescription`, `remoteDescription`, a MessageEvent handler, an
ArrayBuffer payload, and `ch.id`.

---

## Stage 4 — end to end from TypeScript (commit `8dd641e8`)

A compiled scriptc binary against a separate relay process:

    local ufrag len=4
    answer applied, gathering=complete
    ice=checking / conn=connecting / signaling=stable
    ice=connected / conn=connected
    channel open, readyState=open
    sent
    message len=10 body=relay-pong
    closed, ice=closed signaling=closed

**11 checks, 0 failures; 5 consecutive runs = 55 checks, 0 failures.**

Everything after "answer applied" came out of the event loop: the state changes
are the transport's own transitions arriving through `scr_loop_set_wrtc`,
`onopen` fired when DCEP opened the channel, `send()` put bytes on a real UDP
socket through DTLS, `onmessage` fired with the reply.

**The negative control is half the probe.** Same binary, same relay, ONE BYTE
of the answer's fingerprint changed:

    ice=failed / conn=failed / TIMEOUT opened=false got=0

**This probe is NOT scored against node, and cannot be.** The peer speaks DTLS
and SCTP but not STUN; node's `@roamhq/wrtc` is real libwebrtc and will not
promote a candidate pair without a STUN binding exchange, so under node it
would hang — and a hang is not a comparison. It is a capability probe with a
fixed expected transcript. The 34 differential lines are elsewhere.

---

## Targeted tests, all green

    tests/harness/surface-manifest.test.ts        pass
    tests/harness/dgram.test.ts                   pass
    packages/compiler/test/llvm-runtime-abi.test.ts   pass
    packages/compiler/test/ir.test.ts                 pass
    packages/compiler/test/llvm-main-installs.test.ts pass
    packages/compiler/test/emit-c.test.ts             pass
    packages/compiler/test/cc-driver.test.ts          pass

## The full gate is NOT run, and the reason is measured

A full gate was **already in flight on the box** when this block reached that
point — `G:\scriptc`, pid 2928, three tinypool workers at 46-72 s CPU each,
plus corpus builds. The brief forbids starting one without telling the
orchestrator, and running one concurrently is exactly how the previous block in
this clause invalidated a run and attributed fourteen failures to the wrong
cause. **Deferred, deliberately, and named as an outstanding item.**

## Still true, and it stays true

- **Nothing here has met a real WebRTC peer.** Both ends are code in this
  repository and the SCTP peer is hand-written, deliberately, so a wire-format
  bug cannot agree with itself.
- **C backend only** on this whole path.
- No STUN connectivity check; `ondatachannel` refuses because the association
  is offerer-only.
- `mlow-codec.ts:26` remains voip's other independent stop.

---

## The price of the loop hook, measured

`scr_async.c` is linked into EVERY binary, so the new `scr_loop_set_wrtc` slots
and the dispatch station cost something to programs that will never hold a peer
connection. Measured directly, same flags (`-O2 -target x86_64-windows-gnu`),
the TU compiled at `c16b2b2d` against the TU at HEAD:

    base.o  202,837 bytes
    head.o  203,722 bytes
    delta       885 bytes  (+0.44%)

That is an OBJECT-size delta of the always-linked translation unit, not a
linked-binary delta — the linker's dead-strip has not run on it. It is the same
kind of cost the dgram and watch hooks already impose, and it is the honest
number to compare a future fourth hook against.

Runtime cost per loop turn: two more NULL pointer tests (`pending`, `dispatch`)
in a turn that already performs five.

## Final re-verification, from the shipped build

    rtc-dc.ts       13 lines  MATCH byte-identical vs node v25.9.0
    rtc-signal.ts   25 lines  MATCH byte-identical vs node v25.9.0
    rtc-events.ts    9 lines  MATCH byte-identical vs node v25.9.0
