// Array.from(d) over the remaining run-time kinds: a promise, a proxy that
// forwards reads to a plain record, a WeakMap, a function (one undefined per
// declared parameter), a bigint, a Date, a RegExp and an Error. Each has no
// iterator and no length here, except the function, whose length is its arity,
// and the proxy, whose reads reach the record.
function from(src) {
  return Array.from(src);
}
function three(a, b, c) {}
const proxied = new Proxy({ length: 2, 0: "a", 1: "b" }, {});
console.log("promise", JSON.stringify(from(Promise.resolve(1))));
console.log("proxy", JSON.stringify(from(proxied)));
console.log("weakmap", JSON.stringify(from(new WeakMap())));
console.log("function", JSON.stringify(from(three)), JSON.stringify(from(() => 1)));
console.log("bigint", JSON.stringify(from(5n)));
console.log("date", JSON.stringify(from(new Date(0))));
console.log("regexp", JSON.stringify(from(/ab/)));
console.log("error", JSON.stringify(from(new Error("e"))));
