// Object.values / Object.entries of records whose members mix unknown, number, string and nested values; typed-only records stay typed.
const u: unknown = { deep: [1, 2] };
const m = { u, num: 1, str: "two", flag: true, nested: { x: 1 } };
console.log(Object.values(m));
console.log(Object.entries(m));
const typedOnly = { a: 1, b: 2, c: 3 };
const sum = Object.values(typedOnly).reduce((acc, x) => acc + x, 0);
console.log(sum, Object.entries(typedOnly).map(([k, v]) => k + v));
const strs = { x: "a", y: "b" };
console.log(Object.values(strs).join("+"), Object.entries(strs));
const e = Object.entries(m);
console.log(e.length, e[0][0], e[1][1]);
