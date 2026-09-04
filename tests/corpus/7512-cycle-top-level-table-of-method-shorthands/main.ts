// A two-module ESM cycle whose members each declare a descriptor TABLE
// at top level -- an object literal whose entries are written in METHOD
// SHORTHAND. mongodb's connection_string.ts:634, reduced:
//
//     export const OPTIONS = {
//       appName: { type: 'string' },
//       auth: { target: 'credentials', transform({ name, values }) { … } },
//       …
//     }
//
// `{ f() {} }` creates exactly the closure `{ f: function () {} }`
// creates, and the second spelling was already admitted at a cycle
// member's top level. Only the spelling differed, so the whole table --
// which contains no executable code at all, just definitions -- was
// refused for containing a method.
//
// The methods are then CALLED from run(), after both modules
// initialized, so the program proves the table was built, not merely
// admitted.
import { run } from "./a.ts";

run();
