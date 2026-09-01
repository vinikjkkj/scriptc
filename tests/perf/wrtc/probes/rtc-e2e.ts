/* END TO END, FROM TYPESCRIPT: a compiled scriptc binary whose data
 * channel reaches 'open' over a real UDP socket, sends, and receives.
 *
 * This is the one probe in the clause that is NOT scored against node.
 * It cannot be: the peer on the other end is a hand-written relay that
 * speaks DTLS and SCTP but NOT STUN, and node's @roamhq/wrtc is real
 * libwebrtc, which will not promote a candidate pair without a STUN
 * binding exchange. Running this under node would hang, and a hang is not
 * a comparison. So it is a CAPABILITY probe with a fixed expected
 * transcript, and every line it prints is produced by the event loop
 * driving the transport -- not by a test harness owning a `while`.
 *
 * The shape is zapo's, line for line: createOffer, the
 * /a=ice-ufrag:([^\r\n]+)/ regex, modifySdpForRelay, and
 * setRemoteDescription({type:'answer', sdp}). The only departure is the
 * fingerprint constant: zapo hardcodes WhatsApp's relay certificate hash,
 * and this writes the hash the local peer actually printed, because a
 * fingerprint that names a different certificate must (and does) fail.
 */
import wrtc from '@roamhq/wrtc'

const port = Number(process.argv[2])
const fingerprint = String(process.argv[3])

function addRelayCandidate(sdp: string, ip: string, p: number): string {
  const candidate = `a=candidate:2 1 udp 2122262783 ${ip} ${p} typ host generation 0 network-cost 5`
  let modified = sdp.replace(/a=candidate:[^\r\n]+\r?\n/g, '')
  modified = modified.replace(/a=end-of-candidates\r?\n?/g, '')
  modified += candidate + '\r\n' + 'a=end-of-candidates' + '\r\n'
  return modified
}

function modifySdpForRelay(sdp: string, ip: string, p: number): string {
  let modified = sdp
  modified = modified.replace(/a=setup:actpass/g, 'a=setup:passive')
  modified = modified.replace(/a=ice-ufrag:[^\r\n]+/g, 'a=ice-ufrag:RELAYUFRAG')
  modified = modified.replace(/a=ice-pwd:[^\r\n]+/g, 'a=ice-pwd:RELAYPASSWORDRELAYPASSWORD')
  modified = modified.replace(/a=fingerprint:[^\r\n]+/g, `a=fingerprint:sha-256 ${fingerprint}`)
  modified = modified.replace(/a=max-message-size:[^\r\n]+/g, 'a=max-message-size:1500')
  modified = modified.replace(/a=ice-options:[^\r\n]+\r?\n/g, '')
  modified = addRelayCandidate(modified, ip, p)
  return modified
}

function decode(b: Uint8Array): string {
  let s = ''
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]!)
  return s
}

async function main(): Promise<void> {
  const pc = new wrtc.RTCPeerConnection({ iceServers: [] })
  const ch = pc.createDataChannel('wa-web-call', { ordered: false })
  ch.binaryType = 'arraybuffer'

  let opened = false
  let got = 0

  pc.oniceconnectionstatechange = () => {
    console.log('ice=' + pc.iceConnectionState)
  }
  pc.onconnectionstatechange = () => {
    console.log('conn=' + pc.connectionState)
  }
  pc.onsignalingstatechange = () => {
    console.log('signaling=' + pc.signalingState)
  }

  ch.onopen = () => {
    opened = true
    console.log('channel open, readyState=' + ch.readyState)
    ch.send('scriptc-ping')
    console.log('sent')
  }

  ch.onmessage = (payload: Uint8Array) => {
    got++
    console.log('message len=' + String(payload.length) + ' body=' + decode(payload))
    pc.close()
    console.log('closed, ice=' + pc.iceConnectionState + ' signaling=' + pc.signalingState)
  }

  const offer = await pc.createOffer()
  await pc.setLocalDescription(offer)
  const ufragMatch = offer.sdp!.match(/a=ice-ufrag:([^\r\n]+)/)
  console.log('local ufrag len=' + String(ufragMatch === null ? -1 : ufragMatch[1]!.length))
  const answer = modifySdpForRelay(offer.sdp!, '127.0.0.1', port)
  await pc.setRemoteDescription({ type: 'answer', sdp: answer })
  console.log('answer applied, gathering=' + pc.iceGatheringState)

  setTimeout(() => {
    if (!opened || got === 0) {
      console.log('TIMEOUT opened=' + String(opened) + ' got=' + String(got))
      pc.close()
    }
  }, 15000)
}

void main()
