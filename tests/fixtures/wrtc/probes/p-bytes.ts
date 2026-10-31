// dcSendBytes reach: send(Uint8Array) on a connecting channel throws like the string form.
import wrtc from '@roamhq/wrtc'

const pc = new wrtc.RTCPeerConnection({ iceServers: [] })
const ch = pc.createDataChannel('wa-web-call', { ordered: false })
const payload = new Uint8Array([1, 2, 3])
try {
  ch.send(payload)
  console.log('bytes send: no throw')
} catch (e) {
  const err = e as Error
  console.log('bytes send throws name=' + err.name)
  console.log('bytes send throws message=' + err.message)
}
pc.close()
console.log('done')
