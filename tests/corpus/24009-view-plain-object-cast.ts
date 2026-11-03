// The checked cast of a PLAIN object to a record type used to copy (a write through the record never reached
// the object, undeclared keys vanished): it is a view like every other.
interface R { a: number; b: string }
function get(): unknown { return JSON.parse('{"a":1,"b":"x","c":5}'); }
const o = get();
const r = o as R;
r.a = 2;
console.log((o as R).a, r.a);
console.log(JSON.stringify(r), JSON.stringify(o));
