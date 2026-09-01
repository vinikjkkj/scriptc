/* The members that are still NOT lowered must refuse BY NAME. A member that
 * quietly answered something plausible would be a wrong answer replacing an
 * honest refusal, which is the failure this whole clause exists to avoid.
 *
 * This list SHRANK when the halves were joined: createOffer,
 * setLocalDescription, setRemoteDescription, send, the four
 * on*statechange handlers and onopen/onclose/onerror/onmessage all lower
 * now and answer byte-identically to the oracle. What is left is here,
 * and each line's reason is the real obstacle rather than "not yet".
 */
import wrtc from '@roamhq/wrtc'

const pc = new wrtc.RTCPeerConnection({ iceServers: [] })
const ch = pc.createDataChannel('wa-web-call', { ordered: false })

/* Reading an event handler back. The slot holds a closure and there is no
 * function value to answer with; the ORACLE's answers are recorded in
 * runs/join-oracle-events-firstcut.out (`ch.onopen` is `undefined`,
 * `pc.onsignalingstatechange` is `null` -- two halves of one surface
 * disagreeing, where the spec says null for both). */
console.log(String(ch.onopen))
console.log(typeof pc.onsignalingstatechange)

/* Inbound data channels. THE ONE THAT WOULD FAIL SILENTLY: zapo reaches
 * it through `(pc as any)`, so nothing type-checks it, and a handler that
 * simply never fired would leave conn.incomingChannels empty with no
 * diagnostic. The SCTP unit is offerer-only and does not accept an
 * inbound DCEP DATA_CHANNEL_OPEN, so this refuses loudly. */
;(pc as unknown as { ondatachannel: (e: unknown) => void }).ondatachannel = () => {}

/* Trickle ICE, ICE restart, answering, and reading a description back. */
void pc.addIceCandidate({ candidate: 'x' })
pc.restartIce()
void pc.createAnswer()
console.log(String(pc.localDescription))
console.log(String(pc.remoteDescription))

/* A MessageEvent handler. `MessageEvent.data` is `any` in zapo's real
 * @types/node; the payload arm (Uint8Array) is what scriptc serves. */
ch.onmessage = (_ev: MessageEvent) => {}

/* An ArrayBuffer payload: only string and Uint8Array/Buffer are served. */
ch.send(new ArrayBuffer(4))

/* Unscoreable: @roamhq/wrtc answers uninitialised memory here, a
 * different denormal each run, where the spec says null. */
console.log(String(ch.id))
console.log('unreachable')
