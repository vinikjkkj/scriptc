/* dcBufferedAmount reach. Only the TYPE is printed: the value is not scored
 * here, because the oracle's bufferedAmount has been reported as noise on
 * another run (p-sync's header; the perf README), so a value line could
 * flip with no change in scriptc. The typeof line still forces the read
 * through the libCall on both backends. */
import wrtc from '@roamhq/wrtc'

const pc = new wrtc.RTCPeerConnection({ iceServers: [] })
const ch = pc.createDataChannel('wa-web-call', { ordered: false })
const buffered = ch.bufferedAmount
console.log('ch.bufferedAmount is number=' + String(typeof buffered === 'number'))
ch.close()
pc.close()
console.log('done')
