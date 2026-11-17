// Spreading an any-typed object or an any-member record inside a literal that is printed or initialises a variable.
const n: any = 5;
const o: any = { a: 1, b: "x" };
const r = { n };
console.log({ ...o, n });
console.log({ n, ...o, z: 1 }, [1, { ...o }]);
const q = { ...o, n };
console.log(q, Object.keys(q));
const s = { ...r };
console.log(s);
const t = { ...r, extra: true };
console.log(t);
const arr = [n, ...[o, n]];
console.log(arr);
