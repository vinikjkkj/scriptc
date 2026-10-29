// A string-or-undefined member, absent, cast to unknown and then narrowed by typeof.
const d: { kind: string; s?: string | undefined } = { kind: 'k' };
const x = (d as { s?: unknown }).s;
if (typeof x === 'string') {
  console.log('string', x);
} else {
  console.log('not string', x === undefined);
}
