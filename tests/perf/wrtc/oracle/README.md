# The node oracle for `@roamhq/wrtc`

## It does not exist in zapo, and that nearly stopped the scoring

`@roamhq/wrtc` is declared in `packages/voip/package.json` as both a
peerDependency (`>=0.10.0`) and a devDependency (`^0.10.0`) — **and it is not
installed anywhere in zapo's tree.** The provenance checkout has no
`node_modules` at all, and `G:/zapo-work/node_modules` holds three entries
(`@types`, `undici-types`, `ws`).

Verified, with a positive control so an empty result could not be mistaken
for absence:

    import('@roamhq/wrtc')  ->  ERR_MODULE_NOT_FOUND
    import('node:dgram')    ->  resolves            (control)

So **no program that imports `@roamhq/wrtc` can be scored against node from
zapo's tree** — the oracle would be DID-NOT-RUN, and MATCH/WRONG would be
unavailable for every member of this clause.

## The fix: install it HERE, never in zapo

zapo is read-only test input. The oracle therefore lives in
`G:/blocks/wrtc-lab/oracle/`, a lab project of its own, and zapo is untouched.
`npm install @roamhq/wrtc@^0.10.0` succeeds and — the part that was not
guaranteed — **the native module loads under node v25.9.0**, not only under
the v22 build lane:

    v25.9.0  LOADED, RTCPeerConnection constructed, signalingState=stable
    v22.18.0 LOADED

## `ch.id` cannot be scored, and the reason matters

Five runs of `dc-shape.mjs` under v25.9.0: **every line byte-identical except
`ch.id`**, which is a different denormal double each time —

    2.954806558186e-312   4.77842737715e-313   2.393337670646e-312
    1.19721795749e-312    2.039592265315e-312

That is uninitialized memory reinterpreted as a double. The WebRTC spec says
`RTCDataChannel.id` is **`null`** until the channel is negotiated, and
`@roamhq/wrtc` 0.10 returns garbage instead.

**So `ch.id` is excluded from byte-exact comparison, and this implementation
will deliberately answer `null` rather than reproduce the oracle.** Matching
it would mean matching uninitialised memory, which is not a behaviour. Every
other member is scored byte-exact.

## The captured shape (`runs/oracle-dc-shape.out`)

    pc.signalingState=stable        pc.iceConnectionState=new
    pc.iceGatheringState=new        pc.connectionState=new
    ch.label=wa-web-call            ch.ordered=false
    ch.readyState=connecting        ch.binaryType=arraybuffer
    ch.protocol=""                  ch.bufferedAmount=0
    after close, ch.readyState=closing
    after pc.close, pc.signalingState=closed

Two of those would have been guessed wrong: `binaryType` defaults to
**`arraybuffer`**, not the spec's `blob`; and `readyState` after `close()` is
**`closing`**, not `closed`.
