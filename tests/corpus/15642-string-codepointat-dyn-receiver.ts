// codePointAt on an untyped (dyn) receiver and index: the JSON-parsed string
// is a checker `any`, so the call takes the string-only dispatch the other
// String.prototype names use. A dyn index is ToNumber'd first, NaN and
// undefined answer 0 and a miss, and a receiver that is not a string throws
// a TypeError because no other kind of value has codePointAt.

const d: any = JSON.parse('"a\\ud83d\\ude00b"');
console.log(d.codePointAt(0), d.codePointAt(1), d.codePointAt(3), d.codePointAt(-1));
function g(x: any, i: any): number | undefined {
  return x.codePointAt(i);
}
console.log(g("xy", 1), g("xy", 2), g("xy", "0"), g("xy", NaN), g("xy", undefined));
const n: any = 5;
try {
  console.log(n.codePointAt(0));
} catch (e) {
  console.log("threw", e instanceof TypeError);
}
const o: any = { x: 1 };
try {
  console.log(o.codePointAt(0));
} catch (e) {
  console.log("threw", e instanceof TypeError);
}
