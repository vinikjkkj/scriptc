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
