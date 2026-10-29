// String.prototype.codePointAt over every index kind (ECMA-262 22.1.3.4):
// the UTF-16 index walks astral characters as two units, a lead surrogate
// followed by its trail combines into the code point, the trail half on its
// own answers its own unit, and every out-of-range or non-integer index is
// ToIntegerOrInfinity'd (NaN to 0, fractions truncated) before the range test.
// The empty string and ASCII are the boring ends of the same walk.
//
// Not in this row: a lone surrogate written as a literal (`"\uD83D"`). The
// runtime's storage is well-formed UTF-8, so that half is stored as U+FFFD
// and answers 65533 where Node answers 55357. charCodeAt has the same
// storage divergence (scr_runtime.h, divergence 1); it is not a codePointAt
// defect and this row does not pin it.

const s = "a\u{1F600}b";
function show(i: number): void {
  const c = s.codePointAt(i);
  console.log(i, c);
}
for (let i = -1; i <= 5; i++) show(i);
show(NaN);
show(1.7);
show(-0.5);
show(Infinity);
show(-Infinity);
show(-0);
show(2.9999);
console.log("empty", "".codePointAt(0), "".codePointAt(-1));
console.log("ascii", "xyz".codePointAt(0), "xyz".codePointAt(2), "xyz".codePointAt(3));
console.log("astral", "\u{10FFFF}".codePointAt(0), "\u{10000}".codePointAt(0), "\u{FFFF}".codePointAt(0));
console.log("two", "\u{1F600}\u{1F601}".codePointAt(0), "\u{1F600}\u{1F601}".codePointAt(1), "\u{1F600}\u{1F601}".codePointAt(2), "\u{1F600}\u{1F601}".codePointAt(3));
console.log("bmp-then-astral", "é\u{1F600}".codePointAt(1), "é\u{1F600}".codePointAt(2));
