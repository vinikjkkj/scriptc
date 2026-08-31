// The worst outcome this brief names, compiled on purpose.
//
// With `lib: ["ES2020","DOM"]` honoured, `RTCPeerConnection` NAMES a type AND
// a global constructor value -- lib.dom.d.ts declares
// `declare var RTCPeerConnection: { prototype: RTCPeerConnection; new(...) }`.
// Nothing in scriptc implements one. If this program compiles clean and runs,
// a program that refused loudly now does something wrong at run time.
//
// The assertions print REAL VALUES, never `typeof`: node prints
// 'RTCPeerConnection is not defined' (node has no such global), so a binary
// that printed "object" and a binary that printed the right thing would be
// distinguishable here.
const pc = new RTCPeerConnection()
console.log('constructed: ' + String(pc))
console.log('signalingState: ' + pc.signalingState)
const dc = pc.createDataChannel('probe')
console.log('channel label: ' + dc.label)
