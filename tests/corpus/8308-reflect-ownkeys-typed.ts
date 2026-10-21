// The TypeScript face of 8030: the result is `(string | symbol)[]`; a record,
// an index-signature shape with integer-like keys, and a for-of over a literal.
const o = { b: 1, a: 2 };
console.log(Reflect.ownKeys(o));
const k = Reflect.ownKeys(o);
console.log(k.length, k[0], typeof k[1]);
for (const key of Reflect.ownKeys({ x: 1, 7: 2, y: 3 })) console.log(key);
const rec: Record<string, number> = { zz: 1 };
rec["12"] = 5;
rec["aa"] = 2;
rec["3"] = 9;
console.log(Reflect.ownKeys(rec));
