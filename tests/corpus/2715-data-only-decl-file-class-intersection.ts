// The class-intersection layer of the .d.ts-data mapping: a protobufjs
// message value typed `Msg & Msg.$Shape` (the `ReturnType<typeof
// proto.Msg.decode>` shape) -- a CLASS instance intersected with its data
// interface. A class part normally keeps its nominal identity and never
// flattens, but a data-only class INSTANCE from a .d.ts (encode/decode are
// static; instances are all data) flattens soundly in a static build: the
// program builds the value from its own bytes, and the ways to obtain one
// FROM the uncompiled module all fence at their own gates --
// `proto.Msg.decode(...)` (SC1090 value/method), `new proto.Msg(...)`
// (non-program-class construction), `x instanceof proto.Msg` (SC1090).
// So only program-built values reach the record, and mapping the shape is
// sound. A method-bearing intersection keeps its fence.
import type { waproto } from './2715-data-only-decl-file-class-intersection/proto.js'

type Decoded = ReturnType<typeof waproto.Msg.decode>

function build(d: Uint8Array): Decoded {
    return { details: d, signature: undefined, $unknowns: [new Uint8Array([7])] }
}

const m = build(new Uint8Array([1, 2, 3]))
console.log(m.details?.length, m.signature === undefined, m.$unknowns?.length)

// Flows through a wrapping record and a Promise, like the pairing flow's
// `Promise<{ signedIdentity: Decoded; keyIndex: number }>`.
async function wrap(d: Uint8Array): Promise<{ readonly si: Decoded; readonly n: number }> {
    return { si: build(d), n: 5 }
}
const r = await wrap(new Uint8Array([9, 9]))
console.log(r.n, r.si.details?.length, r.si.$unknowns?.[0]?.[0])
