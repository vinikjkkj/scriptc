// `Uint8Array.from(x)` over a same-kind typed array or a number[]: the copy
// `new Uint8Array(x)` already builds.
//
// zapo's spelling is `WaRetryCoordinator.ts:1053` — `baseKey: Uint8Array.from(baseKey)`,
// a defensive copy taken before a caller-owned buffer is parked in a bounded
// cache. It reported SC2020 'Uint8Array.from', while the very same copy
// spelled `new Uint8Array(baseKey)` has compiled all along.
//
// The two sources admitted are exactly the two `new Uint8Array(x)` admits,
// and the routing is to the SAME bytesNew node — so the copy semantics are
// not re-derived, they are the ones already Node-verified.
//
// What is NOT admitted, and why each refusal is a value question rather than
// a routing one:
//   - a mapFn second argument: that is the HOF contract, not a copy.
//   - a NUMBER: this is where the static and the constructor DISAGREE.
//     `new Uint8Array(3)` is three zeroes; `Uint8Array.from(3)` is EMPTY.
//     Routing the number through bytesNew would print the constructor's
//     answer for the static's spelling.
//   - a cross-kind typed array, and a string (`Uint8Array.from('12')` is
//     [1, 2] in Node — per-character ToNumber, not a UTF-8 encode).

const src = new Uint8Array([1, 2, 3, 250, 251]);
const copy = Uint8Array.from(src);
console.log(copy.length, copy.join(","));

// INDEPENDENCE. `from` copies; writing through the copy must not reach the
// source, and writing through the source must not reach the copy. A view
// would print the same number twice on each line.
copy[0] = 99;
console.log(src[0], copy[0]);
src[1] = 88;
console.log(src[1], copy[1]);

// The number[] source, element-coerced exactly like the constructor's
// (ToNumber then the u8 wrap: 256 -> 0, 257 -> 1, -1 -> 255).
const fromNums = Uint8Array.from([0, 1, 255, 256, 257, -1]);
console.log(fromNums.length, fromNums.join(","));

// An empty source is an empty array, not a fence.
console.log(Uint8Array.from(new Uint8Array(0)).length, Uint8Array.from([]).length);

// A Buffer source: Node's answer is a plain Uint8Array holding the same
// bytes, and the copy does NOT inherit Buffer-ness — `Buffer.isBuffer` of it
// is false, and its inspect text is the Uint8Array spelling.
const buf = Buffer.from([7, 8, 9]);
const plain = Uint8Array.from(buf);
console.log(plain.join(","), Buffer.isBuffer(buf), Buffer.isBuffer(plain));

// The other typed-array constructors take the same route.
const u32 = new Uint32Array([1, 70000, 3]);
const u32copy = Uint32Array.from(u32);
u32copy[1] = 5;
console.log(u32[1], u32copy[1], u32copy.length);

const f64 = Float64Array.from([1.5, -2.25]);
console.log(f64[0], f64[1], f64.length);

// Through a function boundary, so the source is not a literal the lowering
// could have folded.
function copyOf(b: Uint8Array): Uint8Array {
    return Uint8Array.from(b);
}
const held = copyOf(src);
held[2] = 1;
console.log(src[2], held[2]);
