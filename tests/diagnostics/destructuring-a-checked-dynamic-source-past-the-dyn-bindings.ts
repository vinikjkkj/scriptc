// The BOUNDARY of the checked-dynamic object destructure, from the refusing
// side. The lowering serves a dyn source when every bound name is itself
// dyn -- the read is Node-exact for every receiver kind, and a dyn binding
// takes it with no coercion. These two are outside that, and each would
// cost a WRONG ANSWER rather than a diagnostic if it were admitted.
//
//   1. A binding the checker types CONCRETELY. `number & { low; high }` --
//      how protobuf typings spell "a number, or the Long object this becomes
//      past 2^53" -- maps to the dyn wholesale, while `low` and `high` map
//      to f64. Binding them would coerce the dyn into f64, which is a
//      dynCheck: it TRAPS on a value that does not carry the member, where
//      JS binds undefined. The very reason the intersection maps to the dyn
//      is that the value really is one thing or the other at runtime.
//
//   2. A REST element. `{ a, ...rest }` binds the fields the pattern did not
//      consume, and over a dyn value that set is a runtime fact with no
//      object to pack it into.

type Long = number & { low: number; high: number; unsigned: boolean };
declare function makeLong(): Long;

const { low, high } = makeLong();
console.log(low + high);

declare function anyish(): unknown;

const { a, ...rest } = anyish() as { a?: unknown; b?: unknown };
console.log(String(a), rest === undefined);
