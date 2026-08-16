// THE DECIMAL. This is the value a compiled zapo could not produce.
//
// block/longlives proved that a compiled zapo finally has `Long` -- the
// type flipped from `number` to `{low,high,unsigned,toNumber()}` on all
// five payloads -- but every decoded VALUE came back 0, and NaN on the
// build before it. It attributed that as far as "inside readLongVarint,
// after buf[0] read correctly" and stopped, correctly, having already
// shipped its result.
//
// readLongVarint is innocent. The `rawbits` row below reads the same
// LongBits the same reader built and prints 1:2097152 -- Node's exact
// low/high for 2^53+1 -- so the bytes, the tag loop, the position walk and
// every field write are correct. What was wrong is the ONE line that turns
// those bits into a value:
//
//     var t = util.Long ? "toLong" : "toNumber";
//     util.merge(Reader.prototype, { uint64: function () {
//       return readLongVarint.call(this)[t](true); } });
//
// `p.call(this)[t](!0)` is an ELEMENT-spelled method call. It was lowered
// as a keyed read plus a receiverless call, so `this` inside toLong/
// toNumber was not the LongBits -- it was whatever the ambient-receiver
// window held, i.e. the ENCLOSING function's receiver. `0 | undefined` is
// 0 and `undefined + 4294967296 * undefined` is NaN, which is precisely
// the pair of wrong answers zapo printed on the two sides of that merge.
//
// 9007199254740993 is 2^53+1: a double cannot hold it (it rounds to
// ...992), so this row cannot be passed by accident by a path that
// collapses 64-bit fields into a number. u64dec in the package does base-10
// long division over the two halves and never touches a double.
import {
  rawbits, u64Computed, u64Static, u64NumComputed, u64NumStatic,
} from "pbkeyrecv"

// base-128 varint payloads, low group first:
//   2^53+1 = 0x20000000000001 -> 81 80 80 80 80 80 80 10
const p2p53p1 = [129, 128, 128, 128, 128, 128, 128, 16]
//   42
const p42 = [42]
//   2^63-1 (INT64_MAX)
const pi64max = [255, 255, 255, 255, 255, 255, 255, 255, 127]

console.log("rawbits 2^53+1     = " + rawbits(p2p53p1))
console.log("computed 2^53+1    = " + u64Computed(p2p53p1))
console.log("static   2^53+1    = " + u64Static(p2p53p1))
console.log("computed 42        = " + u64Computed(p42))
console.log("static   42        = " + u64Static(p42))
console.log("computed i64max    = " + u64Computed(pi64max))
console.log("static   i64max    = " + u64Static(pi64max))
// the toNumber arm -- the spelling a build WITHOUT `long` takes, and the
// one that answered NaN
console.log("num computed 42    = " + u64NumComputed(p42))
console.log("num static   42    = " + u64NumStatic(p42))
