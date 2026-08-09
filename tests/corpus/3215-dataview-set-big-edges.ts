// The eight-byte DataView setters over bigint values that a double could
// NOT carry -- the reason a 64-bit path exists at all. Every value here is
// spelled as a bigint literal or derived from one, so nothing rounds on
// the way in and the stored bytes are the exact ToBigUint64 residue.
//
// (Bigint literals put this program outside the LLVM tier, which has no
// ScrBigInt literal ABI; it refuses loudly there and the C lane scores it.
// 3214 covers the same setters inside the tier.)

function hex(b: Uint8Array): string {
  let s = "";
  for (let i = 0; i < b.length; i++) s += b[i]!.toString(16).padStart(2, "0");
  return s;
}

const buf = new Uint8Array(8);
const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);

// Values with distinct low bits ABOVE 2^53 -- adjacent integers that share
// one double.
dv.setBigUint64(0, 9007199254740993n, false);
console.log("2^53+1", hex(buf));
dv.setBigUint64(0, 9007199254740995n, false);
console.log("2^53+3", hex(buf));
dv.setBigUint64(0, 18446744073709551615n, false);
console.log("max   ", hex(buf));
dv.setBigInt64(0, 9223372036854775807n, false);
console.log("imax  ", hex(buf));
dv.setBigInt64(0, -9223372036854775808n, false);
console.log("imin  ", hex(buf));

// A bigint VARIABLE, not the composed spelling.
const magic = 0xdeadbeefcafebaben;
dv.setBigUint64(0, magic, false);
console.log("magic ", hex(buf));
dv.setBigUint64(0, magic, true);
console.log("magicl", hex(buf));

// The modulus over values far wider than 64 bits, both signs.
dv.setBigUint64(0, 2n ** 200n + 5n, false);
console.log("wide+ ", hex(buf));
dv.setBigUint64(0, -(2n ** 200n) + 3n, false);
console.log("wide- ", hex(buf));
dv.setBigInt64(0, -(2n ** 64n), false);
console.log("-2^64 ", hex(buf));
dv.setBigUint64(0, 0n, false);
console.log("zero  ", hex(buf));

// Arithmetic feeding the setter -- the whole point of holding a bigint.
let acc = 1n;
for (let i = 0; i < 70; i++) acc = acc * 2n + 1n;
dv.setBigUint64(0, acc, false);
console.log("acc   ", hex(buf), String(BigInt.asUintN(64, acc)));

// Round-trip: the getter's composed form rounds to a double, and the
// exact residue is what asUintN answers.
dv.setBigUint64(0, 18446744073709551615n, false);
console.log("rt    ", Number(dv.getBigUint64(0, false)), String(BigInt.asUintN(64, 18446744073709551615n)));

// A value the setter must NOT coerce: a number is not a bigint in JS
// either -- `dv.setBigUint64(0, 1)` is a TypeError in Node and tsc
// rejects it outright, so there is no refusal for the compiler to own.
console.log("end   ", hex(buf));
