// The oracle for the data-channel half, exercising exactly the members
// zapo's WaSctpRelay.ts touches, in a form with no peer and no timing --
// so every line is deterministic and can be matched byte for byte.
import wrtc from '@roamhq/wrtc'

const pc = new wrtc.RTCPeerConnection({ iceServers: [] })
console.log('pc.signalingState=' + pc.signalingState)
console.log('pc.iceConnectionState=' + pc.iceConnectionState)
console.log('pc.iceGatheringState=' + pc.iceGatheringState)
console.log('pc.connectionState=' + pc.connectionState)

const ch = pc.createDataChannel('wa-web-call', { ordered: false })
console.log('ch.label=' + ch.label)
console.log('ch.ordered=' + ch.ordered)
console.log('ch.readyState=' + ch.readyState)
console.log('ch.binaryType=' + ch.binaryType)
console.log('ch.id=' + ch.id)
console.log('ch.protocol=' + JSON.stringify(ch.protocol))
console.log('ch.bufferedAmount=' + ch.bufferedAmount)

ch.binaryType = 'arraybuffer'
console.log('after set, ch.binaryType=' + ch.binaryType)

ch.close()
console.log('after close, ch.readyState=' + ch.readyState)
pc.close()
console.log('after pc.close, pc.signalingState=' + pc.signalingState)
console.log('done')
