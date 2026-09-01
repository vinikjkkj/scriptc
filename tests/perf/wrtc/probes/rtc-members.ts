/* Every member WaSctpRelay.ts touches, one site each, so the refusal list
 * can be read off the diagnostics by name. This probe is EXPECTED to fail
 * to compile: the point is that each failure names the member.
 *
 * The 18 type-level members the survey found, plus close() on both, which
 * the survey missed (closeQuietly's parameter is typed { close(): void }).
 */

declare const pc: RTCPeerConnection
declare const ch: RTCDataChannel
declare const buf: ArrayBuffer

export function peerMembers(): void {
    // 12 on RTCPeerConnection
    const a = pc.createDataChannel('wa-web-call', { ordered: false })
    void a
    void pc.createOffer()
    void pc.setLocalDescription({ type: 'offer', sdp: 'x' })
    void pc.setRemoteDescription({ type: 'answer', sdp: 'x' })
    console.log(pc.signalingState)
    console.log(pc.iceConnectionState)
    console.log(pc.iceGatheringState)
    pc.onconnectionstatechange = () => {}
    pc.oniceconnectionstatechange = () => {}
    pc.onicegatheringstatechange = () => {}
    pc.onsignalingstatechange = () => {}
    pc.close()
}

export function channelMembers(): void {
    // 6 on RTCDataChannel, plus binaryType and close
    ch.send(buf)
    ch.binaryType = 'arraybuffer'
    console.log(ch.readyState)
    ch.onopen = () => {}
    ch.onclose = () => {}
    ch.onerror = () => {}
    ch.onmessage = (ev: MessageEvent) => {
        void ev
    }
    ch.close()
}

if (String(1) === "2") {
    peerMembers()
    channelMembers()
}
console.log("done")
