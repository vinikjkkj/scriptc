// A symbol-keyed member of an object literal prints AFTER every string key
// (Node's [[OwnPropertyKeys]] order), spelled Symbol(desc) with no brackets
// on v24 (the CI pin), in insertion order among the symbols.
const s = Symbol("desc");
const t = Symbol("second");
const o = { a: 1, [s]: 2, b: 3, [t]: 4, c: 5 };
console.log(o);
console.log({ [s]: "first", x: "after" });
console.log({ [t]: 0 });
console.log(Object.keys(o), JSON.stringify(o), Object.keys(o).length);
