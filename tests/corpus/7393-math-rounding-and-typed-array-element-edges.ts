// Math.floor / Math.trunc / Math.ceil and typed-array element access, at
// every edge where the fast arms that answer them could diverge from Node.
//
// Both are integer-domain fast paths added on top of expressions that used
// to be a library call: the three Math statics lower to scr_floor/scr_trunc/
// scr_ceil (scr_runtime.h) instead of bare floor()/trunc()/ceil(), and
// `bytes[i]` lowers to scr_bytes_get_inl / scr_bytes_set_inl instead of the
// out-of-line accessors. Each fast arm accepts a strict subset of its
// original and hands the rest over, so the only way it can be wrong is to
// answer something DIFFERENT on the subset it does accept -- which is what
// this program is for.
//
// The values are read out of an array rather than written as literals so
// the compiler cannot constant-fold the calls away: a folded Math.floor
// tests the compiler's own arithmetic, not the runtime's.
//
// NEGATIVE ZERO IS THE POINT. Math.trunc(-0.5), Math.ceil(-0.5) and all
// three of Math.floor(-0) / trunc(-0) / ceil(-0) are -0 in JS, and the
// int64 cast the fast arm is built on answers +0 for every one of them. `==`
// cannot tell those apart, so every number here is printed through a tag
// that asks Object.is -- a differential that printed String(x) would pass a
// runtime that got all five wrong.

function tag(x: number): string {
  if (Number.isNaN(x)) return "NaN"
  if (x === 0) return Object.is(x, -0) ? "-0" : "+0"
  if (x === Infinity) return "+Inf"
  if (x === -Infinity) return "-Inf"
  return String(x)
}

// Zero, the halves either side of it, the 2^53 and 2^63 window edges, the
// doubles adjacent to those edges, and values well past the int64 window
// where the fast arm must decline.
const xs: number[] = [
    0, -0, 0.5, -0.5, 1, -1, 1.5, -1.5, 2.5, -2.5,
    0.9999999999999999, -0.9999999999999999,
    4503599627370495.5, -4503599627370495.5,
    9007199254740991, -9007199254740991,
    9007199254740992, -9007199254740992,
    9223372036854775808, -9223372036854775808,
    9223372036854774784, -9223372036854774784,
    4611686018427387904, -4611686018427387904,
    2147483647.5, -2147483648.5, 4294967296.5, -4294967296.5,
    1e300, -1e300, 1e-300, -1e-300, 1e18, -1e18,
    5e-324, -5e-324,
    NaN, Infinity, -Infinity,
]

console.log("-- floor / trunc / ceil --")
for (let i = 0; i < xs.length; i++) {
    const x = xs[i]
    console.log(tag(x), tag(Math.floor(x)), tag(Math.trunc(x)), tag(Math.ceil(x)))
}

// An index or an operand that arrived from arithmetic is still integral, and
// the fast arm has to agree with the library one about that.
console.log("-- computed operands --")
let acc = 0
for (let i = 0; i < 20; i++) {
    acc += Math.floor(i / 3) + Math.trunc(-i / 3) + Math.ceil(i / 7)
}
console.log("acc", acc)
console.log(tag(Math.floor(6 / 2)), tag(Math.trunc(7 / 7)), tag(Math.ceil(0 / 5)))
console.log(tag(Math.floor(-1 / 3)), tag(Math.trunc(-1 / 3)), tag(Math.ceil(-1 / 3)))

// The carry-propagation shape the compiled bench spends its send phase in:
// Math.floor(t / 65536) over sixteen limbs, each feeding the next. If the
// rounding is off by one anywhere the final limbs diverge loudly.
console.log("-- carry chain --")
const t: number[] = []
for (let i = 0; i < 16; i++) t.push(i * 7919 + 1000000)
let c = 0
for (let r = 0; r < 3; r++) {
    for (let i = 0; i < 16; i++) {
        c = Math.floor(t[i] / 65536)
        t[i] = t[i] - c * 65536
        if (i + 1 < 16) t[i + 1] = t[i + 1] + c
    }
    t[0] = t[0] + c * 38
}
console.log(t.join(","))

// ── typed-array element access ────────────────────────────────────────────
// Every element kind, every store-coercion edge, read back through the same
// indexing the fast arm answers. u8 is the kind the inline arm serves; the
// rest must fall through to the function and answer identically.
console.log("-- element access --")
const vals: number[] = [
    0, -0, 1, -1, 127, 128, 255, 256, 255.7, -1.5, -255,
    65535, 65536, 70000, 4294967295, 4294967296, 4294967297,
    9007199254740993, -9007199254740993, 1e18, -1e18, 1e300, -1e300,
    NaN, Infinity, -Infinity, 0.5, -0.5,
]

const u8 = new Uint8Array(16)
const i8 = new Int8Array(16)
const u16 = new Uint16Array(16)
const i16 = new Int16Array(16)
const u32 = new Uint32Array(16)
const i32 = new Int32Array(16)
const f32 = new Float32Array(16)
const f64 = new Float64Array(16)

for (let v = 0; v < vals.length; v++) {
    const x = vals[v]
    u8[0] = x
    i8[0] = x
    u16[0] = x
    i16[0] = x
    u32[0] = x
    i32[0] = x
    f32[0] = x
    f64[0] = x
    console.log(
        tag(x),
        tag(u8[0]), tag(i8[0]), tag(u16[0]), tag(i16[0]),
        tag(u32[0]), tag(i32[0]), tag(f32[0]), tag(f64[0]),
    )
}

// -0 is index 0 on both the read and the write arm, and an index that came
// out of arithmetic (or out of Math.floor, which is now itself a fast arm)
// indexes the same element as the literal.
console.log("-- index shapes --")
for (let i = 0; i < 16; i++) u8[i] = i * 17
console.log(tag(u8[-0]), tag(u8[0]), tag(u8[15]))
u8[-0] = 99
console.log(tag(u8[0]))
console.log(tag(u8[6 / 2]), tag(u8[2 + 2]), tag(u8[Math.floor(4.9)]), tag(u8[Math.trunc(5.9)]))

// A 2^20 buffer, so the 16-byte case is not the only length exercised, and
// the far end of it.
const big = new Uint8Array(1048576)
big[1048575] = 200
big[1048574] = 7
let sum = 0
for (let i = 0; i < 1048576; i += 65537) {
    big[i] = i & 255
    sum += big[i]
}
console.log("big", tag(big[1048575]), tag(big[1048574]), tag(sum))

// The AES-block shape: a 16-byte buffer walked a byte at a time, which is
// 93.8% of every typed-array read the messaging bench performs.
console.log("-- block walk --")
const block = new Uint8Array(16)
for (let round = 0; round < 8; round++) {
    for (let i = 0; i < 16; i++) block[i] = (block[i] + i * 31 + round * 7) ^ 0x5a
}
const outb: number[] = []
for (let i = 0; i < 16; i++) outb.push(block[i])
console.log(outb.join(","))
