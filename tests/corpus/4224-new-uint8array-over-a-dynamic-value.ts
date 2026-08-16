// `new Uint8Array(v)` where v is a CHECKED-DYNAMIC value.
//
// The constructor's overload set IS a runtime tag dispatch, and only the
// runtime knows the tag. protobufjs's util.newBuffer is the site:
//
//   "number"==typeof e ? (t.Buffer?t._Buffer_allocUnsafe(e):new t.Array(e))
//                      : (t.Buffer?t._Buffer_from(e):new Uint8Array(e))
//
// with the typeof test already taken the OTHER way, so `e` is array-like
// and Node COPIES it. The cheap closure a trap census rewards -- coerce the
// operand to a LENGTH -- gives `new Uint8Array(NaN)`, an empty buffer, and
// every protobuf `bytes` field would decode as empty. Row 1 is the array
// operand; row 4 is the length operand, so a fixture that only measured one
// of them could not tell a dispatch from either fold.
//
// CONTROLS: rows 8 and 9 are the two spellings that already lowered -- a
// STATICALLY number[]-typed operand and a statically bytes-typed one --
// and if either moves, the dyn arm captured a call it should have left
// alone.
//
// NOT A ROW HERE, and a LOUD refusal rather than a guess: a source whose
// element width is neither the destination's nor u8. The checked-dynamic
// tree's BYTES arm only ever carries u8 (Buffer / Uint8Array), so the
// combination is unreachable from a dyn value; guessing at it would be a
// shape claim this tier has not measured.

function mk(v: unknown): Uint8Array {
    // @ts-expect-error deliberately the unchecked shape protobufjs uses
    return new Uint8Array(v)
}
function show(b: Uint8Array): string {
    let s = ""
    for (let i = 0; i < b.length; i++) s += (i > 0 ? "," : "") + String(b[i])
    return String(b.length) + ":" + s
}

// 1. THE SITE'S SHAPE: an array-like operand is a COPY, with each element
//    through ToNumber and the destination's own wrap
const arr: unknown = JSON.parse("[1,2,255,256,-1,3.7]")
console.log("array     " + show(mk(arr)))

// 2. an empty array
const empty: unknown = JSON.parse("[]")
console.log("empty     " + show(mk(empty)))

// 3. an array with nested nulls and booleans -- ToNumber, not a refusal
const mixed: unknown = JSON.parse("[null,true,false,7]")
console.log("mixed     " + show(mk(mixed)))

// 4. a NUMBER operand is the LENGTH form, zero-filled
const len: unknown = JSON.parse("4")
console.log("length    " + show(mk(len)))

// 5. a fractional length truncates (ToIndex never compares back)
const frac: unknown = JSON.parse("3.9")
console.log("fraction  " + show(mk(frac)))

// 6. a BUFFER operand is an element copy
const buf: unknown = Buffer.from([9, 8, 7])
console.log("buffer    " + show(mk(buf)))

// 7. a Uint8Array operand is the same copy
const u8: unknown = new Uint8Array([3, 2, 1])
console.log("uint8     " + show(mk(u8)))

// 8. everything without a length is Node's ToObject-with-no-length: EMPTY
const str: unknown = JSON.parse('"hi"')
console.log("string    " + show(mk(str)))
const obj: unknown = JSON.parse("{}")
console.log("object    " + show(mk(obj)))
const nul: unknown = JSON.parse("null")
console.log("null      " + show(mk(nul)))
const boo: unknown = JSON.parse("true")
console.log("boolean   " + show(mk(boo)))

// 9. CONTROL: a STATICALLY number[]-typed operand, the path that already
//    lowered
const statArr: number[] = [4, 5, 6]
console.log("statarr   " + show(new Uint8Array(statArr)))

// 10. CONTROL: a statically bytes-typed operand, also already lowered
const statBuf: Uint8Array = new Uint8Array([1, 2])
console.log("statbuf   " + show(new Uint8Array(statBuf)))

// 11. CONTROL: the length form written statically
console.log("statlen   " + show(new Uint8Array(3)))

// 12. the copy is INDEPENDENT of its source -- writing through one must
//     not be visible in the other
const src = new Uint8Array([1, 1, 1])
const srcDyn: unknown = src
const copy = mk(srcDyn)
copy[0] = 99
console.log("indep     " + show(src) + " / " + show(copy))
