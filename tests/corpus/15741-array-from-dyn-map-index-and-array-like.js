// Array.from(d, mapfn) with an untyped source, the two-argument form whatwg-url
// uses in parseIPv6 and its state machine: the mapper receives (element, index)
// and its result becomes the element. A string source maps its code points; an
// array source maps its elements; an array-like record reads `length` and
// absent indices as undefined; a Map and a Set walk their entries and values.
function mapCodePoints(input) {
  input = Array.from(input, (c) => c.codePointAt(0));
  let sum = 0;
  for (let i = 0; i < input.length; i++) sum += input[i];
  return sum;
}
function indexed(src) {
  return Array.from(src, (v, i) => String(i) + ":" + String(v));
}
console.log("cp-sum", mapCodePoints("ab:1"));
console.log("cp-astral", mapCodePoints("\u{1F600}"));
console.log("indexed-string", JSON.stringify(indexed("xy")));
console.log("indexed-array", JSON.stringify(indexed([7, "q", null])));
console.log("indexed-set", JSON.stringify(indexed(new Set([3, 4]))));
console.log("indexed-map", JSON.stringify(indexed(new Map([["k", 1]]))));
console.log("array-like", JSON.stringify(indexed({ length: 3, 1: "mid" })));
console.log("array-like-frac", JSON.stringify(indexed({ length: 2.9, 0: "z" })));
console.log("array-like-neg", JSON.stringify(indexed({ length: -4 })));
console.log("array-like-str-len", JSON.stringify(indexed({ length: "2" })));
console.log("numbers", JSON.stringify(indexed(42)), JSON.stringify(indexed(true)));
console.log("empty-string", JSON.stringify(indexed("")));
