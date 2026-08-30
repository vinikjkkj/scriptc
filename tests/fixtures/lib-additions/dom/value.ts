/* The worst outcome this mechanism could produce, pinned so it cannot happen
 * silently: lib.dom.d.ts declares `RTCPeerConnection` as a global CONSTRUCTOR
 * as well as a type, and scriptc implements no such thing. Making the name
 * visible must not make the capability exist -- every use has to refuse by
 * name at the use site. */
const pc = new RTCPeerConnection()
console.log(pc.signalingState)
