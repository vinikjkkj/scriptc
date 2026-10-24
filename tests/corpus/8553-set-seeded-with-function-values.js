// A Set seeded with functions of different signatures: the elements' type is a
// union of function types no typed Set can hold, so it is the dyn-flavoured
// Set, and membership is function identity (each element boxed on its own).
function one(x) { return x; }
function two(x, y) { return y; }
const arrow = (a) => a;
const fns = new Set([one, two, arrow]);
console.log(fns.has(one), fns.has(two), fns.has(arrow), fns.size);
fns.add(one);
console.log(fns.size, [...fns].length);
const same = new Set([one, one]);
console.log(same.size);
