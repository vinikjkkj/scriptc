// The declared type is ALSO the target of a plain width view of the same wide record (`const v: A = wide`), so it is a struct-view
// target that must not grow when a spread literal typed as it carries a member it does not declare (the carried member's type
// differs from the view source's: `string | undefined` against `string`). It compiled to an internal error before; reads through
// every value are exact. (Enumeration of a value that went through a plain width copy is a standing refusal, so none here.)
type A = { a: string; b: string };
const wide = { a: 'a', b: 'b', extra: 'x' };
const v: A = wide;
const s: A = { ...wide };
const t: A = { ...wide, b: 'override' };
console.log(v.a, v.b, s.a, s.b, t.a, t.b);
function pick(x: A): string { return x.a + x.b; }
console.log(pick(v), pick(s), pick(t));
v.a = 'changed';
console.log(wide.a, v.a, s.a);
