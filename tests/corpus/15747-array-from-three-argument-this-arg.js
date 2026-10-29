// Array.from(src, mapfn, thisArg) with the thisArg unobservable: an arrow
// mapper ignores it, and a function expression that never names `this` cannot
// tell it apart. The thisArg is a name, `this` or a literal, so evaluating it
// has no effect. Covers an untyped string and array source (the dyn walk), a
// static array and a static string, and the counted `{ length }` form.
function dynSource(src, t) {
  return Array.from(src, (c, i) => c + "@" + i, t);
}
function plainFn(src, t) {
  return Array.from(src, function (c) {
    return c + "!";
  }, t);
}
function counted(t) {
  return Array.from({ length: 3 }, (_v, i) => i * 2, t);
}
const self = { tag: "t" };
console.log("dyn-string", JSON.stringify(dynSource("ab\u{1F600}", 7)));
console.log("dyn-array", JSON.stringify(dynSource([1, 2], null)));
console.log("plain-fn", JSON.stringify(plainFn("xy", 1)), JSON.stringify(plainFn(["q"], "w")));
console.log("static-array", JSON.stringify(Array.from([3, 4], (v, i) => v * 10 + i, self)));
console.log("static-string", JSON.stringify(Array.from("hé", (c) => c.toUpperCase(), self)));
console.log("counted", JSON.stringify(counted(undefined)), JSON.stringify(counted(self)));
