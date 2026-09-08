# block/wrtcscope — the WebRTC data-channel clause, scoped and re-measured

Base main **`325eb515`**. Worktree `<blocks>\wrtcscope\wt`, lab
`<blocks>\wrtcscope\lab`, tmp `<blocks>\wrtcscope\tmp`.
Toolchain **zig 0.16.0** (the tree's, `<zapo-work>\tools\zig`), build node
**v22.18.0**, oracle/gate node **v25.9.0**, `SCRIPTC_TARGET=x86_64-windows-gnu`,
`SCRIPTC_CC=zigcc`, `SCRIPTC_TEST_CC="zig cc"`.
Everything below that carries a number was **RUN**. Anything unmeasured says so.

---

## 0. The headline, before anything else

**The clause is not unstarted. It is largely built, and it runs.** Two prior
blocks (`wrtc`, `wrtcjoin`) landed ICE-lite, DTLS and SCTP in C and the
lowering that drives them; all six commits are on `main`
(`6a4074f8`, `297f7530`, `92cd5895`, `d4bd9ca0`, `8dd641e8`, `2fc8e048`).

What this block adds is **verification on the current tree** — every earlier
number was taken on `9c3534a9` / `acdd8b96` / `83432479`, before five days of
merges — plus the two things nobody had measured: the lane a real consumer
gets, and connected-mode `node:dgram`.

---

## 1. The scope claim, confirmed from zapo's actual call sites

Source: the provenance checkout
`250f9af5229a545eec28ddbd3e8774a397cdb0bb`, `packages/voip/src/`. It is the
**only** provenance revision on this host, and it is the same one every prior
block read, so the surface has not moved under us.

**One import, one file, one binding**: `import wrtc from '@roamhq/wrtc'` at
`relay/WaSctpRelay.ts:5`. `rg` over all of `packages/voip/src/*.ts` finds no
other importer.

Each of the following is **0 across all of `packages/voip/src`**, not just
across `WaSctpRelay.ts` — with a positive control in the same run
(`createOffer`, `setLocalDescription`, `setRemoteDescription`, `iceServers`,
`createDataChannel` each = 1), so an empty result is absence and not a broken
enumerator:

    addIceCandidate 0   onicecandidate 0   createAnswer 0   ontrack 0
    addTrack 0          maxRetransmits 0   maxPacketLifeTime 0
    RTCIceCandidate 0   restartIce 0       RTCRtpSender 0
    RTCRtpReceiver 0    getTransceivers 0  addTransceiver 0
    setConfiguration 0

**The brief's scope claim is CONFIRMED, not stale:**

| claim | evidence |
| --- | --- |
| data-channel only | no `addTrack`/`ontrack`/transceiver of any kind; no SRTP, no codecs |
| offerer-only | `createOffer` 1, `createAnswer` 0; `setRemoteDescription({type:'answer'})` at `:398` |
| no trickle ICE | `addIceCandidate` 0, `onicecandidate` 0, `RTCIceCandidate` 0; `new RTCPeerConnection({ iceServers: [] })` at `:224` with a genuinely empty list |
| no partial reliability | `createDataChannel('wa-web-call', { ordered: false })` at `:337` with **no** `maxRetransmits` and **no** `maxPacketLifeTime` — unordered **reliable**, so RFC 3758 FORWARD-TSN / PR-SCTP is genuinely not required |

### The surface is 25 members, not 21

Mechanically enumerated over every `pc`/`channel`/`ch`/`incomingChannel`
receiver, plus the members reachable only through a cast (which a receiver
regex cannot see), plus the type-level one:

* **20** through named receivers: `iceConnectionState` (7), `readyState` (5),
  `label` (3), `onopen` (2), `onmessage` (2), `onclose` (2), `binaryType` (2),
  and one each of `signalingState`, `iceGatheringState`, `createOffer`,
  `createDataChannel`, `setLocalDescription`, `setRemoteDescription`, `send`,
  `onerror`, `id`, and the four `on*statechange`.
* **4** through `(x as any)`: `getStats` `:252`, `connectionState` `:274` and
  `:583`, `ondatachannel` `:301`, `bufferedAmount` `:586`.
* **1** type-level: `close()`, via `closeQuietly(closeable: { close(): void } …)`
  at `:22`, called at eleven sites.

### A correction to the prior art: `ondatachannel` is FIVE problems at one site

`tests/perf/wamcoord/README.md` §15.2 counts **three** `as any` casts
(`:274`, `:583`, `:586`) and files `:301` separately under the generic
message *"assignment to non-variables"*. `:301` is in fact a **fourth cast on
`RTCPeerConnection`**, and more usefully:

`incomingChannel.id` (`:306`), `.label` (`:305`), `.binaryType` (`:310`) and
an inbound `onmessage(MessageEvent)` (`:312`) are **all inside the
`ondatachannel` handler opened at `:301`**. Read directly from the source.

So `RTCDataChannel.id` — which `lower-wrtc.ts` refuses at length because the
oracle answers uninitialised memory — **is only ever read on an inbound
channel**, behind a receiver that already refuses. *A refusal is owed only
where code is reached.* The whole inbound-channel surface is **one
reachability gate**, not four independent gaps, and zapo's outbound path never
touches `id` at all.

---

## 2. What already exists, re-measured on `325eb515`

`harness/probe-matrix.sh`. Strict, **never `--best-effort`**. Ten rows,
5 probes × 2 resolution lanes, each scored byte-exact against node **v25.9.0**
running the real `@roamhq/wrtc` 0.10.0 addon.

### The two lanes, and why both are reported

A site count is the driver's alias table multiplied by the flags, so the lane
has to be named:

* **`noPkg`** — `@roamhq/wrtc` NOT installed, so the shipped ambient
  declarations (`packages/compiler/ambient/scriptc-wrtc.d.ts`) apply. Every
  earlier block measured only this lane.
* **`withPkg`** — the package IS installed. **This is the lane a real consumer
  gets**: zapo declares it as both a peerDependency (`>=0.10.0`) and a
  devDependency (`^0.10.0`).

Both lanes carry real `@types/node@24.13.3` (see §4 — without it the lane is
not zapo's).

| probe | lane | build | run | size (B) | vs oracle | engine | tier by artifact |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `rtc-dc` | noPkg | rc=0 | rc=0 | 1,360,896 | **MATCH** byte-identical | 0/0/0 | `.c` — C tier |
| `rtc-dc` | withPkg | rc=0 | rc=0 | 1,360,896 | **MATCH** | 0/0/0 | `.c` — C tier |
| `rtc-signal` | noPkg | rc=0 | rc=0 | 1,511,936 | **MATCH** | 0/0/0 | `.c` — C tier |
| `rtc-signal` | withPkg | rc=0 | rc=0 | 1,511,936 | **MATCH** | 0/0/0 | `.c` — C tier |
| `rtc-events` | noPkg | rc=0 | rc=0 | 1,361,920 | **MATCH** | 0/0/0 | `.c` — C tier |
| `rtc-events` | withPkg | rc=0 | rc=0 | 1,361,920 | **MATCH** | 0/0/0 | `.c` — C tier |
| `rtc-live` | noPkg | rc=0 | rc=0 | 1,359,872 | **MATCH** | 0/0/0 | `.c` — C tier |
| `rtc-live` | withPkg | rc=0 | rc=0 | 1,359,872 | **MATCH** | 0/0/0 | `.c` — C tier |
| `dgram-connected2` | noPkg | rc=0 | rc=0 | 700,416 | **MATCH** | 0/0/0 | **`.ll` — LLVM tier** |
| `dgram-connected2` | withPkg | rc=0 | rc=0 | 700,416 | **MATCH** | 0/0/0 | **`.ll` — LLVM tier** |

`engine` is `quickjs`/`ScrDyn`/`JS_NewRuntime`, each **with a live positive
control** (§5). Fence count is **0 coded (excluding `SC900x`) and 0 uncoded
refusal strings** on every row.

**The `withPkg` column is new.** Every earlier WebRTC number in this repository
was `noPkg` only. The two lanes agree byte-for-byte, which is what
`2fc8e048`'s island row bought and had never been shown on more than one probe.

**Every WebRTC row is C tier, and that is read off the artifact, not off the
log.** The build prints `backend c (llvm refused: libCall:wrtc.newPeer)` and
leaves a `.c` with no `.ll`. *A demotion is not a backend.* For the objective
as stated — a pure-C binary with no quickjs — this is a **pass**, not a
failure: the engine scan is 0/0/0. It is only a gap against the LLVM tier.

---

## 3. The end-to-end slice, rebuilt and re-run on `325eb515`

`harness/e2e.sh`. A **compiled scriptc binary from TypeScript** (strict, no
`--best-effort`, 1,508,864 B, engine `quickjs=0 ScrDyn=0 JS_NewRuntime=0`,
control `ice-ufrag`=4) against a separate relay process speaking DTLS 1.2 and
SCTP over a real UDP socket.

    3 runs, 33 checks, 0 failures, RESULT: PASS

Everything after *"answer applied"* arrives through the event loop:
`ice=connected`, `conn=connected`, `channel open, readyState=open`, `send()`,
`onmessage len=10 body=relay-pong`, and the close cascade.

**The negative control is half the probe, and it passes in all three runs:**
the same binary against the same relay with **one byte** of the answer's
fingerprint changed reports `ice=failed / conn=failed / TIMEOUT opened=false`.
A stack that connects in both cases has no authentication at all — RFC 8122's
fingerprint is the only identity check WebRTC has.

**What this does NOT prove, and the prior block said so too:** the peer is code
in this repository, so a wire-format bug could agree with itself. It speaks no
STUN. **Nothing here has met a real WebRTC peer or WhatsApp's relay.**

---

## 4. The ICE half: measured, and smaller than the brief assumed

The brief's open question was *"the ICE half may be zapo's own TypeScript,
needing `node:dgram` rather than a C library."* **Confirmed, and narrower.**

1. **`relay/stun.ts` makes no socket calls at all.** 567 lines, and
   `rg -c 'dgram|socket|Socket'` = **0**. It is a pure packet builder/parser
   over `bytes.ts` and `crypto/primitives.ts`. Prior art described it as
   *"pure TypeScript over `node:dgram`"* — the first half is right, the second
   is not. The socket lives in `WaSctpRelay.ts`.
2. **`stun.ts` has zero blocker sites in every committed lane**
   (`tests/perf/wamcoord/sites/V-*.json`), and it is **reached** — no
   `unreached` entry names it, and its importer `WaSctpRelay.ts` is fully
   analysed.
3. **Connected-mode `node:dgram` already works, at BUILD level.**
   `WaSctpRelay.ts` uses two calls the two prior dgram probes never
   exercised — both used only the unconnected three-argument `send`:

       :455   socket.connect(relayInfo.port, relayInfo.ip, () => { … })
       :663   conn.udpSocket.send(new Uint8Array(data))     // ONE argument

   Neither produces a blocker site. But **a closed site count is not a build**:
   `analyze()` stops before `ir/validate.ts` and before both emitters. So
   `probes/dgram-connected2.ts` writes both calls in zapo's exact shape and
   **builds, runs, and MATCHes the node oracle byte-identically**, 700,416 B —
   **and emits a `.ll` with no `.c`, on the LLVM tier**, extending wamcoord's
   §13.6 refutation to the two functions zapo actually needs.

**So the ICE half needs no vendored C and no new compiler work.** That is the
largest single reduction in this clause's remaining cost.

---

## 5. The gap, in three classes

zapo's entire WebRTC wall is **26 blocker sites in one file**,
`packages/voip/src/relay/WaSctpRelay.ts`, on the consumer lane
(`tests/perf/wamcoord/sites/V-A2-both.json`, 45 blockers total for `voip`).
They decompose exactly — 11 + 8 + 7 = 26, with nothing left over:

### (a) Needs a C implementation — **none**

ICE-lite, DTLS 1.2 and SCTP are **written, committed and running** (§3).
mbedTLS 3.6.7 is vendored and pinned; a program that opens a peer connection
pays **657,408 → 1,490,944 B** for it, and a program that does not pays
**nothing** (the gate is at the link line in `cc.ts`, not at dead-strip).

Named omissions, unchanged: no STUN connectivity check, no association for an
inbound DCEP OPEN, no gap-ack blocks, no PR-SCTP (and §1 shows PR-SCTP is not
needed).

### (b) zapo's own TypeScript needing only compiler support — 7 sites

| sites | site | what it needs |
| --- | --- | --- |
| 2 | `:252`, `:253` | `getStats` — absent from `lower-wrtc.ts` **and** behind an `as any`. Both halves are load-bearing; and `RTCStatsReport` is a further handle question |
| 1 | `:301` | `ondatachannel` — refuses **deliberately and loudly**, because the SCTP unit is offerer-only. It gates the whole inbound surface (§1) |
| 1 | `:367` | `MessageEvent` on the **outbound** channel's `onmessage` |
| 1 | `:441` | `dgram.createSocket` with a **non-literal** options argument (`isIPv6(ip) ? 'udp6' : 'udp4'`) |
| 1 | `:676` | `Function.name` (`data.constructor.name === 'SharedArrayBuffer'`) |
| 1 | `:684` | `send` of an `ArrayBuffer` |

Only `:684` and `:367` are WebRTC-surface work. `:441` is a one-line dgram
widening. `:676` is not WebRTC at all.

### (c) Neither — 19 sites, and they are not compiler work

* **11** are `closeQuietly`'s structural parameter meeting four different
  **handles** (`SC2003`). Nominal-to-structural already works; only a handle
  refuses, because a handle has no shape for a structural arm to match. The
  representation decision was **declined with its cost written down**
  (wamcoord §14.2) — boxing changes identity, the `Date` divergence class.
* **8** are three `as any` casts zapo writes over members `lower-wrtc.ts`
  **already supports** (`connectionState`, `bufferedAmount`). The control is
  one line away: `pc?.iceConnectionState` at `:582` carries no cast and no site.

**We do not change zapo.** These 19 are a finding to report, not a change to
make. If zapo dropped four casts and one parameter type, 19 sites go with no
compiler change at all.

---

## 6. Findings nobody asked for

1. **The fallback `.d.ts` cannot express connected-mode dgram.**
   `scriptc-node-fallback.d.ts:3224` declares only
   `send(msg, port: number, address: string): void`. Real `@types/node@24`
   declares six `send` overloads. A project without `@types/node` therefore
   gets `SC0001: Expected 3 arguments, but got 1` on `socket.send(bytes)` —
   **a type error that looks exactly like a missing lowering and is not one.**
   It cost this block one run. `connect()` *is* in the fallback (`:3223`), so
   the gap is one overload wide.
2. **`ch.id` is not on zapo's reachable path** (§1). The `lower-wrtc.ts`
   refusal for it is correct but is not blocking anything zapo does.
3. **`tests/perf/wamcoord/README.md:64` is stale** against its own §16 and
   against commit `1fa0aebb`: it says the compiler-side tail is *"17 sites over
   14 distinct messages"*; §16 and the site JSON both say **16** messages.
4. **The mbedTLS archive and the mbedTLS headers are in different trees.**
   The archive is `packages/runtime/vendor/.cache/mbedtls-3.6.7-plain-…/`,
   the headers `packages/runtime/vendor/mbedtls/include/`. Pointing `-I` at
   the cache fails as `'mbedtls/md.h' file not found`, which reads like a
   broken vendor tree and is a wrong flag.

---

## 7. The instruments, and their self-tests

`harness/guard.mjs` — refuses to run unless all eight cache variables are set
**and** start with `G:`. Adapted from `tests/perf/clientbench/harness/`.
Self-tested **in both directions after every edit**: refuses unset (rc=2),
refuses `C:\…` paths (rc=2), accepts the pinned env (rc=0).
`Test-Path <home>\.cache\scriptc` is **False** before the first
build and after the last.

`harness/self-test.sh` — *a harness that cannot report "nothing changed"
cannot be trusted when it does, and one that cannot report a difference cannot
be trusted when it says MATCH.* Both directions, on two probes:

    ok  A/A  rtc-dc            reports NO DIFFERENCE (MATCH)
    ok  A/B  rtc-dc            reports WRONG (2 lines) vs a perturbed oracle
    ok  scan finds the control string 'pc.signalingState' 2x in the binary
    ok  A/A  dgram-connected2  reports NO DIFFERENCE (MATCH)
    ok  A/B  dgram-connected2  reports WRONG (2 lines) vs a perturbed oracle
    ok  scan finds the control string 'client connected' 1x in the binary

The engine scan's control is **derived from the probe** (the first line it
printed, truncated at `=`), not hardcoded. A hardcoded `RTCDataChannel`
reported `SCAN-UNTRUSTWORTHY` on a perfectly good dgram binary — the guard
working, but the guard should not have to.

The tier is read **off the artifact** (`.ll` vs `.c`), never off the absence of
a demotion line.

---

## 8. Reproducing

    . tests/perf/wrtcscope/harness/env.sh          # gate + oracle lane, v25.9.0
    . tests/perf/wrtcscope/harness/env-build.sh    # pnpm install/build only, v22.18.0
    sh tests/perf/wrtcscope/harness/probe-matrix.sh rtc-dc rtc-signal rtc-events rtc-live dgram-connected2
    sh tests/perf/wrtcscope/harness/self-test.sh rtc-dc noPkg
    sh tests/perf/wrtcscope/harness/e2e.sh 3

The oracle is `npm install @roamhq/wrtc@^0.10.0` in a lab project of this
block's own. **zapo is never installed into and never modified.**
Recorded output: `runs/probe-matrix.out`, `runs/e2e-3runs.out`.

---

## 9. The cost statement for the seven compiler-side sites

All seven are in `packages/voip/src/relay/WaSctpRelay.ts`. Sizing is by
comparison with work already done in `lower-wrtc.ts` (25,358 bytes, twelve
members served), NOT by measurement — no fix was built, and every estimate
here is a judgement, labelled as one.

| site | what it is | class | rough cost | risk |
| --- | --- | --- | --- | --- |
| `:441` | `dgram.createSocket(isIPv6(ip) ? 'udp6' : 'udp4')` — a **non-literal** options argument | dgram widening | **smallest**. The literal arm already lowers; this needs a runtime-selected family | low; `udp6` may be untested on that path |
| `:684` | `channel.send` of an **`ArrayBuffer`** | WebRTC surface | small. `send` of `Uint8Array` already lowers; one more declared arm | low |
| `:367` | outbound `channel.onmessage = (e: MessageEvent) => …` | WebRTC surface | **medium, and not really a WebRTC problem.** `MessageEvent.data` is `any` in zapo's real `@types/node`; needs a representation for a DOM event object, or a narrowing that serves `.data` without one | medium — the `any`-typed-DOM-object question is bigger than this clause |
| `:676` | `data.constructor.name === 'SharedArrayBuffer'` — `Function.name` | not WebRTC | medium; needs a name on constructor values | medium — reaches the object model |
| `:252`, `:253` | `getStats?.()` | WebRTC surface | **medium-large, two problems stacked**: absent from `lower-wrtc.ts` *and* behind `(pc as any)`. `RTCStatsReport` is a further handle with a map-like surface | medium; degrades safely today |
| `:301` | `ondatachannel` | WebRTC surface | **largest by far** — below | high |

**Only `:684` and `:367` are WebRTC-surface work in the ordinary sense.**
`:441` is dgram, `:676` is the object model, and `:252`/`:253` are as much a
handle-representation question as a WebRTC one.

### `:301` is the one real feature, and it is not a lowering

`ondatachannel` does not refuse because nobody wrote the table row. It refuses
because **the SCTP association is offerer-only and does not accept an inbound
DCEP `DATA_CHANNEL_OPEN`**. Closing it is transport work in
`scr_sctp_assoc.c` — accept an inbound stream, mint a channel handle from C,
fire a handler with it — not a row in `lower-wrtc.ts`.

It is also **the only one of the seven whose refusal currently protects
against a silent wrong answer.** It is reached through `(pc as any)`, so no
type error names it; if it merely never fired, `conn.incomingChannels` would
stay empty and nothing would say why.

**What we do not know:** whether zapo's relay path needs inbound channels in
production. It is written, so WhatsApp's relay presumably opens one at least
sometimes — but nothing here has met that relay. That question decides whether
`:301` is first on the list or last, and it is the user's to answer.

### The 19 that are not compiler work

11 declined handle-representation sites (`closeQuietly`) and 8 sites from four
`as any` casts over members `lower-wrtc.ts` **already supports**. If zapo
dropped the casts and widened one parameter type, all 19 close with **no
compiler change at all**. We do not change zapo; this is a finding.

---

## 10. `send_group` is NOT curve25519, and the inherited attribution is refuted

> **PARTLY SUPERSEDED BY §12.** The refutation of the 44.18% node-lane
> figure stands. But this section then adopted `cpuphase`'s `scr_arr_slice`
> **21.0%** as the corrected owner, and §12 refutes that too — by counting.
> I repeated the exact error I had just diagnosed: I trusted a profile
> share instead of a call count.

`tests/perf/clientbench/README.md:157` attributes the compiled client's one
regression — `send_group` — to *"zapo's own curve25519 field arithmetic
(44.18% of non-idle samples)"*, citing `tests/perf/cpuphase`.

**`cpuphase` does not say that about the compiled binary. Its own later,
better-instrumented section says the opposite.**

The 44.18% is `cpuphase` §1, and that section names its lane in its own
header: *"Shares of non-idle samples, **node lane**, `--cpu-prof`"*. It was
measured to kill the protobuf hypothesis, and for that it is sound. But it
describes where **node** spends `send_group`. The regression is
compiled-versus-node, so the question is where the **compiled binary** spends
it — a different profile on a different instrument.

`cpuphase` §"Three compute phases, full workload, shipping binary" answers
exactly that, phase-scoped and cycle-weighted:

| phase | dominant self-time |
| --- | --- |
| `send_group` | `scr_arr_slice` **21.0%**, `scr_arr_join` 7.3%, `add_and_denorm128` 7.0%, `feMul` **5.8%** — *"array work, **not** crypto"* |

and it says in terms: ***"`send_group` and `recv_group` had never been
attributed at all**, and neither is crypto-bound."*

So in the compiled lane field arithmetic (`feMul`) is **5.8%**, while
scriptc's **own array runtime** is `21.0 + 7.3 = 28.3%` — about five times
larger. The owner is not zapo's TypeScript. It is `scr_array.c`.

### `add_and_denorm128` is not curve25519 either — it is a *software* FMA

It appears in **no source file in this repository**. It is
`fn add_and_denorm128(a: f128, b: f128, scale: i32) f128` at
**`lib/compiler_rt/fma.zig:271`** in the tree's zig 0.16.0, reached from
`fmaq` (f128) via `fmal` (`c_longdouble`). That is **software 128-bit
floating-point multiply-add**, contributed by the toolchain, at 7.0% of a hot
phase.

Neither `emit-c.ts` nor any runtime `.c`/`.h` mentions `fma`, `fmal`, `fmaq`,
`long double` or `__float128` — so nothing in scriptc asks for it directly and
it arrives through libc.

**Hypothesis, explicitly not a measurement:** `scr_json.c:6872` calls
`strtod`, and mingw-w64's `strtod` is `__mingw_strtod`, which works in long
double. `scr_json.c:6796` describes a fast path *"bit-identical to strtod"*
with *"everything else falls back"*, so the **fallback rate** is the thing to
measure. Confirming the caller needs a symbol-level profile — `clientbench`'s
instrument and its territory. **Not re-measured here.**

### What this changes

The prize moves from unreachable to reachable. Curve25519 field arithmetic is
zapo's TypeScript and **we may not edit it**. `scr_array.c` and the JSON
number path are **scriptc's own C**, and a software f128 FMA in a hot loop is
a toolchain/lowering question, not an algorithmic one.

`scr_arr_slice` has already had one round of this work — its own comment
describes replacing a per-element retain-kind test with a single `memcpy` — so
the remaining 21.0% is more likely **call volume and allocation** (it mints a
fresh `ScrArr` per call, and `n ? n : 1` means even an empty slice allocates)
than per-element cost. **Unverified.**

The honest next step is a call-count and size histogram, and the instrument
already exists: `scr_array.c` carries `SCR_ARRCEN_ON` /
`scr_arrcen_note_slice(len, n, elem)`, inert unless a header is `-include`d,
whose own comment says it is *"the only way to tell a quadratic here from a
million small copies."*

**No fix is proposed here and none was measured.** The claim is only that the
attribution was wrong, that the corrected owner is scriptc's own code, and
that an instrument for the next question already exists.

---

## 11. The `scr_arr_slice` census — instrument self-test

Before pointing `tests/perf/arrcensus` at `send_group`, it was scored against
a program whose slice and join behaviour is known exactly
(`probes/slice-known.ts`): 1,000 partial slices (3 of 10), 100 whole-array
slices, 50 empty slices, 200 joins of a 5-element array. **The prediction was
written down before the run.**

| predicted | reported | |
| --- | --- | --- |
| slice calls 1,150, all src=10 | `slice-src calls=1150`, `ROW slice-src 10 1150` | ok |
| slice-n: 3 ×1000 | `ROW slice-n 3 1000` | ok |
| slice-n: 10 ×100 | `ROW slice-n 10 100` | ok |
| slice-n: 0 ×50 | `ROW slice-n 0 50` | ok |
| slice whole 100 | `ARRCEN-SLICE whole=100` | ok |
| slice empty 50 | `ARRCEN-SLICE empty=50` | ok |
| join 200 calls, src=5 | `ROW join-src 5 200` | ok |
| join output 9 B ×200 | `ROW join-outbytes 9 200` | ok |

**Eight of eight exact.** And it reports the expected NULLs in the same run —
`str2num`, `jsonstr`, `mapkeys`, `bytesset` all `calls=0` for a program that
uses none of them. It can say "yes" and it can say "no".

### A property of the ARM control that was not written down

`SCR_ARRCEN_ARM=n` is the instrument's positive control: it plants slices of
`src=41`/`n=7` before `main`. Measured here, `planted` reads `n` but the
planted **rows** read `n × 20`, constant across `n=1, 3, 7`:

    ARM=1 -> planted=1, slice-src row41 = 20
    ARM=3 -> planted=3, slice-src row41 = 60
    ARM=7 -> planted=7, slice-src row41 = 140

The planting constructor is `static` (so one copy per **translation unit**,
each with its own `done` guard) while `scr_arrcen_planted` is `selectany` (one
shared instance). So the multiplier is the TU count.

The header's documented check — *"the row must then read at least n, and
planted must equal n"* — still passes, so **the control is sound**. But an
armed run's slice counts are inflated by `20n` and **must never be read as the
real ones**. The unarmed run is the one to read, and `census.sh` runs both in
that order for exactly this reason.

### `SCRIPTC_NO_CACHE=1` is no longer required, and the header's note is stale

`scr_arr_census.h`'s usage block says to set it *"(the header is outside
packages/runtime/src and so is not in the build-cache key)"*. That was true
once. `cc.ts`'s cache-flavor discriminator now **folds the CONTENTS of every
file a `-include` names** into the key — its own comment explains that hashing
the flag string alone let a header edit go unnoticed and cost a block three
runs that had measured the previous instrument.

Verified in both directions on this tree, with no `SCRIPTC_NO_CACHE`:

* build with `SCRIPTC_PROF_CFLAGS` unset → the program writes **no report**
  (the census is genuinely absent, not silently cached in);
* rebuild with it set → report written, and identical to the first
  instrumented build (1,150 / whole=100 / empty=50).

This matters beyond tidiness: it is the difference between a cached bench
build and a cold one.

---

## 12. The census answer: `scr_arr_slice` is not 21% of anything

Run on `548e73b7` (main `77ff3fe5`), `bench-noprof`, **the shipped default
workload** — 1,000 contacts × 2 devices, 4 groups × 500 members, 1,000
messages × 4 scenarios, exit 0, all four scenarios present in the transcript.
Build 815 s, 28,882,944 B, 15 emitted TUs. Armed control first
(`planted=5`, planted rows present), then the unarmed run for the numbers.

### `scr_arr_slice`, whole program, full workload

    calls                 4,015
    elements copied           2        (total. two.)
    max copied length         1
    empty (n = 0)         4,013        99.95% of all calls
    source length      mean 0.50, max 5
    calls with source >= 256 elements     0

**`cpuphase`'s `scr_arr_slice` 21.0% cannot be true.** This is a
whole-program count, so it is an *upper bound* on any single phase — no phase
markers are needed to say that `send_group`'s slice cost is at most this, and
this is 4,015 calls that move two elements in the entire run.

It is neither a quadratic nor a million small copies. **It is almost nothing**,
and 99.95% of it is the degenerate empty slice that still allocates
(`n ? n : 1`). Whatever the sampler attributed to that symbol, the function
did not do it. The most likely mechanism is symbolisation: a `static` or
inlined function has no symbol of its own, so its samples land on the nearest
symbol that does. **Not confirmed** — confirming it needs the sampler's own
instrument, not this one.

### `scr_arr_join` — real, and the one array cost that survives

    calls          4,017
    elements   1,014,169   mean 252.5, max 500      <- 500 = members/group
    out bytes 30,184,222   mean 7,514, max 14,999
    top source lengths: 256..511 x2,008,  8 x1,004,  2 x1,000

30 MB of string built by an initial 64-byte `malloc` grown by doubling
(`scr_join_append`). 2,008 of the calls join arrays of 256–511 elements, and
`max 500` is exactly the group size — so this is the group fan-out, and the
7.3% is plausible where the 21.0% is not. **Unaddressed.**

### What the census says the phase actually spends itself on

    scr_bytes_get   336,490,043 calls      scr_bytes_set   189,944,781
    TOTAL element accesses  526,434,824
      f64   482,252,788   91.61%
      u8     36,043,389    6.85%
      u32      7,036,032    1.34%
      i8       1,102,615    0.21%
    dominant buffer length: 16  (314,255,551 get / 167,997,434 set,
                                 equal to the f64 counts to the access)

Half a billion typed-array element accesses, 91.6% of them on a
**sixteen-element `Float64Array`** — tweetnacl-style GF(2^255−19) limbs.

### This half was already found, and fixed, by someone else

`scr_runtime.h` on this same main already carries the identical finding, with
`send_group`-scoped numbers (f64 92.15%, u8 6.27%) that match this
whole-program run to within a percent, the identification of
`src/crypto/math/fe.ts`'s `export type Fe = Float64Array`, and the history:
a **u8-only** fast arm was priced at 10.63 G instructions removed, the A/B
measured **1.000x**, and that null was misread as "the phase is stalled"
when the real reason was that only 6.27% of accesses ever entered the arm.
The f64 arm landed in **`734015a8`** and is on by default, with
`SCR_NO_F64ARM` kept as the A/B control.

So this run **independently reproduces that result on a different instrument
run** — worth having as a cross-check, but not new. The new part is the slice
refutation above.

### A caveat that must travel with these numbers

Under `SCR_ARRCEN_ON` **every fast arm is compiled out** and both accessors
become plain forwards — deliberately, so the census can count calls that the
inline arm would otherwise satisfy invisibly. These are therefore **valid
counts and not a performance profile of the shipping binary**.

And this run has **no phase data**: `bench-noprof` has no phase markers. My
earlier grep found `phase-begin=1` in it and I read that as a marker — it is a
**comment** at `:485` mentioning the markers. The instrument reported
`phases: 0` and the reader printed `NONE`, which is how it was caught. The
per-phase split would need `ladder-phasemarks.mjs` applied and a rebuild; it
is not needed for the slice refutation, which a whole-program bound settles.

### Corrected picture for `send_group`

| claim | status |
| --- | --- |
| curve25519 field arithmetic, 44.18% | node-lane profile; not the compiled lane (§10) |
| `scr_arr_slice` 21.0% | **REFUTED by call count** — 4,015 calls, 2 elements |
| `scr_arr_join` 7.3% | **stands**; 30 MB over 4,017 calls; unaddressed |
| `add_and_denorm128` 7.0% | software f128 FMA from compiler_rt; caller still unidentified (§10) |
| typed-array element access | the real volume, 526 M; **already fixed** in `734015a8` |

**No optimisation is proposed here and none was written.**

---

## 13. The coverage question is closed: 98.46%, and the whole residual is one clause

Second census build on `5115e55e` (908 s, 28,944,384 B, +61,440 for the
classifier), same shipped default workload, armed control then unarmed.

**The brief's premise was the pre-`734015a8` state.** "93.73% of the traffic
misses the arm" was true of the **u8-only** arm. `734015a8` added an f64 arm
*and hoisted the index check ahead of the kind test*, so the shipping arm
serves u8 **and** f64. Measured, not reasoned:

    accesses            528,299,181     (= bytesget + bytesset exactly:
                                           every access is classified)
    ENTER the arm       520,158,947     98.4592%
      HIT-f64           484,115,396     91.6366%
      HIT-u8             36,043,551      6.8226%
    MISS                  8,140,234      1.5408%
      MISS-kind           8,140,234      1.5408%
      MISS-index-window           0
      MISS-fractional             0
      MISS-out-of-bounds          0
      MISS-value-window           0

### The whole miss is the kind clause, and it is two kinds

    u32   5,024,016 get + 2,012,016 set = 7,036,032
    i8      501,777 get +   602,425 set = 1,104,202
                                          ---------
                                          8,140,234   = MISS-kind, exactly

The four zeros are a result in their own right. In 528 million typed-array
accesses this program never once indexes with a fractional number, a negative,
a NaN, an infinity, a value past 2^53, or an out-of-bounds index. Index form
is **not** a coverage problem here; nothing but element kind is.

### Confirming the inherited 6.27% on a separate instrument

The u8 share is **6.82%** whole-program against the inherited **6.27%** of
`send_group`, and `HIT-u8` equals the u8 kind count to the access — so under
the old arm *every* u8 access entered and *nothing* else did, which makes the
u8 share exactly the old arm's coverage. The inherited number is **confirmed**
in magnitude and in meaning, from a different build and a different run.

### What raising coverage would take — and why it is not worth taking

| class | accesses | what it needs |
| --- | --- | --- |
| u32 / i8 **reads** | 5,525,793 (1.05%) | **small widening.** Pure loads, no coercion — a 4-byte memcpy and a sign-extended byte, the same shape as the f64 read arm. Two more branches after the already-shared index check. |
| u32 / i8 **writes** | 2,614,441 (0.49%) | **semantics attached.** `ToUint32` and `ToInt8` are wrapping coercions and need the int64 value window, exactly as the u8 store arm does. A known shape, not a new one — but it is coercion semantics and getting it wrong is silent. |
| everything else | **0** | **nothing to do.** No index-form miss exists to fix. |

**The ceiling is the finding.** Capturing the entire residual is worth about
**0.16 G instructions** against the **9.68 G** the f64 arm already takes —
**1 : 59**. And the cost is not zero: every kind added is another branch on the
path that **98.46%** of accesses already take, so a wider arm can lose the hits
more than it wins the misses. This lever has been pulled. **I do not recommend
widening it, and I have not written it.**

### Precision of these numbers

Across two independent builds and runs, `scr_arr_slice` and `scr_arr_join`
reproduced **exactly** (4,015 / 2,016 / 4,017 / 1,014,169) while the element
accesses moved **+0.35%**. The nondeterminism is therefore inside the crypto —
random keys and nonces — and not in the message plumbing. Read these shares to
two significant figures, not to the access.

### The board

`scr_arr_join` is now the live lever, not the fallback: 4,017 calls,
30,184,222 output bytes from a 64-byte `malloc` grown by doubling, 2,008 of
them joining 256–511-element arrays, max source **500 = members per group**.
It is the group fan-out by construction and it is unaddressed.

---

## 14. `scr_arr_join` is 4.3 ms. The third attribution falls, and `send_group` is crypto after all

Third census build (`2af9e858`, 1,025 s, 28,987,392 B), same workload, armed
control then unarmed. `join-src`, `join-outbytes` and every `slice` counter
reproduced the two earlier runs **exactly** — join is deterministic, as the
precision caveat says.

### The three candidate costs, separated

**1. Per-element conversion: ZERO.** Every one of the 4,017 joins is
`SCR_ELEM_STR`:

    ARRCEN-JOINK str calls=4017 elems=1,014,169     (no f64, no bool)

`scr_f64_to_str` is never called from join in this workload. The candidate is
not small — it is **empty**.

**2. Reallocation: real, bounded, and sharply bimodal.**

    join-grows        total 16,064   mean 4.00/join   max 8
    join-movedbytes   total 32,650,080  = 1.0817x output bytes

      2,008 joins (256-511 elements, ~14,999 B out)  ->  8 growths each
      2,009 joins (8 and 2 elements, 8 and 58 B out) ->  0 growths, ever

2,008 x 8 = 16,064 exactly. **Half the joins never grow at all.** The
`moved` figure is an *upper bound* — `realloc` may extend in place and then
copy nothing; the instrument cannot see which happened, because that is the
allocator's business. The independent growth model predicted 1.05-1.08x
before the run; measured **1.0817x**.

**3. Allocation churn: negligible.** 4,017 `malloc` + 16,064 `realloc` +
4,017 `scr_str_alloc` + 4,017 `free` = **28,115** allocator operations, in a
run that performs 528 million element accesses.

**And a fourth the source only shows on reading:** `scr_str_new(buf, len)`
copies the finished buffer into a fresh allocation and frees the buffer, so
**every emitted byte is memcpy'd twice** — 60.4 MB of guaranteed copying over
2,024,321 append memcpys whose mean piece is **14.9 bytes**.

### Then it was measured, not estimated

`join_replay.c` replays the exact measured shape — 2,008 x ~500 elements,
1,004 x 8, 1,000 x 2 — through a verbatim `scr_join_append` and
`scr_arr_join`'s own `scr_str_new`-and-free tail. It emits **30,172,052**
bytes against the measured **30,184,222**, faithful to 0.04%.

    the whole run's join work: 4.28, 4.42, 4.31 ms   (3 runs)

| | |
| --- | --- |
| 7.3% of `send_group` would be | **845 ms** (this build) / **983 ms** (clientbench) |
| measured replay | **4.3 ms** |
| gap | **197x - 229x** |

The replay is a **floor**: isolated, everything warm, none of the real
program's cache pressure. But cache effects are worth single-digit multiples,
not **229x**. **`scr_arr_join` at 7.3% is refuted.**

### Three for three, and that is a finding about the instrument

Every array attribution `cpuphase` made for `send_group` has now fallen to a
count:

| claim | fate |
| --- | --- |
| curve25519 field arithmetic 44.18% | wrong lane (section 10) |
| `scr_arr_slice` **21.0%** | 4,015 calls moving **2 elements** (section 12) |
| `scr_arr_join` **7.3%** | **4.3 ms against 845 ms claimed** (section 14) |

Three refutations, three different mechanisms of being wrong, and the
symbolisation hypothesis from section 12 is now much stronger: a `static` or
inlined function has no symbol, so its samples land on the nearest one that
does, and `scr_array.c`'s exported functions are exactly the kind of nearby
symbol that collects them. **`cpuphase`'s symbol attribution for this binary
should not be believed without a count.** That is worth more than any one of
the three.

### So where does `send_group` actually go? Back to crypto

The one thing the census found that is *not* small is the typed-array element
path: **528,299,181 accesses, 91.6% of them f64 on sixteen-element
`Float64Array`** — the GF(2^255-19) limbs of `src/crypto/math/fe.ts`. At the
~20 instructions per access measured for the arm, that is order **10 G
instructions**, the right size for an 11.6-second phase in which nothing else
measured exceeds single-digit milliseconds.

So `send_group` **is** the crypto. The inherited "array work, **not** crypto"
headline was wrong on both symbols it named, and the original 44.18% was
directionally right about the domain while being unusable as a number. The one
real lever there — the element accessors — was found and pulled by another
block in `734015a8`.

### What a fix would cost and risk, if anyone wants it anyway

Presizing the buffer (a pre-pass summing `s->len`) would remove all 16,064
reallocations and let the join build straight into the `ScrStr`, removing the
second copy: **~30 MB of memcpy and 16 k reallocs**.

- **It costs an extra full traversal of every joined array**, paid by *every*
  caller. Here **2,009 of 4,017 joins never grow at all** and would pay the
  pre-pass for nothing.
- **`scr_arr_join` is shared by the whole corpus**, and changing its allocation
  behaviour perturbs the allocator's block reuse — which `scr_string.c`'s
  one-slot spare-string cache is deliberately tuned around.
- **The ceiling is 4.3 ms of 11,577 ms — 0.037%.**

**Not worth doing. I have not written it.**
