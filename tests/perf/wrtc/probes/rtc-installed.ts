/* The RESOLUTION differential: zapo's import shape, built in a project
 * where `@roamhq/wrtc` IS INSTALLED.
 *
 * Every other probe in this directory is built where the package is
 * ABSENT, so the shipped ambient declarations apply and
 * `resolveNpmImport` answers null. That hid a split: with the package
 * present -- which is how zapo installs it, and how any project that
 * also runs under node installs it -- resolution answered, the island
 * skip in lower-modules.ts did not fire, and the import line reported
 * SC2013 before the program reached lower-wrtc at all.
 *
 * Measured on that one variable (moving `node_modules/@roamhq` aside in
 * the lab app and back), same source, same tsconfig, --backend c:
 *
 *     installed      rc=1, one SC2013 at the import line
 *     not installed  rc=0, binary, MATCH byte-exact vs node v25.9.0
 *
 * So run this one in a project that HAS the package. It carries the two
 * global type aliases zapo writes at WaSctpRelay.ts:30-31 as well,
 * because those are the names the ambient file exists to supply.
 */
import wrtc from '@roamhq/wrtc'

type PeerConnectionClass = RTCPeerConnection
type DataChannelClass = RTCDataChannel

const pc: PeerConnectionClass = new wrtc.RTCPeerConnection({ iceServers: [] })
console.log('pc.signalingState=' + pc.signalingState)
const ch: DataChannelClass = pc.createDataChannel('wa-web-call', { ordered: false })
console.log('ch.label=' + ch.label)
console.log('ch.readyState=' + ch.readyState)
ch.close()
console.log('after close, ch.readyState=' + ch.readyState)
pc.close()
console.log('after pc.close, pc.signalingState=' + pc.signalingState)
console.log('done')
