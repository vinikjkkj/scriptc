/* One source, two projects: scriptc compiles it where @roamhq/wrtc is NOT
 * installed (so the shipped ambient declarations apply), and node runs it
 * where the package IS installed. That is what makes this a differential
 * rather than two unrelated programs.
 *
 * ch.id AND ch.bufferedAmount are deliberately absent: the oracle answers
 * uninitialised memory for BOTH -- a different denormal every run -- so
 * neither can be scored. bufferedAmount is still implemented (0 is the
 * unambiguous answer for a channel that has sent nothing); it is the
 * comparison that is impossible, not the behaviour.
 */
import wrtc from '@roamhq/wrtc'

const pc = new wrtc.RTCPeerConnection({ iceServers: [] })
console.log('pc.signalingState=' + pc.signalingState)
console.log('pc.iceConnectionState=' + pc.iceConnectionState)
console.log('pc.iceGatheringState=' + pc.iceGatheringState)
console.log('pc.connectionState=' + pc.connectionState)

const ch = pc.createDataChannel('wa-web-call', { ordered: false })
console.log('ch.label=' + ch.label)
console.log('ch.ordered=' + String(ch.ordered))
console.log('ch.readyState=' + ch.readyState)
console.log('ch.binaryType=' + ch.binaryType)
console.log('ch.protocol=[' + ch.protocol + ']')

ch.binaryType = 'arraybuffer'
console.log('after set, ch.binaryType=' + ch.binaryType)

ch.close()
console.log('after close, ch.readyState=' + ch.readyState)
pc.close()
console.log('after pc.close, pc.signalingState=' + pc.signalingState)
console.log('done')
