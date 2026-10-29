// An optional union member cast to unknown with the member present: the value
// and its printing come through unchanged.
type Doc = { kind: string } & { n?: number | string };
const d: Doc = { kind: 'k', n: 'x' };
const v = (d as { n?: unknown }).n;
console.log(v === undefined ? 'none' : 'some', typeof v, v);
console.log(d, JSON.stringify(d));
