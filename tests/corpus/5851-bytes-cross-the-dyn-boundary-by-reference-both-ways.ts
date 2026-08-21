// A Uint8Array/Buffer crossing into `unknown` and back is the SAME object.
//
// scriptc keeps composites in two physically different representations and
// the conversion between them copies — that is the static/dyn boundary's
// documented stance, and `tests/corpus/5630-...` pins the side of it that
// works. BYTES are the one exception the project states out loud, twice:
// SC1101's hint ("Uint8Array/Buffer (shared by reference — writes through
// the 'unknown' value DO reach the original)") and the runtime's own
// refusal text ("A Uint8Array or Buffer crosses by REFERENCE and its
// writes do land").
//
// Only half of that was true. `scr_dyn_new_bytes_ref` aliases on the way
// IN — "one refcounted payload, two views of it" — but the dyn->static
// extraction returned `scr_dyn_bytes_copy_out`, a fresh copy, so the round
// trip lost the object: `(u as Buffer) === b` answered false against
// Node's true, a write through the recovered value landed on a copy nobody
// could read, and a subarray came back detached from its backing buffer.
// The ArrayBuffer arm forty lines up in the same emitter already did the
// right thing, for a reason that applies word for word to the view kind:
// "A copy would silently detach every view already taken over the buffer."
//
// Every row below is a Node answer, byte-compared. They fail on a tree
// where the extraction copies, and each names the surface it is about.

// -------------------------------------------------- the round trip is ===
const b1 = Buffer.from([1, 2, 3])
const u1: unknown = b1
console.log("r01", (u1 as Buffer) === b1)

// two separate recoveries of one crossing are the same object as each other
const r1a = u1 as Buffer
const r1b = u1 as Buffer
console.log("r02", r1a === r1b, r1a === b1)

// ------------------------------------- a write THROUGH the recovered value
const b2 = Buffer.from([1, 2, 3])
const u2: unknown = b2
const r2 = u2 as Buffer
r2[0] = 9
console.log("r03", b2[0], r2[0], b2[0] === r2[0])

// ------------------------------------- a write on the ORIGINAL, read back
const b3 = Buffer.from([1, 2, 3])
const u3: unknown = b3
b3[2] = 7
console.log("r04", (u3 as Buffer)[2])

// ------------------------------------------------ a plain Uint8Array, not a Buffer
const a4 = new Uint8Array([4, 5, 6])
const u4: unknown = a4
const r4 = u4 as Uint8Array
r4[1] = 8
console.log("r05", a4[1], r4 === a4, r4.length)

// ------------------------------------------ the flavor survives the trip
const b5 = Buffer.from([1])
const u5: unknown = b5
console.log("r06", Buffer.isBuffer(u5 as Buffer), (u5 as Buffer).length)

const a6 = new Uint8Array([1])
const u6: unknown = a6
console.log("r07", Buffer.isBuffer(u6 as Uint8Array))

// ------------------------------------------------ a VIEW keeps its window
const whole = Buffer.from([10, 11, 12, 13])
const view = whole.subarray(1, 3)
const u7: unknown = view
const r7 = u7 as Buffer
r7[0] = 99
console.log("r08", whole[1], view[0], r7 === view, r7.length)

// ------------------------------------------- bytes inside a crossing RECORD
// The record itself copies (that is the boundary's stance); the bytes
// FIELD is a reference on both sides of the copy, so a write through the
// recovered field reaches the payload the caller still holds.
const payload = Buffer.from([1, 2, 3])
const rec = { payload }
const u8: unknown = rec
const r8 = u8 as { payload: Buffer }
r8.payload[0] = 42
console.log("r09", payload[0], r8.payload === payload)

// ------------------------------------------- bytes inside a crossing ARRAY
const p1 = Buffer.from([1])
const p2 = Buffer.from([2])
const u9: unknown = [p1, p2]
const r9 = u9 as Buffer[]
r9[1][0] = 55
console.log("r10", p2[0], r9[0] === p1, r9[1] === p2)

// --------------------------------------- through an `unknown` PARAMETER
function writeAt(v: unknown, i: number, val: number): void {
  const bytes = v as Uint8Array
  bytes[i] = val
}
const b10 = Buffer.from([0, 0, 0])
writeAt(b10, 1, 77)
console.log("r11", b10[1])

// --------------------------------------- through an `unknown`-valued field
const box: { v: unknown } = { v: Buffer.from([3, 3]) }
const r11 = box.v as Buffer
r11[0] = 6
console.log("r12", (box.v as Buffer)[0], (box.v as Buffer) === r11)

// ------------------------------------------------------------- CONTROLS
// An explicit COPY is still a copy: Buffer.from over a Buffer allocates,
// so a write through it must NOT reach the source. This is the row that
// fails if "alias" is applied where the program asked for a copy.
const srcB = Buffer.from([1, 2, 3])
const cpB = Buffer.from(srcB)
cpB[0] = 100
console.log("r14", srcB[0], cpB[0], srcB === cpB)

// `subarray` of a recovered value is still a view of the same payload.
const b12 = Buffer.from([1, 2, 3, 4])
const u12: unknown = b12
const sub = (u12 as Buffer).subarray(0, 2)
sub[0] = 21
console.log("r15", b12[0], sub.length)

// A crossing does not change the CONTENTS, whatever it does to identity.
const b13 = Buffer.from([9, 8, 7])
const u13: unknown = b13
const seen13 = u13 as Buffer
console.log("r16", seen13[0], seen13[1], seen13[2], seen13.length)

console.log("r99 still running")
