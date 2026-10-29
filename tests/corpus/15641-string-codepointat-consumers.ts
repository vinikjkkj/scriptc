// codePointAt answers number | undefined, and every consumer must honour the
// undefined arm: a narrowing guard, the assignment-in-condition loop that the
// minified npm idiom uses, template and String() spellings, ?? defaults,
// non-null assertions, a parameter of union type, a mapped Array.from, and
// a Map write of the narrowed value. The probe reads each result after the
// loop has passed the end, where the value is undefined.

const s = "ab\u{1F600}cd\u{10FFFF}";
function isAlpha(cp: number | undefined): boolean {
  return cp !== undefined && cp >= 97 && cp <= 122;
}
function plusOne(n: number): number {
  return n + 1;
}
function firstCp(str: string): number | undefined {
  return str.codePointAt(0);
}
let k = 0;
let c: number | undefined;
while ((c = s.codePointAt(k)) !== undefined) {
  console.log("loop", k, c, typeof c, isAlpha(c));
  k++;
}
for (let i = 0; i < 9; i++) {
  const v = s.codePointAt(i);
  console.log("v", i, v, `${v}`, String(v), v === undefined, v ?? -1, s.codePointAt(i)! > 0x7f);
  console.log("inspect", s.codePointAt(i));
}
console.log("firstCp", firstCp(s), firstCp(""), isAlpha(s.codePointAt(0)), Math.max(0, s.codePointAt(2) ?? 0));
console.log("fromTemplate", `${s.codePointAt(9)}`, s.codePointAt(-5) === undefined, s.codePointAt(2) === 0x1f600);
const arr: (number | undefined)[] = Array.from(s, (ch) => ch.codePointAt(0));
console.log("arr", arr.length, arr[0], arr[2], arr[5]);
const m = new Map<string, number>();
const got = s.codePointAt(3);
if (got !== undefined) m.set("x", got);
console.log("map", m.get("x"), got, plusOne(s.codePointAt(0) ?? 0));
