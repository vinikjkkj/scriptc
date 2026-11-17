// A Set built over any / unknown elements and printed: duplicates collapse, insertion order, mixed kinds.
const n: any = 5;
const o: any = { a: 1 };
const u: unknown = "u";
console.log(new Set([n, "a", o, n]));
console.log(new Set([u, 1, u]), new Set<unknown>(), new Set<any>());
console.log(new Set([n, 2, "2", 2]));
