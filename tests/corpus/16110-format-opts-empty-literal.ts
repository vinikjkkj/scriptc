// The empty options literal is exactly util.format.
import { format, formatWithOptions } from "node:util";

const o = { a: { b: { c: { d: 1 } } }, arr: [[1, [2]]] };
console.log(formatWithOptions({}, "%O %s", o, o) === format("%O %s", o, o));
console.log(formatWithOptions({}, "%O", o));
console.log(formatWithOptions({}, "%s %d", "v", 8, [o]));
