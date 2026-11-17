// Nested object, array and Map literals in one variable, any-typed values at several depths.
const n: any = 1;
const s: any = "s";
const o: any = { x: [1, 2] };
const r = { a: { b: { c: n } }, arr: [[n], [s, o]], m: new Map([["k", [n, s]]]), mix: [n, { s }, [o]] };
console.log(r);
console.log(r.a.b.c, r.arr[1][1], r.mix.length);
r.a.b.c = "deep write";
console.log(r.a, JSON.stringify(r.arr));
