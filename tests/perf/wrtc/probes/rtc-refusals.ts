/* The members that are still NOT lowered must refuse BY NAME. A member that
 * quietly answered something plausible would be a wrong answer replacing an
 * honest refusal, which is the failure this whole clause exists to avoid.
 */
import wrtc from '@roamhq/wrtc'

const pc = new wrtc.RTCPeerConnection({ iceServers: [] })
const ch = pc.createDataChannel('wa-web-call', { ordered: false })

void pc.createOffer()
void pc.setLocalDescription({ type: 'offer', sdp: 'x' })
void pc.setRemoteDescription({ type: 'answer', sdp: 'x' })
pc.onconnectionstatechange = () => {}
pc.oniceconnectionstatechange = () => {}
ch.send(new ArrayBuffer(4))
ch.onopen = () => {}
ch.onmessage = () => {}
console.log(String(ch.id))
console.log('unreachable')
