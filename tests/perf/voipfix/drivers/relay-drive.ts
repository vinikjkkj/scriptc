// THE AWKWARD CASE, compiled on purpose.
//
// entry-drive.ts exercises voip's API on a path that never reaches
// @roamhq/wrtc. This one goes straight at the capability that does not
// exist: WaSctpRelay.connectToRelay does `new wrtc.RTCPeerConnection(...)`
// at WaSctpRelay.ts:224, and the import it comes from is fenced at
// WaSctpRelay.ts:5.
//
// The ONLY acceptable outcomes are:
//   * the build refuses, naming the construct and the line; or
//   * with --best-effort, the binary runs, reaches the fence, and THROWS
//     naming the construct and the line.
// A binary that prints a plausible answer here is the silent wrong answer
// this whole subject is about.
//
// The two lines before the fence are ordinary, so the output distinguishes
// "refused at the right place" from "refused on import" from "did something".
import { WaSctpRelay } from './relay/WaSctpRelay.js'

const relay = new WaSctpRelay()
console.log('constructed relay')
relay.setSsrc(0x11223344)
console.log('ssrc set')

relay
    .connectToRelay({
        id: 'r1',
        ip: '127.0.0.1',
        port: 3480,
        token: 'tok',
        key: 'key',
        relayId: 1
    })
    .then((c) => {
        console.log('connectToRelay resolved: ' + (c === null ? 'null' : 'connection'))
    })
    .catch((e: unknown) => {
        console.log('connectToRelay threw: ' + (e as Error).message)
    })
