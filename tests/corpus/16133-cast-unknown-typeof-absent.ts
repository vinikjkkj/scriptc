// typeof and string templates of an absent cast member.
const d: { kind: string; n?: number } = { kind: 'k' };
const x = (d as { n?: unknown }).n;
console.log(typeof x, `${x}`, String(x), x === null);
