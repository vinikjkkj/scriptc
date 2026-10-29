// %s over objects inspects at depth 0 whatever the options depth is.
import { formatWithOptions } from "node:util";

const o = { a: { b: 1 }, c: [1, 2] };
console.log(formatWithOptions({ depth: null }, "%s", o));
console.log(formatWithOptions({ depth: 5 }, "[%s]", o));
console.log(formatWithOptions({ depth: 1 }, "%s|%s", "T", o));
