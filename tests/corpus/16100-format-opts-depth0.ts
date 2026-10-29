// formatWithOptions({ depth: 0 }): %O, %s and rest arguments render one level deep.
import { formatWithOptions } from "node:util";

const nested = { a: { b: { c: { d: 1 } } }, s: "x", n: 2 };
console.log(formatWithOptions({ depth: 0 }, "%O", nested));
console.log(formatWithOptions({ depth: 0 }, "%s", nested));
console.log(formatWithOptions({ depth: 0 }, "value:", nested, [1, [2]]));
console.log(formatWithOptions({ depth: 0 }, "%O and %O", { p: { q: 1 } }, "tail"));
