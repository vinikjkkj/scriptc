// A numeric space is ToIntegerOrInfinity clamped to 0..10 spaces; a value
// below one means compact.
const sp: unknown = { a: [1, { b: [] }], e: {} };
const four = 4;
const twenty = 20;
const zero = 0;
const neg = -3;
const frac = 2.9;
console.log(JSON.stringify(sp, null, four));
console.log(JSON.stringify(sp, null, twenty));
console.log(JSON.stringify(sp, null, zero), JSON.stringify(sp, null, neg));
console.log(JSON.stringify(sp, null, frac));
console.log(JSON.stringify([], null, four), JSON.stringify({}, null, four));
