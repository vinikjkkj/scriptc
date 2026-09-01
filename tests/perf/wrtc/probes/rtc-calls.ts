/* Do the RTC READS and CALLS refuse, or do they silently compile?
 *
 * rtc-members.ts reported nine SC1090s, all of them event-handler
 * ASSIGNMENTS, and nothing at all for createDataChannel / createOffer /
 * setLocalDescription / setRemoteDescription / signalingState /
 * iceConnectionState / iceGatheringState / send / readyState / close. A
 * missing diagnostic is not the same as a refusal, so this isolates them:
 * no assignments here, and every result is PRINTED so a wrong answer
 * cannot hide behind a clean compile.
 */

declare const pc: RTCPeerConnection
declare const ch: RTCDataChannel
declare const buf: ArrayBuffer

export function reads(): void {
    console.log('signalingState=' + pc.signalingState)
    console.log('iceConnectionState=' + pc.iceConnectionState)
    console.log('iceGatheringState=' + pc.iceGatheringState)
    console.log('readyState=' + ch.readyState)
}

export function calls(): void {
    const c = pc.createDataChannel('wa-web-call', { ordered: false })
    console.log('channel readyState=' + c.readyState)
    ch.send(buf)
    ch.close()
    pc.close()
}

if (String(1) === '2') {
    reads()
    calls()
}
console.log('done')
