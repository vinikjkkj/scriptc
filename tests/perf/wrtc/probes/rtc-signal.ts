/* The offer/answer exchange in zapo's exact shape, reported as CANONICAL
 * FACTS rather than raw SDP: every SDP carries a random ufrag, pwd,
 * fingerprint, session id and candidate, so a byte comparison of the blob
 * would score randomness. What zapo consumes is the a=ice-ufrag regex, the
 * a=setup rewrite, the fingerprint line and the sctp-port -- so those are
 * what this prints, canonicalised.
 */
import wrtc from '@roamhq/wrtc'

const FIXED_FINGERPRINT =
  'sha-256 F9:CA:0C:98:A3:CC:71:D6:42:CE:5A:E2:53:D2:15:20:D3:1B:BA:D8:57:A4:F0:AF:BE:0B:FB:F3:6B:0C:A0:68'

function addRelayCandidate(sdp: string, ip: string, port: number): string {
  const candidate = `a=candidate:2 1 udp 2122262783 ${ip} ${port} typ host generation 0 network-cost 5`
  let modified = sdp.replace(/a=candidate:[^\r\n]+\r?\n/g, '')
  modified = modified.replace(/a=end-of-candidates\r?\n?/g, '')
  modified += candidate + '\r\n' + 'a=end-of-candidates' + '\r\n'
  return modified
}

function modifySdpForRelay(sdp: string, ip: string, port: number): string {
  let modified = sdp
  modified = modified.replace(/a=setup:actpass/g, 'a=setup:passive')
  modified = modified.replace(/a=ice-ufrag:[^\r\n]+/g, 'a=ice-ufrag:RELAYUFRAG')
  modified = modified.replace(/a=ice-pwd:[^\r\n]+/g, 'a=ice-pwd:RELAYPASSWORDRELAYPASSWORD')
  modified = modified.replace(/a=fingerprint:[^\r\n]+/g, `a=fingerprint:${FIXED_FINGERPRINT}`)
  modified = modified.replace(/a=max-message-size:[^\r\n]+/g, 'a=max-message-size:1500')
  modified = modified.replace(/a=ice-options:[^\r\n]+\r?\n/g, '')
  modified = addRelayCandidate(modified, ip, port)
  return modified
}

async function main(): Promise<void> {
  const pc = new wrtc.RTCPeerConnection({ iceServers: [] })
  const ch = pc.createDataChannel('wa-web-call', { ordered: false })
  ch.binaryType = 'arraybuffer'
  console.log('before offer, signalingState=' + pc.signalingState)

  const offer = await pc.createOffer()
  console.log('offer.type=' + offer.type)
  const sdp = offer.sdp!
  console.log('offer.sdp is string=' + String(typeof sdp === 'string'))
  console.log('offer.sdp ends CRLF=' + String(sdp.endsWith('\r\n')))
  console.log('offer has v=0 first=' + String(sdp.startsWith('v=0\r\n')))

  const m = sdp.match(/a=ice-ufrag:([^\r\n]+)/)
  console.log('ufrag matched=' + String(m !== null))
  console.log('ufrag len=' + String(m ? m[1].length : -1))
  console.log('ufrag charset ok=' + String(m ? /^[A-Za-z0-9+/]+$/.test(m[1]) : false))

  const pwd = sdp.match(/a=ice-pwd:([^\r\n]+)/)
  console.log('pwd len=' + String(pwd ? pwd[1].length : -1))

  const fp = sdp.match(/a=fingerprint:sha-256 ([0-9A-F:]+)/)
  console.log('fingerprint sha-256 pairs=' + String(fp ? fp[1].split(':').length : -1))

  console.log('has setup:actpass=' + String(/a=setup:actpass/.test(sdp)))
  console.log('has webrtc-datachannel m-line=' + String(/^m=application \d+ (UDP\/)?DTLS\/SCTP webrtc-datachannel\r$/m.test(sdp)))
  console.log('has sctp-port:5000=' + String(/a=sctp-port:5000/.test(sdp)))
  console.log('has max-message-size=' + String(/a=max-message-size:\d+/.test(sdp)))
  console.log('has a=mid=' + String(/a=mid:[^\r\n]+/.test(sdp)))
  console.log('has ice-options=' + String(/a=ice-options:[^\r\n]+/.test(sdp)))

  await pc.setLocalDescription(offer)
  console.log('after setLocal, signalingState=' + pc.signalingState)
  console.log('after setLocal, localDescription.type=' + String(pc.localDescription?.type))

  const answer = modifySdpForRelay(sdp, '127.0.0.1', 3480)
  console.log('answer has setup:passive=' + String(/a=setup:passive/.test(answer)))
  console.log('answer has relay candidate=' + String(/a=candidate:2 1 udp 2122262783 127\.0\.0\.1 3480 typ host/.test(answer)))
  console.log('answer has end-of-candidates=' + String(/a=end-of-candidates/.test(answer)))
  console.log('answer has fixed fingerprint=' + String(answer.includes(FIXED_FINGERPRINT)))

  await pc.setRemoteDescription({ type: 'answer', sdp: answer })
  console.log('after setRemote, signalingState=' + pc.signalingState)
  console.log('after setRemote, remoteDescription.type=' + String(pc.remoteDescription?.type))
  console.log('after setRemote, ch.readyState=' + ch.readyState)
  pc.close()
  console.log('after close, signalingState=' + pc.signalingState)
  console.log('done')
}

void main()
