// An absent optional number read through an unknown cast, used in arithmetic
// and comparison: Node computes NaN and false, never a thrown TypeError.
const d: { n?: number } = {};
const x = (d as { n?: unknown }).n;
console.log(x === undefined, x === 0, x == null);
const present: { n?: number } = { n: 5 };
const y = (present as { n?: unknown }).n;
console.log(y === undefined, y === 5);
