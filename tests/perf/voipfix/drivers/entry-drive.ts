// voip's PACKAGE ENTRY, driven through its real exported API.
//
// This file lives INSIDE pkgs/voip so it resolves the same tsconfig the
// package's own sources do -- the one that asks for `"lib": ["ES2020","DOM"]`.
// That is the whole point: the entry is compiled under the package's declared
// global surface, not under a probe config invented for the occasion.
//
// It imports from './index.js', so the ENTIRE package graph compiles --
// plugin -> WaVoipCoordinator -> WaCallManager -> relay/WaSctpRelay (@roamhq/wrtc)
// and media/mlow-codec (MlowModule). Neither is on any executed path here.
//
// Every assertion prints a REAL VALUE. `typeof` appears nowhere: a state
// machine's answers are strings and booleans that a wrong implementation
// gets wrong, and `typeof x === 'object'` would be true for every one of them.
import { CallInfo, CallDirection, CallMediaType, CallState, EndCallReason } from './index.js'

let fails = 0
function eq(actual: string, expected: string, label: string): void {
    if (actual !== expected) {
        fails += 1
        console.log('FAIL ' + label + ': got ' + actual + ' want ' + expected)
    } else {
        console.log('ok   ' + label + ' = ' + actual)
    }
}

// The enum values, read through the package entry.
eq(CallState.IncomingRinging, 'incoming_ringing', 'CallState.IncomingRinging')
eq(CallDirection.Outgoing, 'outgoing', 'CallDirection.Outgoing')
eq(CallMediaType.Video, 'video', 'CallMediaType.Video')
eq(EndCallReason.DoNotDisturb, 'do_not_disturb', 'EndCallReason.DoNotDisturb')

// An outgoing audio call, driven right through the state machine.
const out = CallInfo.newOutgoing('CALL-A', '5511@s.whatsapp.net', 'me@s.whatsapp.net', CallMediaType.Audio)
eq(out.direction, 'outgoing', 'outgoing.direction')
eq(String(out.isInitiator), 'true', 'outgoing.isInitiator')
eq(out.stateData.state, 'initiating', 'outgoing.state')
eq(String(out.stateData.videoOff), 'true', 'outgoing audio => videoOff')
eq(String(out.canAccept), 'false', 'outgoing.canAccept')

out.applyTransition({ type: 'offer_sent' })
eq(out.stateData.state, 'ringing', 'after offer_sent')
eq(String(out.isRinging), 'true', 'outgoing.isRinging')
eq(String(out.canReject), 'true', 'outgoing.canReject')

out.applyTransition({ type: 'remote_accepted' })
eq(out.stateData.state, 'connecting', 'after remote_accepted')

out.applyTransition({ type: 'media_connected' })
eq(out.stateData.state, 'active', 'after media_connected')
eq(String(out.isActive), 'true', 'outgoing.isActive')

out.applyTransition({ type: 'audio_mute_changed', muted: true })
eq(String(out.stateData.audioMuted), 'true', 'after audio_mute_changed')

out.applyTransition({ type: 'hold' })
eq(out.stateData.state, 'on_hold', 'after hold')
out.applyTransition({ type: 'resume' })
eq(out.stateData.state, 'active', 'after resume')

out.applyTransition({ type: 'terminated', reason: EndCallReason.UserEnded })
eq(out.stateData.state, 'ended', 'after terminated')
eq(String(out.isEnded), 'true', 'outgoing.isEnded')
eq(String(out.stateData.endReason), 'user_ended', 'end reason')

// An incoming video call, and the guard that must throw.
const inc = CallInfo.newIncoming('CALL-B', '5522@s.whatsapp.net', '5522@s.whatsapp.net', '+5522', CallMediaType.Video)
eq(inc.direction, 'incoming', 'incoming.direction')
eq(String(inc.isInitiator), 'false', 'incoming.isInitiator')
eq(inc.stateData.state, 'incoming_ringing', 'incoming.state')
eq(String(inc.stateData.videoOff), 'false', 'incoming video => videoOff')
eq(String(inc.canAccept), 'true', 'incoming.canAccept')
eq(String(inc.callerPn), '+5522', 'incoming.callerPn')

// An illegal transition must throw, and the message must name both states.
let threw = 'none'
try {
    inc.applyTransition({ type: 'remote_accepted' })
} catch (e) {
    threw = (e as Error).message
}
eq(threw, "invalid transition 'remote_accepted' in state 'incoming_ringing'", 'illegal transition throws')

inc.applyTransition({ type: 'local_accepted' })
eq(inc.stateData.state, 'connecting', 'incoming after local_accepted')

console.log(fails === 0 ? 'VOIP-ENTRY: ALL PASS' : 'VOIP-ENTRY: ' + fails + ' FAILED')
