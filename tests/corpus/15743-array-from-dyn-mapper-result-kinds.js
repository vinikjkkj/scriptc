// Array.from(d, mapfn) over an untyped source where the mapper returns a number,
// a string, a boolean and an object, and where the result is consumed by the
// same dyn operations the real code uses (index reads, length, equality against
// string and number literals, and a spread into a call).
function build(src) {
  return Array.from(src, (c) => c);
}
function nums(src) {
  return Array.from(src, (c) => c.length * 2);
}
const xs = build("hi!");
console.log("elems", xs[0], xs[1], xs[2], xs.length, xs[3] === undefined);
console.log("eq", xs[0] === "h", xs[1] === "i", xs[2] !== "!");
console.log("nums", JSON.stringify(nums(["ab", "cde"])));
console.log("bool-result", JSON.stringify(Array.from("ab", (c) => c === "a")));
console.log("obj-result", JSON.stringify(Array.from("ab", (c) => ({ c }))));
