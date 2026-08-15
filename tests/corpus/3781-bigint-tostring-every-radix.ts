// `bigint.toString(radix)` for EVERY radix the spec allows — and the heap
// overflow that lived under radices 2..7 in the reference runtime.
//
// scr_big_to_str sized its digit buffer with `a->n * 11 + 2`. Eleven is the
// DECIMAL bound: a 32-bit limb is worth at most 9.63 decimal digits, so 11
// per limb covers base 10 with room. It covers nothing below base 8. The
// digits a limb is worth in radix r is ceil(32 / log2 r):
//
//     r   2   3   4   5   6   7  |  8   9  10  16  36
//   dig  32  21  16  14  13  12  | 11  11  10   8   7
//                 ^ all past 11  |  ^ all within 11
//
// So every radix from 2 to 7 wrote past the end of a malloc'd block, by up
// to 21 bytes PER LIMB in base 2. The widest value below is 16 limbs: the
// old cap was 178 bytes and `toString(2)` writes 512 of them — a 334-byte
// heap overflow, on the C tier, in shipped binaries. It was found by
// accident (a draft fixture printed `.toString(2).length`) and it presented
// as a segfault at a DIFFERENT line every run, only when stdout was
// redirected, which is what a smashed allocator looks like rather than what
// a compiler bug looks like.
//
// This file pins both halves:
//
//  - the VALUES, every radix 2..36, on multi-limb magnitudes and on both
//    signs, against Node. Widening a buffer cannot change a digit, so this
//    half would have passed before the fix too — it is here because the fix
//    is a capacity argument, and a capacity argument is only worth trusting
//    next to a correctness one.
//  - the OVERFLOW, as a loop. There is nothing to assert about a heap
//    overflow except that the program is still alive afterwards, so the
//    loops check counts they already know and print one line each. A
//    200-iteration radix-2 loop over a 16-limb value crashed the pre-fix
//    runtime every time it was measured.
//
// The radix argument is a variable in the loops on purpose: it reaches the
// runtime as a double either way, and a fixture that only ever spelled it
// as a literal would leave the general entry point untested.

// 512 bits set: exactly 16 full limbs, worst case for every radix.
const wide = 2n ** 512n - 1n;
// 130 bits, 5 limbs: the value the overflow was first measured on.
const dec = 1234567890123456789012345678901234567890n;

// ── every radix, both signs, both magnitudes ───────────────────────────
for (let r = 2; r <= 36; r++) {
  const s = wide.toString(r);
  console.log("wide", r, s.length, s);
}
for (let r = 2; r <= 36; r++) {
  const s = (-dec).toString(r);
  console.log("dec-", r, s.length, s);
}

// The exact digit counts, which are the thing the old capacity got wrong:
// 16 limbs at 32 digits is 512 in base 2 and the sign makes 513, against a
// buffer of 178 bytes.
console.log("len2 wide", wide.toString(2).length, (-wide).toString(2).length);
console.log("len2 dec", dec.toString(2).length, (-dec).toString(2).length);
console.log("len3 wide", wide.toString(3).length);
console.log("len7 wide", wide.toString(7).length);
console.log("len8 wide", wide.toString(8).length);

// ── the overflow, as many chances as it needs ──────────────────────────
let bad = 0;
for (let i = 0; i < 200; i++) {
  if (wide.toString(2).length !== 512) bad++;
  if ((-wide).toString(2).length !== 513) bad++;
}
console.log("radix2 stress", bad);

// The rest of the broken range, at its own exact widths.
const expect = [0, 0, 512, 324, 256, 221, 199, 183];
let bad2 = 0;
for (let r = 2; r <= 7; r++) {
  for (let i = 0; i < 120; i++) {
    if (wide.toString(r).length !== expect[r]) bad2++;
  }
}
console.log("radix2to7 stress", bad2);

// A value whose limb count grows under it, so the capacity is exercised at
// many widths rather than one — and each rendering is decoded back by hand
// (no BigInt(string): this runtime refuses that on purpose) so a wrong
// digit cannot hide behind a right length.
function fromDigits(s: string, base: bigint): bigint {
  let out = 0n;
  for (let k = 0; k < s.length; k++) {
    const c = s.charCodeAt(k);
    out = out * base + BigInt(c >= 97 ? c - 87 : c - 48);
  }
  return out;
}

let acc = 1n;
let bad3 = 0;
for (let i = 0; i < 140; i++) {
  acc = acc * 3n + 1n;
  const b2 = acc.toString(2);
  const b4 = acc.toString(4);
  const b8 = acc.toString(8);
  if (fromDigits(b2, 2n) !== acc) bad3++;
  if (fromDigits(b4, 4n) !== acc) bad3++;
  if (fromDigits(b8, 8n) !== acc) bad3++;
  if (b4.length !== Math.ceil(b2.length / 2)) bad3++;
  if (b8.length !== Math.ceil(b2.length / 3)) bad3++;
}
console.log("growing stress", bad3, acc.toString(36));

// Every radix decoded back, on the widest value and on the limb edges.
let bad4 = 0;
for (const v of [wide, dec, 255n, 4294967295n, 4294967296n, 18446744073709551616n]) {
  for (let r = 2; r <= 36; r++) {
    if (fromDigits(v.toString(r), BigInt(r)) !== v) bad4++;
  }
}
console.log("roundtrip", bad4);

// Zero and the single-limb edges: the early return and the smallest cap.
console.log("zero", (0n).toString(2), (0n).toString(36));
console.log("one", (1n).toString(2), (-1n).toString(2));
console.log("limb", (4294967295n).toString(2).length, (4294967296n).toString(2).length);
