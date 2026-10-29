// %o is fixed at depth 4 (showHidden, showProxy) whatever depth the options give.
import { formatWithOptions } from "node:util";

const o = { a: { b: { c: { d: { e: 1 } } } } };
console.log(formatWithOptions({ depth: 0 }, "%o", o));
console.log(formatWithOptions({ depth: 9 }, "%o", o));
console.log(formatWithOptions({ depth: 1 }, "%O and %o", o, { x: { y: { z: { w: 2 } } } }));
