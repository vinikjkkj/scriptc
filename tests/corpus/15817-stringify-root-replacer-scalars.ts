// Scalar roots through the replacer walk: a string, a number, and a
// replacer that replaces the root itself.
console.log(JSON.stringify("str", (k: string, v: unknown) => v));
console.log(JSON.stringify(7, ["x"], 1));
console.log(JSON.stringify(0.5, (k: string, v: unknown) => (k === "" ? "root:" + k : v)));
