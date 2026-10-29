// Symbols and functions are absent under the replacer walk: an object member
// drops and an array slot prints null, as Node.
const sy: unknown = { k: Symbol("q"), f: () => 1, n: null, a: [Symbol("z"), 1] };
console.log(JSON.stringify(sy, (k: string, v: unknown) => v, 1));
