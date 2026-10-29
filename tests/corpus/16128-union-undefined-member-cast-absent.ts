// A `T | undefined` member (required key, undefined-valued) cast to unknown, and an
// optional string member absent from a dyn source.
const d: { kind: string; s: string | undefined } = { kind: 'k', s: undefined };
const x = (d as { s?: unknown }).s;
console.log(x === undefined ? 'none' : 'some', JSON.stringify(d), 'kind' in d);
const u: { s?: string } = JSON.parse('{}');
console.log(u.s, 's' in u, JSON.stringify(u));
