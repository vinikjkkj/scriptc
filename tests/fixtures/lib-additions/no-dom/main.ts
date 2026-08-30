/* The shape zapo's voip package refuses on: a DOM type name used purely as a
 * TYPE. voip's relay/WaSctpRelay.ts:30-31 are exactly these two lines, and
 * they are the whole of what stands between its package entry and an
 * analysable program.
 *
 * Under the forced es2025 lib alone both are `SC0001 Cannot find name` and
 * preflight fails. With the project's own `"lib": ["ES2020","DOM"]` honoured
 * as a floor addition, the names resolve and the program compiles.
 *
 * No DOM VALUE appears here, and that is the honest state of the world: the
 * type exists, the capability does not. value.ts pins the other half. */
type PeerConnectionClass = RTCPeerConnection
type DataChannelClass = RTCDataChannel

/* The aliases are declared and the program runs. A `PeerConnectionClass`
 * value would have to come from somewhere, and nothing here makes one. */
export type { PeerConnectionClass, DataChannelClass }

console.log('dom type names resolved')
console.log('lib floor still es2025: ' + [3, 1, 2].at(-1))
