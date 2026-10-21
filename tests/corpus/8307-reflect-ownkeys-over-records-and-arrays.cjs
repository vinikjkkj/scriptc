// Reflect.ownKeys over objects the program holds as records, checked-dynamic
// objects and arrays: integer-like keys ascending first, then strings in
// insertion order; an array's own keys end with "length". Node is the oracle.
const o = { b: 1, a: 2, 10: "x", 2: "y" };
console.log(Reflect.ownKeys(o));
function keysOf(v) {
  return Reflect.ownKeys(v);
}
console.log(keysOf({ q: 1, 3: 2, p: 3, 1: 0 }), keysOf([7, 8]), keysOf([]));
const bag = {};
bag.zeta = 1;
bag[5] = 2;
bag.alpha = 3;
bag[0] = 4;
console.log(Reflect.ownKeys(bag), Object.keys(["a", "b", "c"]));
console.log(Reflect.ownKeys({}).length);
