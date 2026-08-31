# block/wrtc — WebRTC data-channel clause

Base main `9c3534a9`. Worktree `G:\blocks\wrtc`, lab `G:\blocks\wrtc-lab`, tmp `G:\blocks\wrtc-tmp`.
Toolchain verified: `zig 0.16.0`, PATH node `v22.18.0`, oracle node `v25.9.0`
(`/c/Users/vinicius/AppData/Local/nvm/v25.9.0/node`).

## Stage 0 — verifying the brief

Source of truth read:
`G:/zapo-work/caches/bridge-provenance/250f9af5229a545eec28ddbd3e8774a397cdb0bb/packages/voip/src/relay/WaSctpRelay.ts`
(1,025 lines, 37,129 bytes).

### CONFIRMED

- One import site, one binding: `import wrtc from '@roamhq/wrtc'` at `:5`. Only
  other mention is `new wrtc.RTCPeerConnection({ iceServers: [] })` at `:224` —
  `iceServers` genuinely **empty**.
- Absent, each `rg -c` = 0: `addIceCandidate`, `onicecandidate`, `createAnswer`,
  `ontrack`, `addTrack`, `maxRetransmits`, `maxPacketLifeTime`, `RTCIceCandidate`,
  `restartIce`. So: no trickle ICE, offerer-only, data-channel-only, and
  **unordered reliable** — RFC 3758 FORWARD-TSN not required. All as briefed.
- `createDataChannel('wa-web-call', { ordered: false })` at `:337`;
  `channel.binaryType = 'arraybuffer'` at `:342`.
- `createOffer()` at `:384` then `setLocalDescription` `:385`, `a=ice-ufrag` regex
  `:387`, `modifySdpForRelay` `:390`, `setRemoteDescription({type:'answer'})` `:398`.
- `MessageEvent` used at `:312` and `:367`.
- The 18-member access set is exactly as briefed (enumerated by regex over all
  `pc.`/`channel.` member reads).
- mbedtls: `MBEDTLS_SSL_PROTO_DTLS` defined at `mbedtls_config.h:1982`,
  `MBEDTLS_SSL_PROTO_TLS1_2` at `:1855`. Present as briefed (**building it is
  still unmeasured**).
- `packages/runtime/src/scr_dgram.c` exists (42,638 b) and registers with the
  loop at `:1018` via `scr_loop_set_dgram`; `scr_async.c:2110` calls it.

### THREE CORRECTIONS TO THE BRIEF

**1. `close()` is a further member, and it is type-level.**
`closeQuietly(closeable: { close(): void } | ...)` at `:22` is called with
`conn.peerConnection` (`:426`, `:637`, `:1006`), `conn.channel` (`:424`,
`:1004`) and `conn.incomingChannels[]` (`:425`, `:636`, `:1005`). That is a
structural constraint: **without `close(): void` on both `RTCPeerConnection` and
`RTCDataChannel` the declarations do not typecheck.** The 18-member list omits it.

**2. Three more members are reached through `(pc as any)` — runtime-only, not
type-level.** `getStats?.()` at `:252`, `connectionState` at `:274`,
`ondatachannel =` at `:301`. They raise no type error, so they do not block
stage 1, but the runtime surface is 21 members, not 18. `getStats?.()` is an
optional call and degrades safely; `connectionState` reads `undefined`;
**`ondatachannel` silently never fires**, so `conn.incomingChannels` stays empty.

**3. The largest one: zapo has its own STUN stack and a second, non-wrtc relay
path.** `relay/stun.ts` is 567 lines of pure TypeScript (`buildAllocateForRelay`,
`buildBindingRequestWithSubs`, `parseStunResponse`, `buildWhatsAppPing`, ...) over
a raw `node:dgram` socket. `connectToRelay` branches at `:211`:

    if (relayInfo.isFna) { this.setupUdpRelay(conn, relayInfo); return conn }

and in that branch wrtc is never constructed.
`setupUdpRelay` (`:438`) does `dgram.createSocket`, then `socket.connect(port, ip)`,
then `sendStunAllocateOnOpen` and `startKeepalive`. And `sendToChannel` (`:659`)
**prefers the UDP socket**: `if (conn.udpSocket) { ... return true }`; the
`channel.send` path at `:684` is only reached when `udpSocket` is null.

Consequence for the plan: **brief stage 2 (STUN connectivity checks) is already
zapo's own TypeScript, not C I have to vendor** — it needs `node:dgram`
connected-mode (`socket.connect()`, single-arg `socket.send()`) to work in
scriptc, nothing more. The C work concentrates on DTLS and SCTP behind the
non-FNA branch.

## Prior art already in the tree (found, not written by me)

- `tests/perf/voipfix/README.md` — block `voipfix` measured this exact wall.
  voip's entry reduces to **5 named refusals on both backends**, two of which are
  mine: `SC2013` at `WaSctpRelay.ts:5` (importing `@roamhq/wrtc`) and `SC2009` at
  `:94` (`Map<string, Connection>` from `Connection.peerConnection:
  RTCPeerConnection | null`). The other three are `Int16Array`, someone else's clause.
- `runs/neg-voip-entry.json` — with no DOM: exactly the two `SC0001`s at `:30`/`:31`
  the brief names.
- `runs/rtc-value.json` — under honoured DOM every RTC member refuses by name with
  code `n` (rendered `SC2020`), e.g. `'RTCPeerConnection.createDataChannel' is part
  of the standard library types but has no scriptc lowering yet`.
- **`lib`-as-floor was implemented and REVERTED** (commit `24e21a10`): it took
  voip preflight-fail 7 to 0 but reddened six test files (6 passed to 6 failed).
  `program.ts` at base is byte-identical to `70e1fe48`.

## The architectural fork this creates

`packages/compiler/src/frontend/program.ts:109` forces `lib: ["lib.es2025.d.ts"]`.
Stdlib type mappings are gated on **provenance**, not name:
`lowerer.ts`'s `isStdlibFile` is `program.isSourceFileDefaultLibrary(sf)`, and
`frontend/types.ts` requires that before `URL` maps to `{kind:"url"}`. voipfix's
conclusion, which I am treating as the key constraint:

> a wrtc runtime that merely satisfies the DOM interface leaves `:94` refusing.

So a `/// <reference>`-style or plain-ambient declaration **cannot** clear `:94` —
the declaring file has to be a default library. Honouring the project's whole DOM
lib does that but costs six red test files.

**Untested idea I am pursuing:** ship a narrow scriptc-owned lib file containing
only the RTC types and add it to the FORCED `lib` array, so it is a default
library by construction with none of DOM's blast radius. Whether tsgo's `lib:`
accepts a scriptc-supplied file, and whether `isSourceFileDefaultLibrary` is true
for it, is **unmeasured** — that is the next thing to run.

The `better-sqlite3` arrangement is the precedent for the surrounding work:
`packages/compiler/ambient/scriptc-sqlite.d.ts` (116 lines), `sqliteDtsPath()`,
conditional inclusion at `program.ts:274`, and `lower-sqlite.ts`. Its header
states the same doctrine stage 1 wants — declare members that have no lowering
anyway, so the refusal reads "no lowering" instead of "property does not exist".

## Status

Stage 0 (verification) done. Stages 1-4 not started. Nothing compiled yet by me;
every number above is either read from the source or quoted from voipfix's
recorded runs, and is labelled as such.
