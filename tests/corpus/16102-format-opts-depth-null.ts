// formatWithOptions({ depth: null }): unbounded depth for %O and rest arguments.
import { formatWithOptions } from "node:util";

const deep = { a: { b: { c: { d: { e: { f: 1 } } } } } };
console.log(formatWithOptions({ depth: null }, "%O", deep));
console.log(formatWithOptions({ depth: null }, "%s", deep));
console.log(formatWithOptions({ depth: null }, "x", deep, "y"));
