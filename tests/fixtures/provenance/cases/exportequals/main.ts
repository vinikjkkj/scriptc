// `export =` from an attested CommonJS package, read the three ways a
// consumer reaches it: the named import (tsc's CJS emit is `(0, m.name)(...)`),
// the default import, a renamed named import; then the expando calls, typeof,
// and identity between the members and the function itself.
import sp, { saslprep, saslprep as renamed } from "exportequals";

console.log(sp("abc"), sp("x", { allowUnassigned: true }));
console.log(saslprep("m"), renamed("n"), saslprep.tag, renamed.tag);
console.log(sp.default("q"), sp.saslprep("r"), sp.tag, typeof sp, typeof saslprep);
console.log(sp.default === sp, saslprep === sp, renamed === saslprep, saslprep.default === saslprep);
