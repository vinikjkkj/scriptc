// A function that crosses the checked-dynamic boundary into a slot of another signature is wrapped in an adapter; to JS it is still the
// same function object, so every property written through any name is visible through every other name, and nothing is written when
// nothing is ever given a property.
/**
 * @param {String} namespace
 * @return {Function}
 */
function make(namespace) {
  function f(...args) {
    if (!f.enabled) {
      return;
    }
  }
  f.namespace = namespace;
  f.enabled = false;
  return f;
}
/** @return {Function} */
function bare() {
  function g() {}
  return g;
}
const a = make("x");
const b = a;
a.k = 1;
b.k2 = 2;
console.log(a.k, b.k, a.k2, b.k2, typeof a, a.namespace);
a.k = undefined;
a.k2 = b.k2 + 1;
console.log(b.k, b.k2, a.k2);
const reg = [a, make("y")];
reg[0].z = 9;
reg[1].z = 10;
console.log(a.z, reg[1].z, reg[0] === a, reg[1] === a);
const g1 = bare();
const g2 = g1;
console.log(g1.p);
g1.p = 5;
console.log(g1.p, g2.p);
g2.p = 6;
console.log(g1.p);
for (let i = 0; i < 3; i++) {
  const t = make("n" + i);
  console.log(t.namespace, t.enabled);
}
