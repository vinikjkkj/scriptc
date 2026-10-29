// A string space is its first ten UTF-16 code units, repeated per level.
const sp: unknown = { a: [1, { b: [] }], e: {} };
const long = "abcdefghijklmnop";
console.log(JSON.stringify(sp, null, long));
const short = "--";
console.log(JSON.stringify(sp, (k: string, v: unknown) => v, short));
const empty = "";
console.log(JSON.stringify(sp, null, empty));
