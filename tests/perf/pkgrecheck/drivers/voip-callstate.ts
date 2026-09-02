// FLAGLESS static-lane driver for voip/call/call-state.ts -- the whole call
// state machine, its seven getters, and the InvalidTransition throw.
//
// On 16705f5c this package's entry preflight-failed on RTCPeerConnection /
// RTCDataChannel; on facbe036 seven voip modules cross preflight and this one
// reports ZERO blocker sites in the default lane, so this driver asks for a
// voip binary with NO FLAGS AT ALL -- no --provenance-sources, no
// --best-effort, no --npm-static.
//
// Every throwing arm is CAUGHT and its .message printed: a driver that ends in
// an uncaught throw can never score MATCH (node source-quotes a stack, the
// binary prints one line). `InvalidTransition extends Error`, so this also
// exercises the runtime-base guard on the surfaces that ARE allowed there
// (.message, .name, String()) -- the four enumerating surfaces are refused at
// build time and are measured separately in drivers/voip-errsub.ts.
import { CallInfo, InvalidTransition } from '../pkgs/voip/call/call-state.js'
import { CallMediaType, CallState, EndCallReason } from '../pkgs/voip/types.js'

let n = 0
function show(label: string, v: string): void {
    n += 1
    console.log(n + ' ' + label + ' = ' + v)
}
function b(v: boolean): string {
    return v ? 'true' : 'false'
}

const out = CallInfo.newOutgoing('call-1', '55119@s.whatsapp.net', 'me@s.whatsapp.net', CallMediaType.Audio)
show('outgoing state', out.stateData.state)
show('outgoing isInitiator', b(out.isInitiator))
show('outgoing videoOff', b(out.stateData.videoOff))
show('outgoing canAccept', b(out.canAccept))

out.applyTransition({ type: 'offer_sent' })
show('after offer_sent', out.stateData.state)
show('isRinging', b(out.isRinging))
out.applyTransition({ type: 'remote_accepted' })
show('after remote_accepted', out.stateData.state)
out.applyTransition({ type: 'media_connected' })
show('after media_connected', out.stateData.state)
show('isActive', b(out.isActive))
out.applyTransition({ type: 'hold' })
show('after hold', out.stateData.state)
out.applyTransition({ type: 'resume' })
show('after resume', out.stateData.state)
out.applyTransition({ type: 'audio_mute_changed', muted: true })
show('audioMuted', b(out.stateData.audioMuted))
out.applyTransition({ type: 'video_state_changed', off: false })
show('videoOff', b(out.stateData.videoOff))
out.applyTransition({ type: 'terminated', reason: EndCallReason.UserEnded })
show('after terminated', out.stateData.state)
show('isEnded', b(out.isEnded))

const inc = CallInfo.newIncoming('call-2', 'peer@s.whatsapp.net', 'peer@s.whatsapp.net', '5511999', CallMediaType.Video)
show('incoming state', inc.stateData.state)
show('incoming isInitiator', b(inc.isInitiator))
show('incoming videoOff', b(inc.stateData.videoOff))
show('incoming canAccept', b(inc.canAccept))
show('incoming canReject', b(inc.canReject))
show('incoming isAcceptBlocked', b(inc.isAcceptBlocked))
// newIncoming already lands in IncomingRinging, so 'offer_received' (which
// requires Initiating) is REFUSED here -- a second, differently-shaped throw.
let msg0 = 'NO THROW'
try {
    inc.applyTransition({ type: 'offer_received', silenced: true })
} catch (e) {
    msg0 = (e as InvalidTransition).message
}
show('offer_received refused', msg0)
show('offer_received keeps state', inc.stateData.state)
inc.applyTransition({ type: 'local_accepted' })
show('after local_accepted', inc.stateData.state)
let msg1 = 'NO THROW'
try {
    inc.applyTransition({ type: 'local_rejected', reason: EndCallReason.Declined })
} catch (e) {
    msg1 = (e as InvalidTransition).message
}
show('local_rejected from connecting', msg1)
inc.applyTransition({ type: 'terminated', reason: EndCallReason.Declined })
show('after terminated', inc.stateData.state)

// The Error subclass, caught. `message` and `name` are the two members the
// runtime-base guard leaves reachable, and String(e) goes through Error's own
// toString -- all three are asked here.
const bad = CallInfo.newOutgoing('call-3', 'x@s.whatsapp.net', 'me@s.whatsapp.net', CallMediaType.Audio)
let msg = 'NO THROW'
let nm = 'NO THROW'
let str = 'NO THROW'
let isIT = false
let isErr = false
try {
    bad.applyTransition({ type: 'remote_accepted' })
} catch (e) {
    const t = e as InvalidTransition
    msg = t.message
    nm = t.name
    str = String(t)
    isIT = t instanceof InvalidTransition
    isErr = t instanceof Error
}
show('throw message', msg)
show('throw name', nm)
show('throw String()', str)
show('throw instanceof InvalidTransition', b(isIT))
show('throw instanceof Error', b(isErr))
show('state after refused transition', bad.stateData.state)
show('CallState.Ended literal', CallState.Ended)

console.log('VOIP-CALLSTATE: END')
