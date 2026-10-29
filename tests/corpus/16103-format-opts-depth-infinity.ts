// formatWithOptions({ depth: Infinity }): the same unbounded rendering as depth null.
import { formatWithOptions } from "node:util";

const deep = { l1: { l2: { l3: { l4: { l5: "bottom" } } } } };
console.log(formatWithOptions({ depth: Infinity }, "%O", deep));
console.log(formatWithOptions({ depth: Infinity }, "%o", { p: { q: { r: { s: 1 } } } }));
console.log(formatWithOptions({ depth: Infinity }, "rest", deep));
