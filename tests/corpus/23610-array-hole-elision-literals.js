// Array literals with elisions are holes, not undefined values.
const a = [1, , 3, , ];
console.log(a, a.length, 0 in a, 1 in a, 3 in a, Object.keys(a));
const b = [, "x", , ];
console.log(b, b.length, 0 in b, 1 in b);
const c = [, ];
console.log(c, c.length, 0 in c);
const d = [undefined, , null];
console.log(d, 0 in d, 1 in d, 2 in d);
let n = 0;
a.forEach(() => n++);
console.log(n, a.map((v) => v * 2), a.filter(() => true), a.join("-"));
console.log([..."ab"], [...a], [1, 2, ...[, 5], 6]);
const [p, q, r] = a;
console.log(p, q, r);
