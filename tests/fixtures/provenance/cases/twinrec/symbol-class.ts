// A class field keyed by a symbol the dependency exports (declared `unique symbol` in its .d.ts, assigned `exports.k = Symbol(...)`
// in its implementation), read and written through the class, and the statics tsc emits after the class.
import { Client } from "twinrec/symuser";
const c = new Client("a");
console.log(c.flagged(), c.describe());
c.mark();
console.log(c.flagged());
