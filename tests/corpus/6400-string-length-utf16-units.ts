// `String.prototype.length` is a count of UTF-16 CODE UNITS over storage
// that is UTF-8. The runtime answers it with scr_str_utf16_len, whose fast
// path is "every byte is below 0x80, so the byte length IS the unit count".
// That fast path is exactly where a wrong answer would be silent, so this
// program walks the boundary of it from both sides.
//
// Node is the oracle; nothing here is a golden file. The interesting cases
// are (a) strings that are ASCII except for ONE byte, and where that byte
// sits, (b) each UTF-8 sequence width, (c) the exact lengths at which the
// implementation changes strategy: 0, the 1..3 three-probe form, 4..7 and
// 8..16 the two-overlapping-load forms, and 17 and up the word loop.

// Empty and the one-byte cases.
console.log("[]", "".length);
console.log("[a]", "a".length);
console.log("[ab]", "ab".length);
console.log("[abc]", "abc".length);

// Every ASCII length across both strategy boundaries, 0..24. A run of
// digits, so a length that came back short or long is visible in the text.
const digits = "012345678901234567890123";
for (let i = 0; i <= 24; i++) {
  const s = digits.slice(0, i);
  console.log("ascii", i, s.length, s);
}

// One non-ASCII character moved through every position of an otherwise
// ASCII string, at each interesting length. U+00E9 is two UTF-8 bytes and
// ONE UTF-16 unit, so byte length and answer differ by exactly one: a fast
// path that fired here would be off by one and by nothing else.
const accent = "é";
for (const n of [1, 2, 3, 4, 5, 7, 8, 9, 15, 16, 17, 24]) {
  for (let at = 0; at < n; at++) {
    const s = digits.slice(0, at) + accent + digits.slice(at + 1, n);
    console.log("tail", n, at, s.length, s);
  }
}

// The four UTF-8 widths, alone and in company.
console.log("w1", "A".length);
console.log("w2", "é".length, "Ж".length);
console.log("w3", "中".length, "€".length, "￿".length);
console.log("w4", "\u{10437}".length, "\u{1f600}".length, "\u{10ffff}".length);

// An astral character is TWO units although it is four bytes: the one case
// where the unit count EXCEEDS a per-character count.
const astral = "\u{1f600}";
console.log("astral", astral.length, (astral + astral).length, (astral + "a").length);
console.log("astralmix", ("a" + astral + "b").length, ("ab" + astral).length);

// A run of astral characters crosses the word loop, where eight bytes are
// four units rather than eight.
let manyAstral = "";
for (let i = 0; i < 9; i++) manyAstral += astral;
console.log("manyAstral", manyAstral.length);

// CJK: three bytes, one unit. Sixteen of them is 48 bytes, past every
// short-string boundary, and the unit count is a third of the byte count.
let cjk = "";
for (let i = 0; i < 16; i++) cjk += "中";
console.log("cjk", cjk.length, ("a" + cjk).length, (cjk + "a").length);

// Combining marks are separate code points and each counts.
console.log("combining", "é".length, "á̂".length);
console.log("precomposed", "é".length);

// An embedded NUL is an ordinary code unit below 0x80: it must NOT
// terminate the count.
const withNul = "a\u0000b";
console.log("nul", withNul.length, withNul.charCodeAt(1), "\u0000".length);
console.log("nulrun", "\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000".length);

// U+007F is the last one-byte code point and U+0080 the first two-byte
// one: the two sides of the branch, adjacent.
console.log("edge", "~".length, "\u007f".length, "\u0080".length);
const sevenF = "\u007f\u007f\u007f\u007f\u007f\u007f\u007f\u007f";
console.log("edgerun", sevenF.length, (sevenF + "\u0080").length);

// Concatenation: the result's length is the sum, and the in-place concat
// arm mutates a live string, so any cached count must be invalidated.
let acc = "";
for (let i = 0; i < 20; i++) {
  acc += "x";
  console.log("grow", i, acc.length);
}
let accu = "";
for (let i = 0; i < 6; i++) {
  accu += accent;
  console.log("growu", i, accu.length);
}

// The same strings asked twice, with more of them live than the index
// cache has slots.
const a = "alpha";
const b = "ébravo";
const c = "charlie!";
const d = "deltaéé";
const e = "echo";
console.log("cache", a.length, b.length, c.length, d.length, e.length);
console.log("again", a.length, b.length, c.length, d.length, e.length);
