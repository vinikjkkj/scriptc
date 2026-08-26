// `instanceof Uint8Array` over a DataView, in the plainest slot there is.
//
// DataView maps to bytes<u8> -- the SAME IR type as Uint8Array -- so that a
// view can alias its owner's storage with no representation of its own
// (types.ts, "the ONE view kind"). That is a good trade everywhere except
// here: `instanceof Uint8Array` is the one question whose answer the two
// spellings disagree about, and the IR type cannot tell them apart.
//
// Before the DataView flavor this printed `true false false` on the first
// line -- a SILENT wrong answer, no diagnostic, no runtime fence, exit 0.
// Node prints `false false false`. The answer now comes from the value's
// stamped flavor rather than from its type.
//
// The Buffer row is the control that says why one representation is still
// right: a Buffer really IS an instance of Uint8Array, so `true` there is
// Node's answer, not a collapse.
const backing = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
const dv = new DataView(backing.buffer, 1, 4);

console.log(dv instanceof Uint8Array, dv instanceof Int8Array, dv instanceof ArrayBuffer);
console.log(backing instanceof Uint8Array, backing instanceof ArrayBuffer);

const buf = Buffer.from([9, 9, 9]);
console.log(buf instanceof Uint8Array);

const win = backing.subarray(2, 5);
console.log(win instanceof Uint8Array);

// The abstract view base: every typed array AND every DataView satisfies
// it, so the slot alone decides nothing and the VALUE has to answer.
const asView: ArrayBufferView = dv;
const asView2: ArrayBufferView = backing;
console.log(asView instanceof Uint8Array, asView2 instanceof Uint8Array);

// The view still aliases, which is the whole reason the representations
// were shared in the first place: stamping a flavor must not change that.
backing[1] = 200;
console.log(dv.getUint8(0), dv.byteLength, dv.byteOffset);
