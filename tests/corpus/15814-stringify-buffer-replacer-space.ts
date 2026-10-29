// A Buffer's toJSON answer {type, data} is what the replacer and the gap see;
// a plain Uint8Array is an index-keyed object.
const bf: unknown = { b: Buffer.from([7, 8]) };
console.log(JSON.stringify(bf, (k: string, v: unknown) => v, 1));
const ta: unknown = { u: new Uint8Array([3, 4]) };
console.log(JSON.stringify(ta, (k: string, v: unknown) => v));
