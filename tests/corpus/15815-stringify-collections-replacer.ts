// Map and Set have no own enumerable members: the replacer sees the value,
// and the output is {} as Node writes it.
const m: unknown = { m: new Map([["a", 1]]), s: new Set([1]) };
console.log(JSON.stringify(m, (k: string, v: unknown) => v));
console.log(JSON.stringify(m, null, 2));
