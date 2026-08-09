// DataView.setBigUint64 / setBigInt64 over `BigInt(<number>)` -- zapo's
// own spelling, twice, in WaMessageDispatchCoordinator's message-id
// builder:
//
//     dv.setBigUint64(0, BigInt(Date.now()), false)
//     dv.setBigUint64(0, BigInt(Math.floor(Date.now() / 1_000)), false)
//
// The bigint is passed THROUGH to the runtime rather than peeled back to
// its double, which is what keeps the order exact: BigInt(x)'s own
// RangeError on a non-integral x fires while the argument evaluates,
// before the offset is bounds-checked. The last block below is that order.
//
// This file deliberately spells no bigint LITERAL, so it stays inside the
// LLVM tier (which has no ScrBigInt literal ABI); 3215 carries the
// literal-spelled edges.
//
// It also writes EVERY SCALAR SETTER, which is not decoration. The BIG
// pair is the one dvSet* that takes a ScrBigInt and no kind tag, so in
// both backends it must sit AFTER the scalar group's body rather than
// among its case labels -- and a label one line too early silently hands
// every scalar setter's double to the bigint entry point. Nothing in
// TypeScript catches that (both bodies return), and nothing in the corpus
// did either: 2560-arraybuffer-dataview-set.ts was the only program
// spelling a scalar setter and it has not compiled since `new
// ArrayBuffer` fenced, so the whole family had no EXECUTING coverage. It
// does now.

function hex(b: Uint8Array): string {
  let s = "";
  for (let i = 0; i < b.length; i++) s += b[i]!.toString(16).padStart(2, "0");
  return s;
}

const buf = new Uint8Array(16);
const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);

// ── every scalar setter, big- and little-endian ───────────────────────
buf.fill(0);
dv.setUint8(0, 0xab);
dv.setInt8(1, -3);
dv.setUint16(2, 0xbeef, false);
dv.setInt16(4, -2, true);
dv.setUint32(6, 0xdeadbeef, false);
dv.setInt32(10, -66051, true);
console.log("ints  ", hex(buf));
buf.fill(0);
dv.setFloat32(0, 1.5, false);
dv.setFloat64(4, -2.5, true);
console.log("floats", hex(buf));
// The coercions: ToUint32's residue on the integer kinds, double->float
// rounding on Float32.
buf.fill(0);
dv.setUint8(0, 258);
dv.setInt16(1, 70000, false);
dv.setUint32(3, -1, false);
dv.setFloat32(7, 0.1, false);
console.log("coerce", hex(buf));
console.log(
  "read  ",
  dv.getUint8(0),
  dv.getInt16(1, false),
  dv.getUint32(3, false),
  dv.getFloat32(7, false),
);

// ── the BIG pair ──────────────────────────────────────────────────────
buf.fill(0);
// A millisecond timestamp, big-endian (Node's default) and little-endian.
dv.setBigUint64(0, BigInt(1754700000123), false);
console.log("be    ", hex(buf));
dv.setBigUint64(0, BigInt(1754700000123), true);
console.log("le    ", hex(buf));
// The omitted littleEndian argument IS big-endian.
dv.setBigUint64(0, BigInt(1754700000123));
console.log("dflt  ", hex(buf));

// Sign: the unsigned and signed spellings store the SAME bits.
dv.setBigInt64(0, BigInt(-1), false);
console.log("i-1   ", hex(buf));
dv.setBigUint64(0, BigInt(-1), false);
console.log("u-1   ", hex(buf));
dv.setBigInt64(0, BigInt(-2), true);
console.log("i-2le ", hex(buf));

// Overflow: 2^64 is an exact double, and the modulus takes it to zero.
dv.setBigUint64(0, BigInt(2 ** 64), false);
console.log("2^64  ", hex(buf));
dv.setBigUint64(0, BigInt(2 ** 64 + 4096), false);
console.log("wrap  ", hex(buf));
dv.setBigInt64(0, BigInt(-(2 ** 63)), false);
console.log("min   ", hex(buf));

// A non-zero offset, and the neighbouring bytes it must not touch.
buf.fill(0xaa);
dv.setBigUint64(4, BigInt(1), false);
console.log("off4  ", hex(buf));

// Round-trip through the getter's composed form.
dv.setBigUint64(0, BigInt(2 ** 53), false);
console.log("rt    ", Number(dv.getBigUint64(0, false)));
dv.setBigInt64(0, BigInt(-(2 ** 40)), true);
console.log("rtle  ", Number(dv.getBigInt64(0, true)));

// The offset RangeError -- Node's one constant message, scalar and big
// alike.
try {
  dv.setBigUint64(9, BigInt(1), false);
} catch (e) {
  console.log("oob:  ", (e as Error).message);
}
try {
  dv.setBigUint64(-1, BigInt(1), false);
} catch (e) {
  console.log("neg:  ", (e as Error).message);
}
try {
  dv.setUint32(14, 1, false);
} catch (e) {
  console.log("oob32:", (e as Error).message);
}

// ORDER: BigInt(1.5) throws while the ARGUMENT evaluates, so its
// RangeError wins over the (also invalid) offset.
try {
  dv.setBigUint64(999, BigInt(1.5), false);
} catch (e) {
  console.log("order:", (e as Error).message);
}

console.log("end   ", hex(buf));
