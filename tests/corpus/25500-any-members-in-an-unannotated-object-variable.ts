// A variable whose type is its object literal's inferred type, with any-typed members: the members are the checked-dynamic slot in the variable too.
const n: any = 5;
const s: any = "str";
const o: any = { a: 1, b: [true, null] };
const r = { n, s, o, k: 1 };
console.log(r);
console.log(r.n, r.s, r.o.a, r.k + 1);
r.n = "changed";
r.k = 2;
console.log(r, JSON.stringify(r));
function read(): unknown { return r.o; }
console.log(read());
const q = { n };
q.n = [1, 2, 3];
console.log(q);
