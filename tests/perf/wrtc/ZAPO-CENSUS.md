# What this clause moved in zapo's actual file — counted, and short of what
# "twelve members" suggests

Source: the provenance checkout `250f9af5229a545eec28ddbd3e8774a397cdb0bb`,
`packages/voip/src/relay/WaSctpRelay.ts`.

**THIS IS A CENSUS, NOT A COMPILE.** The package's workspace dependencies
(`zapo-js`, `zapo-js/util`, `../bytes.js`, `./stun.js`) are not installed in the
provenance checkout, so this file cannot be compiled here and no number below
came from a build. It is counted by receiver-qualified occurrence against the
source. A census is weaker evidence than a compile and is labelled as such.
`G:/zapo-work/node_modules` holds three entries; voip's path belongs to another
block.

## Served in zapo's exact spelling — 10 member names, 12 occurrences

    createOffer                 1     setLocalDescription         1
    setRemoteDescription        1     onopen                      2
    onclose                     2     onerror                     1
    oniceconnectionstatechange  1     onicegatheringstatechange   1
    onsignalingstatechange      1     onconnectionstatechange     1

Each of these refused by name before this block and answers now.

## SERVED AS A MEMBER BUT NOT IN ZAPO'S SPELLING — 2, and this is the
## correction to my own claim

Reporting "twelve members now answer" would have been true of the surface and
misleading about zapo. Two of the twelve do not reach zapo as written:

1. **`send`** — `:684` is `conn.channel.send(arrayBufferToSend)` where
   `:675` declares `let arrayBufferToSend: ArrayBuffer`. This clause serves a
   `string` and a `Uint8Array`/`Buffer` payload and REFUSES an `ArrayBuffer` by
   name. The obstacle is not in the WebRTC lowering: scriptc has no
   free-standing `ArrayBuffer` value at all ("typed arrays own their storage"),
   so `let x: ArrayBuffer` and `copied.buffer` are walls of their own, ahead of
   `send`. **Naming the next obstacle on zapo's send path is the useful output
   here, and it is not a WebRTC obstacle.**

2. **`onmessage`** — both sites (`:312`, `:367`) are
   `(ev: MessageEvent) => { ... ev.data ... }`. `MessageEvent.data` is `any` in
   zapo's real `@types/node` (undici's `MessageEvent<T = any>`), so the DOM
   event form refuses by name and the `Uint8Array` payload arm this clause
   added is what lowers. zapo does not spell it that way.

## Still refused — 4

    ondatachannel   :301   via (pc as any); the association is offerer-only and
                           does not accept an inbound DCEP DATA_CHANNEL_OPEN
    getStats        :252   via (pc as any); optional-call, degrades safely
    connectionState :274, :583   SERVED as a member, but zapo reaches it
                           through (pc as any), so the receiver is `dyn` and
                           the WebRTC lowering is never consulted
    incomingChannel.id  :306   unscoreable: @roamhq/wrtc answers uninitialised
                           memory where the spec says null

`connectionState` is the same shape of finding as `send` and `onmessage`: the
member is served, the SITE is not. **A member-reach survey that counts member
names and not call sites overstates every one of these three.**

## The four `(pc as any)` sites are the whole reason a survey misses them

    252  const stats = (pc as any).getStats?.()
    274  const connState = (pc as any).connectionState
    301  ;(pc as any).ondatachannel = (event: any) => {
    583  const connState = (pc as any)?.connectionState || 'unknown'

None of the four has a type error and none reaches the WebRTC lowering. The
assignment at `:301` refuses with the generic
`SC1090 assignment to non-variables are not supported yet` rather than a named
reason — the weaker of this clause's two weak refusals. It still REFUSES, which
is what matters for the one member that would otherwise fail silently and leave
`conn.incomingChannels` empty with no diagnostic.
