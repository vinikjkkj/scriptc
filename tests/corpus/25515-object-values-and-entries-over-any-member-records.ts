// Object.values / Object.entries of a record with any-typed members: the result is the checked-dynamic array, printed, stored, consumed in place.
const n: any = 5;
const o: any = { a: 1, b: [true, null] };
const s: any = "str";
const r = { n, o, k: "typed", c: 3 };
console.log(Object.values(r));
console.log(Object.entries(r));
const vals = Object.values(r);
const ents = Object.entries(r);
console.log(vals.length, vals[0], vals[1], ents.length, ents[0], ents[3]);
for (const v of Object.values(r)) console.log(typeof v);
for (const [k, v] of Object.entries(r)) console.log(k, v);
console.log(Object.values(r).length, Object.entries(r)[1][0], Object.values({ s }));
console.log(JSON.stringify(Object.values(r)), JSON.stringify(Object.entries(r)));
