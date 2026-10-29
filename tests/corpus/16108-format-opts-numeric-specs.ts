// %d %i %j with a depth option: the numeric and JSON conversions ignore depth.
import { formatWithOptions } from "node:util";

const o = { a: { b: { c: 3 } }, n: 4 };
console.log(formatWithOptions({ depth: 0 }, "%d|%i|%j", 12.5, "42.9px", o));
console.log(formatWithOptions({ depth: null }, "%d|%i|%j", -0, true, [1, "two"]));
console.log(formatWithOptions({ depth: 1 }, "%j %d", { z: null }, 10));
