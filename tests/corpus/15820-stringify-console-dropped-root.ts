// A replacer that drops the root: Node returns the undefined VALUE, and a
// console argument prints it as `undefined`. A root that is undefined before
// any replacer runs drops the same way; a string root does not.
const u: unknown = undefined;
console.log(JSON.stringify(u, (k: string, v: unknown) => v));
console.log("root:", JSON.stringify(u, (k: string, v: unknown) => v));
const obj: unknown = { a: 1, f: () => 2 };
console.log(JSON.stringify(obj, (k: string, v: unknown) => (k === "" ? undefined : v), 2));
console.log(JSON.stringify("hello", (k: string, v: unknown) => v));
