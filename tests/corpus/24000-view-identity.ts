// A checked cast of an object to a record type is a VIEW: the same object seen through a type, as in
// Node where `x as R` is erased. Identity holds between views of one object, a member read off a view is
// stable, and the view hands the very object back to JavaScript.
interface Inner { x: number }
interface R { a: number; inner: Inner }
const o = JSON.parse('{"a":1,"inner":{"x":7}}') as unknown;
const v1 = o as R;
const v2 = o as R;
console.log(v1 === v2, v1 !== v2, v1.inner === v2.inner, v1.inner === v1.inner);
const other = JSON.parse('{"a":1,"inner":{"x":7}}') as R;
console.log(v1 === other, v1.inner === other.inner);
const back: unknown = v1;
(back as R).a = 42;
console.log(v1.a, v2.a, (o as R).a, JSON.stringify(o));
function same(p: R, q: R): boolean { return p === q; }
console.log(same(v1, v2), same(v1, other), same(v1, v1));
