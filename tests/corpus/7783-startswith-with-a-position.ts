// String.prototype.startsWith WITH a position argument.
//
// The position is a UTF-16 INDEX, not a byte offset, which is the whole
// reason this needs a runtime entry point rather than a pointer bump: the
// lowered form clamps and converts exactly the way indexOf does. The last
// block below asserts that agreement directly, because `s.startsWith(n, p)`
// and `s.indexOf(n, p) === p` are the same question and a program may ask
// it either way.
//
// zapo-js 1.8.2 reaches this at protocol/jid.ts:43,223,226 and
// transport/binary/encoder.ts:241, all as `jid.startsWith(server, from)`.

const s = "hello world";

console.log("plain:", s.startsWith("hello"), s.startsWith("world"));
console.log("at 6:", s.startsWith("world", 6), s.startsWith("hello", 6));
console.log("at 0:", s.startsWith("hello", 0));

// Clamping: negative and beyond-the-end.
console.log("negative:", s.startsWith("hello", -5), s.startsWith("world", -1));
console.log("past end:", s.startsWith("d", 99), s.startsWith("", 99));

// The empty needle matches at every clamped position, including past the end.
console.log("empty:", s.startsWith(""), s.startsWith("", 0), s.startsWith("", 5), s.startsWith("", 11));

// A needle longer than the remainder.
console.log("too long:", s.startsWith("world!!", 6));

// Fractional and non-finite positions go through ToIntegerOrInfinity.
console.log("fractional:", s.startsWith("world", 6.9));
console.log("NaN:", s.startsWith("hello", NaN));
console.log("Infinity:", s.startsWith("", Infinity), s.startsWith("h", -Infinity));

// Astral text: the position counts UTF-16 units, so the emoji occupies two.
const a = "ab" + String.fromCodePoint(0x1f600) + "cd";
console.log("astral len:", a.length);
console.log("astral at 2:", a.startsWith(String.fromCodePoint(0x1f600), 2));
console.log("astral at 4:", a.startsWith("cd", 4));
console.log("astral mid-pair at 3:", a.startsWith("cd", 3));

// The agreement with indexOf, over every position in range.
let agree = 0;
let disagree = 0;
const needles = ["hello", "world", "o", "", "lo w", "x"];
for (let n = 0; n < needles.length; n++) {
  for (let p = -2; p <= s.length + 2; p++) {
    const viaStarts = s.startsWith(needles[n]!, p);
    const clamped = p < 0 ? 0 : p > s.length ? s.length : p;
    const viaIndex = s.indexOf(needles[n]!, p) === clamped;
    if (viaStarts === viaIndex) agree++;
    else disagree++;
  }
}
console.log("indexOf agreement:", agree, disagree);
