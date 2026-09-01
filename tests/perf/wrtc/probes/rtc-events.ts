/* Event-handler assignment, the send fence, and the close cascade.
 * Everything here is scoreable byte-exact against the oracle WITHOUT a
 * peer on the wire: what send() does on a channel that is still
 * 'connecting', and which state-change handlers pc.close() fires and in
 * what order.
 *
 * READING a handler back is NOT here. `ch.onopen` and
 * `typeof ch.onmessage` are refused by name under scriptc (the slot holds
 * a closure and there is no function value to answer with), so those six
 * lines live in rtc-refusals.ts rather than scoring as DID-NOT-RUN. The
 * oracle's answers for them are worth recording anyway and are in
 * runs/join-oracle-events-firstcut.out: ch.onopen defaults to
 * `undefined` while pc.onsignalingstatechange defaults to `null` -- two
 * halves of one surface disagreeing, where the spec says null for both.
 *
 * onmessage takes the PAYLOAD, not a MessageEvent: scriptc serves the
 * Uint8Array arm of the declared type and refuses the DOM event object by
 * name, because its `data` is `any` in zapo's real @types/node.
 */
import wrtc from '@roamhq/wrtc'

const pc = new wrtc.RTCPeerConnection({ iceServers: [] })
const ch = pc.createDataChannel('wa-web-call', { ordered: false })

ch.onopen = () => { console.log('open fired') }
ch.onclose = () => { console.log('close fired') }
ch.onerror = () => { console.log('error fired') }
ch.onmessage = (payload: Uint8Array) => { console.log('message fired ' + String(payload.length)) }
pc.oniceconnectionstatechange = () => { console.log('ice fired') }
pc.onicegatheringstatechange = () => { console.log('gathering fired') }
pc.onsignalingstatechange = () => { console.log('signaling fired') }
pc.onconnectionstatechange = () => { console.log('connection fired') }

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
