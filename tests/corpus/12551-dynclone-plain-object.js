// Plain object clone from an untyped source: own props copied, nested values shared.
function make(src) {
  return Object.create(Object.getPrototypeOf(src), Object.getOwnPropertyDescriptors(src));
}
const base = { a: 1, b: "two", nested: { k: 3 } };
base.extra = [1, 2];
const c = make(base);
console.log(Object.keys(c).join(" "));
console.log(c.a, c.b, c.nested.k, c.extra.length);
c.a = 10;
console.log(base.a, c.a);
c.nested.k = 30;
console.log(base.nested.k, c.nested.k);
console.log(typeof c, c.extra[1]);
