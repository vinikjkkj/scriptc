// a < b, a <= b, a > b, a >= b over strings compare UTF-16 code units like Node: a supplementary character (surrogate pair, 4 bytes in UTF-8) sorts BEFORE U+E000..U+FFFF (3 bytes) although its bytes sort after. Typed strings, unknown (dyn) operands, and the sort of unknown values must all agree.
const words: string[] = ["", "a", "ab", "é", "ࠀ", "퟿", "", "￿", "\u{10000}", "\u{1F600}", "\u{10FFFF}", "x", "x\u{10000}", "x￿", "0123456789abcdef0123456789abcdef", "0123456789abcdef0123456789abcdef\u{10000}"];
function matrix(list: string[]): string {
  let out = "";
  for (const a of list) {
    for (const b of list) out += (a < b ? "1" : "0") + (a <= b ? "1" : "0") + (a > b ? "1" : "0") + (a >= b ? "1" : "0") + " ";
    out += "\n";
  }
  return out;
}
function cmp4(a: any, b: any): string {
  return (a < b ? "1" : "0") + (a <= b ? "1" : "0") + (a > b ? "1" : "0") + (a >= b ? "1" : "0") + " ";
}
function dynMatrix(list: string[]): string {
  let out = "";
  for (const a of list) {
    for (const b of list) out += cmp4(a, b);
    out += "\n";
  }
  return out;
}
function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}
const m1 = matrix(words);
const m2 = dynMatrix(words);
console.log(m1.length, hash(m1), m2.length, hash(m2), m1 === m2);
console.log("" < "\u{10000}", "\u{10000}" < "", "￿" > "\u{1F600}", "a" >= "a\u{10000}");
const mixed: unknown[] = ["", "\u{10000}", "￿", "\u{1F600}", "a"];
console.log(JSON.stringify(mixed.slice().sort()));
