/* Event-handler assignment and the send fence, in zapo's spelling.
 * Everything here is scoreable byte-exact against the oracle WITHOUT a
 * peer: assignment/readback, the null default, and what send() does on a
 * channel that is still 'connecting'.
 */
import wrtc from '@roamhq/wrtc'

const pc = new wrtc.RTCPeerConnection({ iceServers: [] })
const ch = pc.createDataChannel('wa-web-call', { ordered: false })

console.log('ch.onopen default=' + String(ch.onopen))
console.log('ch.onmessage default=' + String(ch.onmessage))
console.log('pc.onsignalingstatechange default=' + String(pc.onsignalingstatechange))

ch.onopen = () => { console.log('open fired') }
ch.onclose = () => { console.log('close fired') }
ch.onerror = () => { console.log('error fired') }
ch.onmessage = (_ev: MessageEvent) => { console.log('message fired') }
pc.oniceconnectionstatechange = () => { console.log('ice fired') }
pc.onicegatheringstatechange = () => { console.log('gathering fired') }
pc.onsignalingstatechange = () => { console.log('signaling fired') }
pc.onconnectionstatechange = () => { console.log('connection fired') }

console.log('typeof ch.onopen=' + typeof ch.onopen)
console.log('typeof ch.onmessage=' + typeof ch.onmessage)
console.log('typeof pc.oniceconnectionstatechange=' + typeof pc.oniceconnectionstatechange)

try {
  ch.send('hello')
  console.log('send on connecting: no throw')
} catch (e) {
  const err = e as Error
  console.log('send on connecting throws name=' + err.name)
  console.log('send on connecting throws message=' + err.message)
}

ch.close()
console.log('after ch.close, readyState=' + ch.readyState)
try {
  ch.send('hello')
  console.log('send after close: no throw')
} catch (e) {
  const err = e as Error
  console.log('send after close throws name=' + err.name)
  console.log('send after close throws message=' + err.message)
}
pc.close()
console.log('done')
