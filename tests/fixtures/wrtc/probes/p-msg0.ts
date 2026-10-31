// dcOnMessage with ZERO parameters (the ignoring thunk), and the registrations that must not fire on close.
import wrtc from '@roamhq/wrtc'

const pc = new wrtc.RTCPeerConnection({ iceServers: [] })
const ch = pc.createDataChannel('m0')
ch.onmessage = () => { console.log('message0 fired') }
ch.onopen = () => { console.log('open0 fired') }
ch.onclose = () => { console.log('close0 fired') }
ch.onerror = () => { console.log('error0 fired') }
pc.onconnectionstatechange = () => { console.log('conn0 fired') }
ch.close()
pc.close()
console.log('done')
