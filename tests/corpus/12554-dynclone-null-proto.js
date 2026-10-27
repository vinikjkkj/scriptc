// A null-prototype dictionary cloned through an untyped path keeps its null
// prototype, its own keys, and shares its object values.
function pass(x) {
  return x;
}
const d = Object.create(null);
d.a = 1;
d.nested = { k: "v" };
const src = pass(d);
const c = Object.create(Object.getPrototypeOf(src), Object.getOwnPropertyDescriptors(src));
console.log(Object.keys(c).join(","));
console.log(c.a, c.nested.k);
c.a = 2;
console.log(d.a, c.a);
c.nested.k = "w";
console.log(d.nested.k, c.nested.k);
