/* The zapo shape, REACHABLE. rtc-calls.ts compiled clean with every read
 * and call behind a false guard, which does not distinguish "the member
 * lowered" from "the function was skipped as unreachable". This one runs.
 *
 * It also exercises the construction site WaSctpRelay.ts:224 uses --
 * `new wrtc.RTCPeerConnection({ iceServers: [] })` through the module's
 * default export -- which is the thing that must refuse if nothing
 * constructs a handle yet.
 */

import wrtc from '@roamhq/wrtc'

console.log('before')
const pc = new wrtc.RTCPeerConnection({ iceServers: [] })
console.log('constructed')
const ch = pc.createDataChannel('wa-web-call', { ordered: false })
console.log('channel')
console.log('signalingState=' + pc.signalingState)
console.log('readyState=' + ch.readyState)
ch.close()
pc.close()
console.log('after')
