// Numbers, booleans and null inside nested objects are depth-independent leaves.
import { formatWithOptions } from "node:util";

const leaves = { a: { b: { n: -0, f: 1.5e21, nan: NaN, inf: -Infinity, t: true, z: null } } };
console.log(formatWithOptions({ depth: 0 }, "%O", leaves));
console.log(formatWithOptions({ depth: null }, "%O", leaves));
console.log(formatWithOptions({ depth: 2 }, "%d %i", 1e-7, "0x1f"));
