// A PURE-DATA interface declared in a .d.ts with no compiled twin (the
// protobuf-message shape: `interface IADVSignedDeviceIdentity extends
// $Properties` whose members are all Uint8Array/number/nested-data) used
// STRUCTURALLY -- the program builds the value from its own bytes. It
// fenced (SC2011, "no static representation") because the declaration-file
// gate refused every .d.ts-declared type, trusting its values to the
// engine. But a data-only shape IS buildable: the ONLY way to obtain a
// value FROM the uncompiled module -- a value read / method call like
// `proto.X.decode(...)` -- fences at its own value-import gate (SC1090),
// so mapping the STRUCTURAL shape is sound. STATIC builds only (under
// --dynamic the module import is a jsval handle, not a fence).
//
// Method-bearing declaration-file types (an engine object's surface) keep
// the fence -- a call signature needs a body the .d.ts lacks.
import type { Identity } from './2714-data-only-decl-file-interface/shape.js'

function make(k: Uint8Array): Identity {
    return { key: k, signature: undefined, version: 7, nested: { a: 2, tags: ['x', 'y'] } }
}

const id = make(new Uint8Array([1, 2, 3, 4]))
console.log(id.version, id.key.length, id.signature === undefined)
console.log(id.nested?.a, id.nested?.tags.join(','))

// The shape flows through functions and unions like any record.
function versionOf(i: Identity | undefined): number {
    return i?.version ?? -1
}
console.log(versionOf(id), versionOf(undefined))

// A field read narrows correctly.
const sig = id.signature
console.log(sig === undefined ? 'none' : sig.length)
