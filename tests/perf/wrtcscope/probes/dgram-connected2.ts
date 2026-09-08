/* Connected-mode node:dgram, in the exact shape WaSctpRelay.ts writes it.
 *
 * Why this probe exists: the WebRTC clause's ICE half is zapo's own
 * TypeScript, and the only thing it needs from scriptc is connected-mode
 * dgram. The committed voip site list shows ZERO blockers at
 * WaSctpRelay.ts:455 (`socket.connect(port, ip, cb)`) and :663
 * (`socket.send(new Uint8Array(data))`, the one-argument connected form),
 * but that is an analyze-level result and analyze stops before ir/validate
 * and before both emitters. A closed site count is not a build. This builds.
 *
 * Shapes copied from the provenance checkout 250f9af5,
 * packages/voip/src/relay/WaSctpRelay.ts:441-455 and :663.
 *
 * One direction only, deliberately: replying would need the RemoteInfo
 * argument, which is a different question from connected-mode send and would
 * make a refusal there look like a refusal here. Ports and addresses are
 * never printed -- they differ per run and could not be scored byte-exact.
 */
import dgram from 'node:dgram'

const server = dgram.createSocket('udp4')
const client = dgram.createSocket('udp4')

let got = 0

server.on('message', (msg: Buffer) => {
  got = got + 1
  console.log('server got len=' + String(msg.length) + ' b0=' + String(msg[0]) + ' b2=' + String(msg[2]))
  client.close()
  server.close()
  console.log('closed after ' + String(got))
})

server.on('listening', () => {
  const a = server.address()

  /* :455 -- the CONNECTED form: port, address, callback. This is the call
   * the two prior dgram probes never exercised; both used only the
   * unconnected send(buf, port, addr) three-argument form. */
  client.connect(a.port, '127.0.0.1', () => {
    console.log('client connected')
    /* :663 -- send with ONE argument. Legal only on a connected socket. */
    client.send(new Uint8Array([7, 8, 9]))
  })
})

server.on('error', (err: Error) => {
  console.log('server error ' + err.message)
})
client.on('error', (err: Error) => {
  console.log('client error ' + err.message)
})

server.bind(0, '127.0.0.1')
