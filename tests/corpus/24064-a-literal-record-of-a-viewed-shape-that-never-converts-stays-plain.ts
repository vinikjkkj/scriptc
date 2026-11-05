// A literal record of a shape that other code converts, but which never converts itself, is an ordinary record: copies, spreads and loops see it as before.
interface Base { n: number }
interface Wide { label: string; n: number }
function twice(b: Base): number { b.n *= 2; return b.n; }
const converted: Wide = { label: "c", n: 3 };
console.log(twice(converted), converted.n);
// a literal of the granted shape that never converts is an ordinary record
const plain: Wide = { label: "p", n: 10 };
plain.n += 1;
const copy = { ...plain };
copy.n = 99;
console.log(plain.n, copy.n, plain.label, JSON.stringify(plain), Object.keys(plain).join());
let sum = 0;
for (let i = 0; i < 1000; i++) { plain.n = i; sum += plain.n; }
console.log(sum);
