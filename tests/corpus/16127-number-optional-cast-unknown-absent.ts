// An optional number member cast to unknown: absent reads undefined, present reads the number.
const d: { kind: string; n?: number } = { kind: 'k' };
const x = (d as { n?: unknown }).n;
console.log(x === undefined, typeof x, x);
const e: { kind: string; n?: number } = { kind: 'k', n: 4 };
const y = (e as { n?: unknown }).n;
console.log(y === undefined, typeof y, y);
