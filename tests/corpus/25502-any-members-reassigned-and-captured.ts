// A let variable over an any-member literal reassigned with another literal, captured by closures, and enumerated.
const n: any = 5;
const o: any = { a: 1 };
let r = { n, o };
console.log(r);
r = { n: 7, o: "now a string" };
console.log(r);
const get = (): unknown => r.n;
r.n = "later";
console.log(get(), Object.keys(r));
let list = [n];
list = [o, n];
console.log(list, list.length);
// An evolving array (`const acc = []`, element types from later pushes) is the same checked-dynamic array.
const acc = [];
acc.push(1, "a");
acc.push({ k: 2 });
console.log(acc, acc.length);
var evolving = [];
for (let i = 0; i < 3; i++) evolving.push(i * 2);
console.log(evolving, evolving[1]);
