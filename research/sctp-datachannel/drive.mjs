/* Node side of the interop probe: the OFFERER, using the real
 * @roamhq/wrtc prebuilt addon — the oracle. It offers, hands the offer to
 * the compiled C peer over stdin, takes the C peer's answer, and echoes
 * whatever arrives on the data channel the C peer opens. */
import wrtc from '@roamhq/wrtc'
import { spawn } from 'node:child_process'

const EXE = process.argv[2]
if (!EXE) { console.error('usage: drive.mjs <probe.exe>'); process.exit(2) }

const pc = new wrtc.RTCPeerConnection({ iceServers: [] })

let opened = false
pc.ondatachannel = ev => {
  const c = ev.channel
  c.binaryType = 'arraybuffer'
  console.log(`NODE ondatachannel label=${c.label} id=${c.id} ordered=${c.ordered} protocol="${c.protocol}"`)
  opened = true
  c.onopen = () => console.log(`NODE channel open readyState=${c.readyState}`)
  c.onmessage = m => {
    const u = new Uint8Array(m.data)
    console.log(`NODE recv len=${u.length} hex=${Buffer.from(u).toString('hex')}`)
    const reply = new Uint8Array([0xde, 0xad, 0xbe, 0xef])
    console.log(`NODE send len=${reply.length} hex=deadbeef`)
    c.send(reply)
  }
}
pc.oniceconnectionstatechange = () => console.log('NODE iceConnectionState=' + pc.iceConnectionState)
pc.onconnectionstatechange = () => console.log('NODE connectionState=' + pc.connectionState)

// libwebrtc only emits an m=application section if something wants one, so
// create a channel here. Node answers passive, so its own channels land on
// odd stream ids and never collide with the C peer's stream 0.
const nodeSide = pc.createDataChannel('node-side')
const offer = await pc.createOffer()
await pc.setLocalDescription(offer)

await new Promise(res => {
  if (pc.iceGatheringState === 'complete') return res()
  pc.onicegatheringstatechange = () => { if (pc.iceGatheringState === 'complete') res() }
  setTimeout(res, 4000)
})

const fullOffer = pc.localDescription.sdp
console.log('--- OFFER (with gathered candidates) ---')
console.log(fullOffer)

const child = spawn(EXE, [], { stdio: ['pipe', 'pipe', 'inherit'] })
let out = ''
let answered = false
child.stdout.on('data', async d => {
  out += d.toString()
  process.stdout.write(d)
  if (!answered && out.includes('ANSWER-BEGIN') && out.includes('ANSWER-END')) {
    answered = true
    const sdp = out.split('ANSWER-BEGIN')[1].split('ANSWER-END')[0].replace(/^\r?\n/, '')
    try {
      await pc.setRemoteDescription({ type: 'answer', sdp })
      console.log('NODE setRemoteDescription(answer) OK')
    } catch (e) {
      console.log('NODE setRemoteDescription FAILED: ' + e.message)
      child.kill()
      process.exit(5)
    }
  }
})
child.on('exit', code => {
  console.log('PROBE-EXIT ' + code)
  console.log('NODE saw ondatachannel: ' + opened)
  process.exit(code === 0 && opened ? 0 : 1)
})

child.stdin.write('OFFER-BEGIN\n' + fullOffer + 'OFFER-END\n')

setTimeout(() => { console.log('DRIVER TIMEOUT'); child.kill(); process.exit(1) }, 40000)
