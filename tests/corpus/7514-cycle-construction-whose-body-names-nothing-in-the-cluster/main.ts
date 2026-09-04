// A two-module ESM cycle where a member builds a lookup map at top level
// from a table it declared above. mongodb's connection_string.ts:1299,
// reduced:
//
//     export const DEFAULT_OPTIONS = new CaseInsensitiveMap(
//       Object.entries(OPTIONS)
//         .filter(([, descriptor]) => descriptor.default != null)
//         .map(([k, d]) => [k, d.default]))
//
// Everything here is user code: two arrow callbacks a builtin invokes,
// and a `new` of a class declared in the cluster itself. Nothing about
// it is an inert expression.
//
// It is admissible anyway, because the hazard a cycle's init window
// carries is a READ of a cluster binding before its declaration ran, and
// none of this code can NAME one. The callbacks touch only their own
// parameters. CaseInsensitiveMap's constructor touches only its own
// parameter, a lib method on it, and `super` into Map. Reading the table
// declared twenty lines above is a same-module read of an already
// initialized slot, which was always allowed.
//
// Three routes had to be bounded for that to be sound rather than
// merely permissive, and all three are exercised here: the callbacks are
// invoked by lib methods on lib-typed receivers, `super(...)` lands on a
// lib base, and destructuring runs a lib (tuple) iterator.
import { run } from "./a.ts";

run();
