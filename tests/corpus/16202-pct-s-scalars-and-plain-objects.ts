// util.format's %s over scalars (-0, bigint, symbol, boolean, null,
// undefined), a plain object without toString (inspect), and a class
// without toString (inspect). None of these calls a user toString.
import { format } from "node:util";

class Bare { a = 1; }
console.log(format("%s", -0));
console.log(format("%s", 5n));
console.log(format("%s", Symbol("x")));
console.log(format("%s", true));
console.log(format("%s", null));
console.log(format("%s", undefined));
console.log(format("%s", { k: 1 }));
console.log(format("%s", new Bare()));
console.log(format("x", { toString() { return "V"; } }));
